// ============================================================================
//  lib/reindex.ts — herindexeer één document onder R1.1 + R1.2 (gedeelde re-index).
// ----------------------------------------------------------------------------
//  De gedeelde, herhaalbare en omkeerbare re-index-stap die de backfill-paden
//  (fonds via anon-key/RLS, generiek via service-role) allebei aanroepen. Per
//  document: origineel uit Storage → her-extractie → bouwChunkRecords (structuur
//  + context-prefix + verrijkte embedding) → bestaande chunks vervangen.
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
//  "server-only": raakt Storage + externe modellen via bouwChunkRecords.
// ============================================================================

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractTekstMetOcrFallback } from "./ocr";
import { bouwChunkRecords, INDEXERING_VERSIE } from "./chunk-ingest";
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
}

export interface HerindexResultaat {
  status: "verwerkt" | "overgeslagen" | "mislukt";
  aantalChunks: number;
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

export async function herindexeerDocument(
  client: SupabaseClient,
  doc: HerindexDocument
): Promise<HerindexResultaat> {
  // Geen origineel → niet structuur-her-chunkbaar. Stempel als overgeslagen.
  if (!doc.opslag_pad) {
    await markeerOvergeslagen(client, doc.id);
    return { status: "overgeslagen", aantalChunks: 0, embeddingsGelukt: false, reden: "geen_origineel" };
  }

  const bestandstype = (doc.bestandstype as Bestandstype) || "pdf";
  if (!ONDERSTEUNDE_TYPES.includes(bestandstype)) {
    await markeerOvergeslagen(client, doc.id);
    return { status: "overgeslagen", aantalChunks: 0, embeddingsGelukt: false, reden: "type_niet_ondersteund" };
  }

  // Origineel ophalen (RLS dekt toegang bij de anon-client; service-role ziet alles).
  const { data: bestand, error: dlErr } = await client.storage
    .from(STORAGE_BUCKET)
    .download(doc.opslag_pad);
  if (dlErr || !bestand) {
    console.error(`[reindex] download mislukt voor ${doc.id}:`, dlErr?.message);
    return { status: "mislukt", aantalChunks: 0, embeddingsGelukt: false, reden: "download_mislukt" };
  }

  const buffer = Buffer.from(await bestand.arrayBuffer());
  let extractie;
  try {
    extractie = await extractTekstMetOcrFallback(buffer, bestandstype);
  } catch (e) {
    console.error(`[reindex] extractie mislukt voor ${doc.id}:`, e);
    return { status: "mislukt", aantalChunks: 0, embeddingsGelukt: false, reden: "extractie_mislukt" };
  }
  if (!extractie.tekst || extractie.tekst.trim().length < 100) {
    // Ook na OCR geen bruikbare tekst → niet chunkbaar. Dit is een permanente,
    // document-eigen conditie (net als "geen origineel"), géén tijdelijke fout:
    // stempel als overgeslagen zodat de backfill 'm niet eindeloos opnieuw oppakt.
    await markeerOvergeslagen(client, doc.id);
    return { status: "overgeslagen", aantalChunks: 0, embeddingsGelukt: false, reden: "geen_tekst" };
  }

  const { records, aantalChunks, embeddingsGelukt } = await bouwChunkRecords({
    documentId: doc.id,
    titel: doc.titel,
    segmenten: extractie.segmenten,
  });

  // Bestaande chunks vervangen: delete dan insert (RLS-policy "fonds chunks"
  // dekt beide voor de eigen scope; service-role voor generiek).
  const { error: delErr } = await client
    .from("document_chunks")
    .delete()
    .eq("document_id", doc.id);
  if (delErr) {
    console.error(`[reindex] oude chunks verwijderen mislukt voor ${doc.id}:`, delErr.message);
    return { status: "mislukt", aantalChunks: 0, embeddingsGelukt: false, reden: "verwijderen_mislukt" };
  }

  const batch = 50;
  for (let i = 0; i < records.length; i += batch) {
    const { error: insErr } = await client
      .from("document_chunks")
      .insert(records.slice(i, i + batch));
    if (insErr) {
      console.error(`[reindex] chunk-insert mislukt voor ${doc.id}:`, insErr.message);
      return { status: "mislukt", aantalChunks: 0, embeddingsGelukt, reden: "insert_mislukt" };
    }
  }

  // Afgeleide document-velden bijwerken (paginatelling + OCR-audit). Best-effort.
  await client
    .from("documenten")
    .update({
      geindexeerd: true,
      paginas: extractie.aantalPaginas,
      ocr_toegepast: extractie.ocrToegepast,
      ocr_engine: extractie.ocrEngine,
    })
    .eq("id", doc.id);

  void INDEXERING_VERSIE; // versie-stempel zit al op de records via bouwChunkRecords
  return { status: "verwerkt", aantalChunks, embeddingsGelukt };
}
