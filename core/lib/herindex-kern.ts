// ============================================================================
//  lib/herindex-kern.ts — herindexeer één document (gedeelde re-index, #548).
// ----------------------------------------------------------------------------
//  De gedeelde, herhaalbare re-index-stap die de backfill-paden (fonds via
//  anon-key/RLS, generiek via service-role) allebei aanroepen. Per document:
//  origineel uit Storage → her-extractie → kale chunks (gedeelde structuur-
//  logica) → ATOMISCH vervangen (fn_document_chunks_vervangen) → verrijken
//  (context-prefix + embedding) → pas dan geindexeerd/beschikbaar. Faalt de
//  verrijking, dan ruimen we de hele chunkset op en staat het document op
//  'mislukt' (#548): nooit een gedeeltelijke of half verrijkte index die als
//  volledig geïndexeerd wordt gepresenteerd.
//
//  Zonder "server-only": extractie en verrijking komen als afhankelijkheden
//  binnen (reindex.ts levert de echte), zodat de foutafhandeling testbaar is.
//
//  Client-agnostisch: dezelfde supabase-js-calls werken met de anon-client
//  (RLS dwingt de fonds-scope af) én de service-role-client (generiek). De
//  caller bepaalt dus de scope/zichtbaarheid; deze functie kiest niets.
//
//  REVERSIBILITEIT: `tekst` wordt nooit aangeraakt — alleen afgeleide chunks
//  worden ververst. Elke chunk krijgt indexering_versie als versie-stempel. Een
//  document zonder Storage-origineel kan niet structuur-her-gechunkt worden;
//  dat stempelen we OVERGESLAGEN_VERSIE op de baseline-chunks zodat de backfill
//  ze niet eindeloos opnieuw oppakt (de inhoud blijft baseline en zoekbaar).
//
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractieResultaatMetOcr, OcrFallbackOpties, OcrReservering } from "./ocr";
import type { GatewayAanroep } from "./ai-gateway/contract";
import { heeftSchoonScanbewijs, isMalwarescanAan } from "./document-scan-poort";

/**
 * Bovengrens op het aantal OCR-pagina's per her-indexering (besluit 0180).
 * Dit pad kende tot nu toe géén cap — `magOcrDraaien` kreeg geen grens mee en
 * gaf dan onvoorwaardelijk `true` terug, waardoor een PDF van willekeurige
 * omvang integraal naar de provider ging. Gelijkgetrokken met de worker
 * (MAX_OCR_PAGINAS in platform/lib/ingest-orchestrator.ts).
 */
const MAX_OCR_PAGINAS_HERINDEX = 200;

/** Optionele begrenzing; zonder reserveerOcr blijft alleen de paginacap over. */
export interface HerindexBegrenzing {
  maxOcrPaginas?: number;
  reserveerOcr: OcrReservering;
  gateway: GatewayAanroep;
}
import type { VerrijkChunksOpties } from "./chunk-ingest";
import { bouwChunkRecordsZonderVerrijking } from "./chunk-bouw";
import { ruimChunksOp, vervangChunksAtomisch } from "./chunk-vervangen";
import { overschrijdtChunkCap } from "./ingest-caps";

// Verrijkingsrondes (elk max. VERRIJK_LIMIET chunks). 40 × 200 = 8.000 chunks,
// ruim boven het grootste generieke document (MvT ~2.900 chunks).
const VERRIJK_LIMIET = 200;
const MAX_VERRIJK_RONDES = 40;
import { ONDERSTEUNDE_TYPES, type Bestandstype } from "./document-extractie";

export const STORAGE_BUCKET = "documenten";

// Stempel voor baseline-chunks die NIET structuur-her-gechunkt konden worden om
// een PERMANENTE, document-eigen reden (geen Storage-origineel, niet-ondersteund
// type, of geen bruikbare tekst — ook niet na OCR). Niet-null, dus ze vallen uit
// de "nog te doen"-selectie (indexering_versie is null), maar onderscheidbaar van
// een echte R1-indexering. Cruciaal: zonder deze stempel zou de backfill zo'n
// document elke ronde opnieuw oppakken (.limit(1) op baseline-chunks) en de hele
// rij blokkeren. De `reden` in het resultaat houdt de precieze oorzaak vast.
export const OVERGESLAGEN_VERSIE = "r1-overgeslagen";

// Document-vorm die de re-index nodig heeft (gelijk voor fonds en generiek).
export interface HerindexDocument {
  id: string;
  titel: string;
  opslag_pad: string | null;
  bestandstype: string | null;
  documenttype?: string | null;
  wetsgeschiedenis_subtype?: string | null;
}

export interface HerindexResultaat {
  status: "verwerkt" | "overgeslagen" | "mislukt";
  aantalChunks: number;
  prefixModel: string | null;
  embeddingsGelukt: boolean;
  reden?: string;
}

// Stempel de nog-baseline chunks van een document met OVERGESLAGEN_VERSIE zodat
// de backfill ze niet opnieuw oppakt. Raakt alleen indexering_versie aan.
async function markeerOvergeslagen(
  client: SupabaseClient,
  documentId: string
): Promise<void> {
  await client
    .from("document_chunks")
    .update({ indexering_versie: OVERGESLAGEN_VERSIE })
    .eq("document_id", documentId)
    .is("indexering_versie", null);
}

/** De IO-zware stappen; reindex.ts levert de echte implementaties. */
export interface HerindexAfhankelijkheden {
  extraheer: (
    buffer: Buffer,
    bestandstype: Bestandstype,
    opties: OcrFallbackOpties
  ) => Promise<ExtractieResultaatMetOcr>;
  verrijk: (
    client: SupabaseClient,
    documentId: string,
    opties: VerrijkChunksOpties
  ) => Promise<{ verwerkt: number; resterend: number }>;
}

export async function herindexeerMetAfhankelijkheden(
  client: SupabaseClient,
  doc: HerindexDocument,
  begrenzing: HerindexBegrenzing,
  deps: HerindexAfhankelijkheden
): Promise<HerindexResultaat> {
  // Geen origineel → niet structuur-her-chunkbaar. Stempel als overgeslagen.
  if (!doc.opslag_pad) {
    await markeerOvergeslagen(client, doc.id);
    return { status: "overgeslagen", aantalChunks: 0, prefixModel: null, embeddingsGelukt: false, reden: "geen_origineel" };
  }

  // WP3 — dit pad voert de originele bytes aan parser/OCR en de chunktekst aan
  // een model. Zonder schoon hash-gebonden scanbewijs niet: de ingestworker
  // scant en herindexeert zo'n document zelf (platform/lib/legacy-scan.ts).
  // Stempelen als overgeslagen voorkomt dat de backfill (.limit(1)) blijft
  // hangen op hetzelfde document; de worker vervangt de chunks na een schone
  // scan door R1-chunks.
  if (isMalwarescanAan()) {
    const { data: bewijs, error: bewijsErr } = await client
      .from("documenten")
      .select("bestand_hash, scan_resultaat")
      .eq("id", doc.id)
      .maybeSingle();
    if (bewijsErr) {
      return { status: "mislukt", aantalChunks: 0, prefixModel: null, embeddingsGelukt: false, reden: "scanbewijs_lezen_mislukt" };
    }
    if (!bewijs || !heeftSchoonScanbewijs(bewijs as { bestand_hash: string | null; scan_resultaat: Record<string, unknown> | null })) {
      await markeerOvergeslagen(client, doc.id);
      return { status: "overgeslagen", aantalChunks: 0, prefixModel: null, embeddingsGelukt: false, reden: "scanbewijs_ontbreekt" };
    }
  }

  const bestandstype = (doc.bestandstype as Bestandstype) || "pdf";
  if (!ONDERSTEUNDE_TYPES.includes(bestandstype)) {
    await markeerOvergeslagen(client, doc.id);
    return { status: "overgeslagen", aantalChunks: 0, prefixModel: null, embeddingsGelukt: false, reden: "type_niet_ondersteund" };
  }

  // Origineel ophalen (RLS dekt toegang bij de anon-client; service-role ziet alles).
  const { data: bestand, error: dlErr } = await client.storage
    .from(STORAGE_BUCKET)
    .download(doc.opslag_pad);
  if (dlErr || !bestand) {
    console.error(`[reindex] download mislukt voor ${doc.id}:`, dlErr?.message);
    return { status: "mislukt", aantalChunks: 0, prefixModel: null, embeddingsGelukt: false, reden: "download_mislukt" };
  }

  const buffer = Buffer.from(await bestand.arrayBuffer());
  let extractie;
  try {
    // AI-BEGRENZING (besluit 0180). Dit pad had GEEN paginacap: een PDF van
    // willekeurige omvang ging integraal naar de OCR-provider. De cap staat er
    // nu, en met een reserveringsfunctie worden de pagina's vóór verzending
    // geboekt op het fondsquotum — per poging, want een retry wordt opnieuw
    // gefactureerd.
    extractie = await deps.extraheer(buffer, bestandstype, {
      maxOcrPaginas: begrenzing.maxOcrPaginas ?? MAX_OCR_PAGINAS_HERINDEX,
      poort: { supabase: client, label: "reindex" },
      reserveerOcr: begrenzing.reserveerOcr,
    });
  } catch (e) {
    console.error(`[reindex] extractie mislukt voor ${doc.id}:`, e);
    return { status: "mislukt", aantalChunks: 0, prefixModel: null, embeddingsGelukt: false, reden: "extractie_mislukt" };
  }
  if (!extractie.tekst || extractie.tekst.trim().length < 100) {
    // Ook na OCR geen bruikbare tekst → niet chunkbaar. Dit is een permanente,
    // document-eigen conditie (net als "geen origineel"), géén tijdelijke fout:
    // stempel als overgeslagen zodat de backfill 'm niet eindeloos opnieuw oppakt.
    await markeerOvergeslagen(client, doc.id);
    return { status: "overgeslagen", aantalChunks: 0, prefixModel: null, embeddingsGelukt: false, reden: "geen_tekst" };
  }

  // #548 — kale chunks (gedeelde structuurlogica, beide bibliotheken), dan
  // ATOMISCH vervangen: oude chunks weg + nieuwe erin in één transactie. Faalt
  // dat, dan blijft de oude chunkset volledig staan en verandert er niets.
  const records = bouwChunkRecordsZonderVerrijking({
    documentId: doc.id,
    segmenten: extractie.segmenten,
    documenttype: doc.documenttype,
    wetsgeschiedenisSubtype: doc.wetsgeschiedenis_subtype,
  });
  if (records.length === 0) {
    await markeerOvergeslagen(client, doc.id);
    return { status: "overgeslagen", aantalChunks: 0, prefixModel: null, embeddingsGelukt: false, reden: "geen_tekst" };
  }
  if (overschrijdtChunkCap(records.length)) {
    return { status: "mislukt", aantalChunks: 0, prefixModel: null, embeddingsGelukt: false, reden: "te_veel_chunks" };
  }
  const vervanging = await vervangChunksAtomisch(client, doc.id, records);
  if (!vervanging.ok) {
    console.error(`[reindex] chunks vervangen mislukt voor ${doc.id}:`, vervanging.fout);
    return { status: "mislukt", aantalChunks: 0, prefixModel: null, embeddingsGelukt: false, reden: "vervangen_mislukt" };
  }

  // Verrijking (context-prefix + embedding) op de ingevoegde chunks — dezelfde
  // DB-route als de worker, hervatbaar per ronde. De chunkset is vanaf hier
  // volledig; alleen de verrijking loopt nog. Bij een fout ruimen we de hele
  // chunkset op en staat het document op 'mislukt' (zie ruimChunksOp): geen
  // halfverrijkte index die als volledig geïndexeerd wordt gepresenteerd.
  try {
    for (let ronde = 0; ronde < MAX_VERRIJK_RONDES; ronde++) {
      const r = await deps.verrijk(client, doc.id, {
        titel: doc.titel,
        gateway: begrenzing.gateway,
        prefixFailClosed: true,
        limiet: VERRIJK_LIMIET,
      });
      if (r.resterend === 0) break;
      if (r.verwerkt === 0) throw new Error("verrijking_zonder_voortgang");
    }
    const { count: nogNull, error: telErr } = await client
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc.id)
      .is("embedding", null);
    if (telErr || (nogNull ?? 0) > 0) throw new Error("verrijking_onvolledig");
  } catch (e) {
    console.error(`[reindex] verrijking mislukt voor ${doc.id}:`, e instanceof Error ? e.message : e);
    const opgeruimd = await ruimChunksOp(client, doc.id);
    return {
      status: "mislukt",
      aantalChunks: 0,
      prefixModel: null,
      embeddingsGelukt: false,
      reden: opgeruimd ? "verrijking_mislukt" : "verrijking_mislukt_opruimen_mislukt",
    };
  }

  const { data: prefixRij } = await client
    .from("document_chunks")
    .select("prefix_model")
    .eq("document_id", doc.id)
    .not("prefix_model", "is", null)
    .limit(1)
    .maybeSingle();
  const prefixModel = (prefixRij as { prefix_model: string | null } | null)?.prefix_model ?? null;

  // Pas nu: volledig geïndexeerd en beschikbaar (+ paginatelling/OCR-audit).
  const { error: afErr } = await client
    .from("documenten")
    .update({
      geindexeerd: true,
      verwerkingsstatus: "beschikbaar",
      paginas: extractie.aantalPaginas,
      ocr_toegepast: extractie.ocrToegepast,
      ocr_engine: extractie.ocrEngine,
    })
    .eq("id", doc.id);
  if (afErr) {
    // Chunks zijn volledig en verrijkt; alleen de status bleef hangen op
    // 'embedding'/geindexeerd=false. Dat is eerlijk (niet ten onrechte
    // 'volledig'), en de selectie pakt het document opnieuw op.
    console.error(`[reindex] afronden mislukt voor ${doc.id}:`, afErr.message);
    return { status: "mislukt", aantalChunks: records.length, prefixModel, embeddingsGelukt: true, reden: "afronden_mislukt" };
  }

  return { status: "verwerkt", aantalChunks: records.length, prefixModel, embeddingsGelukt: true };
}

