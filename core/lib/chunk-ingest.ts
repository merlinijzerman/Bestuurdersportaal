// ============================================================================
//  lib/chunk-ingest.ts — gedeelde chunk-ingest voor de RAG-pipeline (R1.1 + R1.2).
// ----------------------------------------------------------------------------
//  Eén bron-van-waarheid die ALLE ingest-/re-index-paden (tenant-upload,
//  her-extract, generieke platform-pipeline en de backfill-orchestrator) delen,
//  zodat structuur-chunking, context-prefix en embedding overal identiek zijn.
//
//  Wat het doet, per document:
//    1. R1.1 — structuur-bewuste chunking (lib/chunking.ts): chunks lopen nooit
//       over een structuurgrens; elke chunk draagt structuur_type/-label.
//    2. R1.2 — context-prefix PER STRUCTUUR-UNIT (goedkoop Haiku-model) o.b.v. een
//       STRUCTUUR-VENSTER (documenttitel + structuuronderdeel + fragment). Eén
//       situeringszin per (structuur_type, structuur_label) wordt hergebruikt over
//       de chunks van die unit (F2, §0c-7); labelloze chunks blijven één-op-één.
//       De prefix situeert het fragment voor zoekbaarheid en wordt NOOIT getoond.
//    3. Embedding over de VERRIJKTE tekst (prefix + fragment), exact gelijk aan
//       wat de FTS-generated-kolom zoek_vector indexeert
//       (coalesce(context_prefix || ' ', '') || tekst).
//
//  F2-SPLITSING:
//    - De PURE helft (kale ChunkRecord-bouw + prefix-groepering + verrijkTekst)
//      leeft in lib/chunk-bouw.ts (geen server-only, los testbaar).
//    - DEZE module houdt de DURE, server-only helft: de externe modelcalls.
//    - bouwChunkRecords = kale bouw + in-memory verrijking (synchrone paden).
//    - verrijkChunks(supabase, …) = het DB-pad voor de async worker: leest kale
//      chunks (embedding is null), verrijkt en schrijft terug. Hervatbaar.
//
//  PREFIX-ISOLATIE (kernvoorwaarde): `tekst` blijft exact het originele fragment
//  en is en blijft het enige weergaveveld. De prefix leeft in context_prefix en
//  lekt nergens in de getoonde passage of bronvermelding.
//
//  "server-only": raakt ANTHROPIC_API_KEY + MISTRAL_API_KEY; nooit naar de browser.
// ============================================================================

import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bewaakteAnthropic, isPoortGesloten, type PoortContext } from "./ai-poort";
import { type ChunkMetLocatie } from "./chunking";
import {
  embedTeksten,
  naarVectorLiteral,
  EMBED_MODEL,
  type EmbedStats,
} from "./embeddings";
import { HAIKU_MODEL } from "./llm-modellen";
import type { TekstSegment } from "./document-extractie";
import {
  INDEXERING_VERSIE,
  bepaalPrefixGroepen,
  bouwChunkRecordsZonderVerrijking,
  verrijkTekst,
  type ChunkRecord,
  type PrefixInvoer,
} from "./chunk-bouw";

// Re-export de pure API zodat bestaande importers (reindex.ts, backfill-paden)
// ongewijzigd blijven en callers één ingang houden.
export {
  INDEXERING_VERSIE,
  bouwChunkRecordsZonderVerrijking,
  bepaalPrefixGroepen,
  verrijkTekst,
  PREFIX_UNIT_CAP,
} from "./chunk-bouw";
export type { ChunkRecord, PrefixInvoer } from "./chunk-bouw";

// Goedkoop model voor de context-prefixes (zelfde keuze als de chat-rewrite/map).
// Centraal in lib/llm-modellen.ts zodat ingest, map-stap en reranker niet driften.
export const PREFIX_MODEL = HAIKU_MODEL;

// Versie van de prefix-prompt (SP_PREFIX). Apart van INDEXERING_VERSIE zodat een
// prompt-aanpassing zónder schema-/chunkingwijziging traceerbaar blijft in
// reindex_runs.prompt_versie.
export const PREFIX_PROMPT_VERSIE = "r1-prefix-v1";

// Default max parallelle prefix-calls voor de SYNCHRONE paden. De async worker
// geeft deze waarde expliciet mee (centrale dosering, §2.1-F2), vandaar dat
// bouwChunkRecords/verrijkChunks hem als parameter accepteren.
const PREFIX_CONCURRENTIE = 5;

// Max parallelle terugschrijf-updates in het DB-pad (verrijkChunks).
const SCHRIJF_CONCURRENTIE = 8;

// Hoeveel tekens van het fragment we aan het prefix-model tonen. Ruim genoeg om
// het fragment te situeren, begrensd tegen kosten.
const PREFIX_INPUT_MAX = 1200;

// AI-BEGRENZING (besluit 0180). De eigen lazy Anthropic-client is vervangen door
// de centrale poort in core/lib/ai-poort: die bouwt de enige client en toetst
// vlak vóór elke call de kill switch en de modelallowlist. Eén ingest-document
// is één gereserveerde AI-actie; de tientallen prefix-calls daarbinnen tellen
// niet apart mee voor het quotum, maar lopen wél elk langs de poort.

export interface BouwChunksMetingen {
  chunkingMs: number;
  prefixMs: number;
  embeddingMs: number;
  embeddingRetries: number; // provider-retries (429/5xx) tijdens embedding
  embeddingRate429: number; // deel daarvan door een 429 (rate limit)
}

export interface BouwChunksResultaat {
  records: ChunkRecord[];
  aantalChunks: number;
  aantalPrefixes: number; // chunks waarvoor een prefix is gegenereerd
  embeddingsGelukt: boolean; // of de (verrijkte) embeddings zijn gevuld
  metingen: BouwChunksMetingen;
}

export interface BouwChunksOpties {
  documentId: string;
  titel: string;
  segmenten: TekstSegment[];
  // AI-BEGRENZING (besluit 0180). Verplicht: elke prefix- en embeddingcall in
  // dit pad loopt hierlangs. Geen optioneel veld met stille default — dat zou
  // een ongemeten providercall mogelijk maken.
  poort: PoortContext;
  // R1.2 — context-prefixes genereren via Haiku. Default true. Op false (of bij
  // ontbrekende ANTHROPIC_API_KEY) val je terug op baseline: geen prefix, embed
  // over `tekst`. zoek_vector blijft dan baseline (prefix NULL).
  metPrefix?: boolean;
  // Versiestempel op elke chunk. Default INDEXERING_VERSIE.
  indexeringVersie?: string | null;
  // Max parallelle prefix-calls. Default PREFIX_CONCURRENTIE; de worker doseert.
  prefixConcurrentie?: number;
}

// Korte, feitelijke situeringszin voor één fragment — het R1.2-"context-prefix".
// Bewust een STRUCTUUR-VENSTER i.p.v. het hele document: titel + structuuronderdeel
// + fragment. Goedkoop, deterministisch begrensd, en voldoende om het fragment te
// plaatsen. Best-effort: faalt het model, dan null (→ baseline voor die chunk).
const SP_PREFIX = `Je schrijft een KORTE situeringszin voor een tekstfragment uit een document van een Nederlands pensioenfonds. De zin wordt NIET aan gebruikers getoond; hij dient alleen om het fragment beter vindbaar te maken bij zoeken.

Regels:
- Eén zin, maximaal 25 woorden, in het Nederlands.
- Benoem beknopt waar het fragment over gaat en, indien gegeven, het documentonderdeel (bijv. artikel/paragraaf/tabblad).
- Voeg GEEN informatie toe die niet in het fragment of de meegegeven context staat; verzin niets.
- Geef ALLEEN de situeringszin terug, zonder aanhalingstekens of toelichting.`;

// Bouw de Messages-API-parameters voor één prefix-verzoek. Gedeeld door de
// live-baan (messages.create) én de batch-baan (batches.create requests), zodat
// beide banen exact dezelfde prompt/instellingen gebruiken (reproduceerbaarheid).
export function bouwPrefixRequestParams(
  titel: string,
  chunk: PrefixInvoer
): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const onderdeel =
    chunk.structuur_label && chunk.structuur_type && chunk.structuur_type !== "tekst"
      ? `Onderdeel: ${chunk.structuur_type} — ${chunk.structuur_label}`
      : chunk.structuur_label
        ? `Onderdeel: ${chunk.structuur_label}`
        : null;
  const locatie = [
    chunk.paragraaf ? `Paragraaf/tabblad: ${chunk.paragraaf}` : null,
    chunk.pagina != null ? `Pagina: ${chunk.pagina}` : null,
    onderdeel,
  ]
    .filter(Boolean)
    .join("\n");

  const fragment =
    chunk.tekst.length > PREFIX_INPUT_MAX
      ? chunk.tekst.slice(0, PREFIX_INPUT_MAX) + " […]"
      : chunk.tekst;

  return {
    model: PREFIX_MODEL,
    max_tokens: 120,
    // Besluit 0139 — reproduceerbare retrieval: de context-prefix bepaalt mee
    // wat geëmbed/geïndexeerd wordt. temperature:0 maakt een her-extractie van
    // dezelfde chunk reproduceerbaar (raakt de index, niet de live query).
    temperature: 0,
    system: SP_PREFIX,
    messages: [
      {
        role: "user",
        content:
          `Document: ${titel}\n` +
          (locatie ? `${locatie}\n` : "") +
          `\nFragment:\n${fragment}\n\nSitueringszin:`,
      },
    ],
  };
}

// Haal de situeringszin uit een Messages-antwoord (live of batch). Lege uitkomst
// → null (baseline voor die chunk).
function prefixUitBericht(bericht: Anthropic.Messages.Message): string | null {
  const blok = bericht.content[0];
  const ruw = blok?.type === "text" ? blok.text.trim() : "";
  return ruw.length > 0 ? ruw : null;
}

async function genereerPrefix(
  poort: PoortContext,
  titel: string,
  chunk: PrefixInvoer
): Promise<string | null> {
  try {
    const response = await bewaakteAnthropic(poort, HAIKU_MODEL, (anthropic) =>
      anthropic.messages.create(bouwPrefixRequestParams(titel, chunk))
    );
    return prefixUitBericht(response);
  } catch (e) {
    // Een gesloten poort is geen storing maar een besluit: laat hem doorgaan
    // naar de aanroeper zodat de ingest-stap netjes parkeert in plaats van het
    // document zonder prefixes af te ronden alsof dat de bedoeling was.
    if (isPoortGesloten(e)) throw e;
    console.error("[chunk-ingest] context-prefix mislukt voor één fragment:", e);
    return null;
  }
}

// Genereer prefixes PER UNIT met begrensde parallelliteit. Chunks van dezelfde
// structuur-unit (tot PREFIX_UNIT_CAP) delen één situeringszin; labelloze chunks
// krijgen elk een eigen zin. Er wordt precies één modelcall per groep gedaan
// (−36% calls op het corpus, meting §0c-7). Geeft een array even lang als
// `chunks` terug; per positie de (mogelijk gedeelde) prefix of null.
async function genereerPrefixesPerUnit(
  poort: PoortContext,
  titel: string,
  chunks: PrefixInvoer[],
  concurrentie: number
): Promise<(string | null)[]> {
  const groepVanChunk = bepaalPrefixGroepen(chunks);

  // Representant = eerste chunk-index per groep; daarop draait de ene modelcall.
  const representant = new Map<string, number>();
  groepVanChunk.forEach((g, i) => {
    if (!representant.has(g)) representant.set(g, i);
  });
  const groepen = [...representant.entries()]; // [groepsleutel, chunkIndex]
  const prefixVanGroep = new Map<string, string | null>();

  let volgende = 0;
  async function werker() {
    while (volgende < groepen.length) {
      const idx = volgende++;
      const [sleutel, chunkIndex] = groepen[idx];
      prefixVanGroep.set(sleutel, await genereerPrefix(poort, titel, chunks[chunkIndex]));
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrentie, groepen.length)) }, () =>
      werker()
    )
  );

  return groepVanChunk.map((g) => prefixVanGroep.get(g) ?? null);
}

interface VerrijkingResultaat {
  prefixes: (string | null)[];
  embeddingLiterals: (string | null)[]; // vector-literal per chunk, of null bij fout
  aantalPrefixes: number;
  embeddingsGelukt: boolean;
  prefixMs: number;
  embeddingMs: number;
  embeddingRetries: number;
  embeddingRate429: number;
}

// Gedeelde kern: genereer prefixes (per unit) + embeddings over de verrijkte
// tekst voor een reeks chunks. Puur functioneel t.o.v. opslag — de caller past
// het resultaat toe (op een ChunkRecord[] of via een DB-update). Best-effort op
// beide externe stappen: faalt de prefix, dan baseline voor die chunk; faalt de
// embedding-API, dan embeddingsGelukt=false en alle literals null.
async function genereerVerrijking(
  poort: PoortContext,
  titel: string,
  chunks: PrefixInvoer[],
  metPrefix: boolean,
  prefixConcurrentie: number
): Promise<VerrijkingResultaat> {
  const prefixAan = metPrefix && !!process.env.ANTHROPIC_API_KEY;

  const tPrefix = Date.now();
  const prefixes = prefixAan
    ? await genereerPrefixesPerUnit(poort, titel, chunks, prefixConcurrentie)
    : (new Array(chunks.length).fill(null) as (string | null)[]);
  const prefixMs = Date.now() - tPrefix;
  const aantalPrefixes = prefixes.filter((p) => p != null).length;

  const verrijkt = chunks.map((c, i) => verrijkTekst(prefixes[i], c.tekst));

  let embeddingsGelukt = false;
  let embeddingLiterals: (string | null)[] = new Array(chunks.length).fill(null);
  const embedStats: EmbedStats = { retries: 0, rate429: 0 };
  const tEmbed = Date.now();
  try {
    const vectoren = await embedTeksten(poort, verrijkt, embedStats);
    if (vectoren.length === chunks.length) {
      embeddingLiterals = vectoren.map((v) => naarVectorLiteral(v));
      embeddingsGelukt = true;
    }
  } catch (e) {
    console.error(
      "[chunk-ingest] embeddings mislukt — chunks zonder vector opgeslagen:",
      e
    );
  }
  const embeddingMs = Date.now() - tEmbed;

  return {
    prefixes,
    embeddingLiterals,
    aantalPrefixes,
    embeddingsGelukt,
    prefixMs,
    embeddingMs,
    embeddingRetries: embedStats.retries,
    embeddingRate429: embedStats.rate429,
  };
}

// Bouwt de volledige, opslagklare chunk-records voor één document: kale chunking
// (chunk-bouw) → context-prefix per unit → embedding over de verrijkte tekst.
// Dunne compositie van de pure bouw + de dure verrijking, zodat de synchrone
// paden (reindex, her-extract, generiek, upload-F0) ongewijzigd blijven werken.
export async function bouwChunkRecords(
  opties: BouwChunksOpties
): Promise<BouwChunksResultaat> {
  const {
    documentId,
    titel,
    segmenten,
    poort,
    metPrefix = true,
    indexeringVersie = INDEXERING_VERSIE,
    prefixConcurrentie = PREFIX_CONCURRENTIE,
  } = opties;

  const tChunk = Date.now();
  const records = bouwChunkRecordsZonderVerrijking({
    documentId,
    segmenten,
    indexeringVersie,
  });
  const chunkingMs = Date.now() - tChunk;

  const v = await genereerVerrijking(poort, titel, records, metPrefix, prefixConcurrentie);
  records.forEach((rec, i) => {
    rec.context_prefix = v.prefixes[i];
    rec.prefix_model = v.prefixes[i] != null ? PREFIX_MODEL : null;
    const lit = v.embeddingLiterals[i];
    if (lit != null) {
      rec.embedding = lit;
      rec.embedding_model = EMBED_MODEL;
    }
  });

  return {
    records,
    aantalChunks: records.length,
    aantalPrefixes: v.aantalPrefixes,
    embeddingsGelukt: v.embeddingsGelukt,
    metingen: {
      chunkingMs,
      prefixMs: v.prefixMs,
      embeddingMs: v.embeddingMs,
      embeddingRetries: v.embeddingRetries,
      embeddingRate429: v.embeddingRate429,
    },
  };
}

export interface VerrijkChunksOpties {
  titel: string;
  metPrefix?: boolean;
  prefixConcurrentie?: number;
  // Max chunks per aanroep (tijdbudget van de worker-invocatie). Default 200.
  limiet?: number;
}

export interface VerrijkChunksResultaat {
  verwerkt: number; // chunks die in deze ronde een embedding kregen
  resterend: number; // chunks met embedding is null ná deze ronde
  aantalPrefixes: number;
  embeddingsGelukt: boolean;
  metingen: Omit<BouwChunksMetingen, "chunkingMs"> & { schrijfMs: number };
}

interface KaleChunkRij {
  id: string;
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
  structuur_type: ChunkMetLocatie["structuur_type"] | null;
  structuur_label: string | null;
}

// DB-pad voor de async worker (F4): lees een begrensde set nog-niet-ge-embedde
// chunks van één document (order by chunk_index), genereer prefix + embedding en
// schrijf terug. HERVATBAAR: `embedding is null` ís de voortgang, dus een crash
// of tijdbudget-afbreking laat de rest gewoon voor een volgende invocatie liggen.
// Raakt UITSLUITEND chunks van het meegegeven documentId (besluit B, mitigatie 1).
//
// Schrijfpolicy: prefix én embedding worden alleen weggeschreven als de embedding
// van de hele batch slaagde (all-or-nothing per ronde). Faalt de embedding, dan
// blijft `embedding is null` staan en probeert de volgende invocatie opnieuw.
// (F4-optimalisatie, later: een geslaagde prefix vast persisteren zodat een
//  retry hem niet opnieuw genereert — nu bewust simpel gehouden.)
export async function verrijkChunks(
  supabase: SupabaseClient,
  documentId: string,
  opties: VerrijkChunksOpties
): Promise<VerrijkChunksResultaat> {
  const {
    titel,
    metPrefix = true,
    prefixConcurrentie = PREFIX_CONCURRENTIE,
    limiet = 200,
  } = opties;

  const leeg: VerrijkChunksResultaat = {
    verwerkt: 0,
    resterend: 0,
    aantalPrefixes: 0,
    embeddingsGelukt: true,
    metingen: {
      prefixMs: 0,
      embeddingMs: 0,
      embeddingRetries: 0,
      embeddingRate429: 0,
      schrijfMs: 0,
    },
  };

  const { data, error } = await supabase
    .from("document_chunks")
    .select("id, tekst, pagina, paragraaf, structuur_type, structuur_label")
    .eq("document_id", documentId)
    .is("embedding", null)
    .order("chunk_index", { ascending: true })
    .limit(limiet);

  if (error) {
    throw new Error(`verrijkChunks: chunks ophalen mislukt — ${error.message}`);
  }
  const rijen = (data ?? []) as KaleChunkRij[];
  if (rijen.length === 0) return leeg;

  const chunks: PrefixInvoer[] = rijen.map((r) => ({
    tekst: r.tekst,
    pagina: r.pagina,
    paragraaf: r.paragraaf,
    structuur_type: r.structuur_type ?? null,
    structuur_label: r.structuur_label ?? null,
  }));

  const v = await genereerVerrijking({ supabase }, titel, chunks, metPrefix, prefixConcurrentie);

  let verwerkt = 0;
  const tSchrijf = Date.now();
  if (v.embeddingsGelukt) {
    // Bounded-concurrency terugschrijven: prefix + embedding per chunk-id.
    let volgende = 0;
    async function schrijver() {
      while (volgende < rijen.length) {
        const i = volgende++;
        const lit = v.embeddingLiterals[i];
        if (lit == null) continue; // defensief; bij embeddingsGelukt niet verwacht
        const { error: upErr } = await supabase
          .from("document_chunks")
          .update({
            context_prefix: v.prefixes[i],
            prefix_model: v.prefixes[i] != null ? PREFIX_MODEL : null,
            embedding: lit,
            embedding_model: EMBED_MODEL,
          })
          .eq("id", rijen[i].id);
        if (upErr) {
          console.error(
            `[chunk-ingest] verrijkChunks: terugschrijven mislukt voor chunk ${rijen[i].id}:`,
            upErr.message
          );
        } else {
          verwerkt++;
        }
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.max(1, Math.min(SCHRIJF_CONCURRENTIE, rijen.length)) },
        () => schrijver()
      )
    );
  }
  const schrijfMs = Date.now() - tSchrijf;

  // Hoeveel chunks resteren er nog zonder embedding voor dit document?
  const { count } = await supabase
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .is("embedding", null);

  return {
    verwerkt,
    resterend: count ?? 0,
    aantalPrefixes: v.aantalPrefixes,
    embeddingsGelukt: v.embeddingsGelukt,
    metingen: {
      prefixMs: v.prefixMs,
      embeddingMs: v.embeddingMs,
      embeddingRetries: v.embeddingRetries,
      embeddingRate429: v.embeddingRate429,
      schrijfMs,
    },
  };
}

// ── Batch-baan primitieven (besluit D) ──────────────────────────────────────
// De batch-baan splitst prefix (Message Batches API — 50% goedkoper, eigen rate
// limits) van embedding (blijft live; Mistral kent geen batchpad). Zo haalt het
// bulkvolume uit het live Haiku-RPM-budget dat de reranker en chat delen (§7).

interface KaleChunkRijMetId extends PrefixInvoer {
  id: string;
  context_prefix: string | null;
}

// Lees kale chunks (embedding is null) van één document op chunk_index-volgorde,
// inclusief de bestaande context_prefix (zodat de embed-only-stap na de
// prefix-batch de al-geschreven prefix hergebruikt i.p.v. hem te regenereren).
async function leesKaleChunks(
  supabase: SupabaseClient,
  documentId: string,
  limiet?: number
): Promise<KaleChunkRijMetId[]> {
  let q = supabase
    .from("document_chunks")
    .select("id, tekst, pagina, paragraaf, structuur_type, structuur_label, context_prefix")
    .eq("document_id", documentId)
    .is("embedding", null)
    .order("chunk_index", { ascending: true });
  if (limiet != null) q = q.limit(limiet);
  const { data, error } = await q;
  if (error) throw new Error(`leesKaleChunks: ophalen mislukt — ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    tekst: r.tekst as string,
    pagina: (r.pagina as number | null) ?? null,
    paragraaf: (r.paragraaf as string | null) ?? null,
    structuur_type: (r.structuur_type as PrefixInvoer["structuur_type"]) ?? null,
    structuur_label: (r.structuur_label as string | null) ?? null,
    context_prefix: (r.context_prefix as string | null) ?? null,
  }));
}

function eersteIndexPerGroep(groepVanChunk: string[]): Map<string, number> {
  const rep = new Map<string, number>();
  groepVanChunk.forEach((g, i) => {
    if (!rep.has(g)) rep.set(g, i);
  });
  return rep;
}

export type StartBatchUitkomst =
  | { soort: "gestart"; externBatchId: string; aantalRequests: number }
  | { soort: "leeg" } // niets te prefixen (geen kale chunks of alle prefixes gezet)
  | { soort: "fout" }; // batch-API faalde → caller valt terug op de live-baan

// Start een Message Batch: één prefix-request per structuur-unit
// (custom_id = representant-chunk-id). Groepeert over ALLE nog-kale chunks in
// stabiele volgorde, zodat pasPrefixBatchToe dezelfde groepering reconstrueert.
export async function startPrefixBatch(
  supabase: SupabaseClient,
  documentId: string,
  titel: string
): Promise<StartBatchUitkomst> {
  const rijen = await leesKaleChunks(supabase, documentId);
  if (rijen.length === 0) return { soort: "leeg" };
  const groepVanChunk = bepaalPrefixGroepen(rijen);
  const representant = eersteIndexPerGroep(groepVanChunk);
  const requests = [...representant.values()]
    .filter((i) => rijen[i].context_prefix == null) // alleen units zonder prefix
    .map((i) => ({
      custom_id: rijen[i].id,
      params: bouwPrefixRequestParams(titel, rijen[i]),
    }));
  if (requests.length === 0) return { soort: "leeg" }; // alle prefixes al gezet
  try {
    const batch = await bewaakteAnthropic({ supabase }, HAIKU_MODEL, (anthropic) =>
      anthropic.messages.batches.create({ requests })
    );
    return { soort: "gestart", externBatchId: batch.id, aantalRequests: requests.length };
  } catch (e) {
    console.error("[chunk-ingest] prefix-batch aanmaken mislukt:", e);
    return { soort: "fout" };
  }
}

export type PrefixBatchStatus = "bezig" | "klaar" | "verlopen" | "fout";

// Poll de prefix-batch. Klaar ⇒ schrijf de prefixes naar ALLE chunks van elke
// unit (fan-out via bepaalPrefixGroepen; custom_id = representant). Resultaten
// komen ONGEORDEND terug — matchen UITSLUITEND op custom_id, nooit op positie
// (dit is het faalpad dat stil de index zou vergiftigen). Idempotent: al gezette
// prefixes worden overgeslagen, zodat een onderbroken write hervatbaar is.
export async function pasPrefixBatchToe(
  supabase: SupabaseClient,
  documentId: string,
  externBatchId: string
): Promise<PrefixBatchStatus> {
  let batch: Anthropic.Messages.MessageBatch;
  try {
    batch = await bewaakteAnthropic({ supabase }, HAIKU_MODEL, (anthropic) =>
      anthropic.messages.batches.retrieve(externBatchId)
    );
  } catch (e) {
    console.error("[chunk-ingest] prefix-batch ophalen mislukt:", e);
    return "fout";
  }
  if (batch.processing_status !== "ended") return "bezig";

  const prefixVanCustomId = new Map<string, string | null>();
  let verlopen = 0;
  try {
    const resultaten = await bewaakteAnthropic({ supabase }, HAIKU_MODEL, (anthropic) =>
      anthropic.messages.batches.results(externBatchId)
    );
    for await (const item of resultaten) {
      const res = item.result;
      if (res.type === "succeeded") {
        prefixVanCustomId.set(item.custom_id, prefixUitBericht(res.message));
      } else if (res.type === "expired") {
        verlopen++;
      } else {
        // errored / canceled → baseline voor die unit (prefix null).
        prefixVanCustomId.set(item.custom_id, null);
      }
    }
  } catch (e) {
    console.error("[chunk-ingest] prefix-batch resultaten lezen mislukt:", e);
    return "fout";
  }
  // Volledig verlopen → chunks blijven kaal; caller dient de batch opnieuw in.
  if (verlopen > 0 && prefixVanCustomId.size === 0) return "verlopen";

  const rijen = await leesKaleChunks(supabase, documentId);
  if (rijen.length === 0) return "klaar";
  const groepVanChunk = bepaalPrefixGroepen(rijen);
  const representant = eersteIndexPerGroep(groepVanChunk);

  let volgende = 0;
  async function schrijver() {
    while (volgende < rijen.length) {
      const i = volgende++;
      if (rijen[i].context_prefix != null) continue; // al gezet (idempotent)
      const repIndex = representant.get(groepVanChunk[i]);
      if (repIndex == null) continue;
      const repId = rijen[repIndex].id;
      if (!prefixVanCustomId.has(repId)) continue; // geen resultaat voor deze unit
      const prefix = prefixVanCustomId.get(repId) ?? null;
      const { error: upErr } = await supabase
        .from("document_chunks")
        .update({
          context_prefix: prefix,
          prefix_model: prefix != null ? PREFIX_MODEL : null,
        })
        .eq("id", rijen[i].id);
      if (upErr) {
        console.error(
          `[chunk-ingest] prefix terugschrijven mislukt voor chunk ${rijen[i].id}:`,
          upErr.message
        );
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(SCHRIJF_CONCURRENTIE, rijen.length)) }, () =>
      schrijver()
    )
  );
  return "klaar";
}

export interface EmbedBestaandeResultaat {
  verwerkt: number;
  resterend: number;
  embeddingsGelukt: boolean;
  metingen: {
    embeddingMs: number;
    embeddingRetries: number;
    embeddingRate429: number;
    schrijfMs: number;
  };
}

// Embed-only-stap voor de batch-baan: lees een begrensde set nog-kale chunks en
// embed over de REEDS geschreven context_prefix (verrijkTekst). Genereert GEEN
// prefix — die is al door de batch gezet (of bewust null = baseline).
export async function embedBestaandeChunks(
  supabase: SupabaseClient,
  documentId: string,
  limiet = 200
): Promise<EmbedBestaandeResultaat> {
  const leeg: EmbedBestaandeResultaat = {
    verwerkt: 0,
    resterend: 0,
    embeddingsGelukt: true,
    metingen: { embeddingMs: 0, embeddingRetries: 0, embeddingRate429: 0, schrijfMs: 0 },
  };
  const rijen = await leesKaleChunks(supabase, documentId, limiet);
  if (rijen.length === 0) return leeg;

  const verrijkt = rijen.map((r) => verrijkTekst(r.context_prefix, r.tekst));
  const embedStats: EmbedStats = { retries: 0, rate429: 0 };
  let vectoren: number[][] = [];
  let embeddingsGelukt = false;
  const tEmbed = Date.now();
  try {
    vectoren = await embedTeksten({ supabase }, verrijkt, embedStats);
    embeddingsGelukt = vectoren.length === rijen.length;
  } catch (e) {
    console.error("[chunk-ingest] embedBestaandeChunks: embeddings mislukt:", e);
  }
  const embeddingMs = Date.now() - tEmbed;

  let verwerkt = 0;
  const tSchrijf = Date.now();
  if (embeddingsGelukt) {
    let volgende = 0;
    async function schrijver() {
      while (volgende < rijen.length) {
        const i = volgende++;
        const { error: upErr } = await supabase
          .from("document_chunks")
          .update({ embedding: naarVectorLiteral(vectoren[i]), embedding_model: EMBED_MODEL })
          .eq("id", rijen[i].id);
        if (upErr) {
          console.error(
            `[chunk-ingest] embedBestaandeChunks: terugschrijven mislukt voor ${rijen[i].id}:`,
            upErr.message
          );
        } else {
          verwerkt++;
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(SCHRIJF_CONCURRENTIE, rijen.length)) }, () =>
        schrijver()
      )
    );
  }
  const schrijfMs = Date.now() - tSchrijf;

  const { count } = await supabase
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .is("embedding", null);

  return {
    verwerkt,
    resterend: count ?? 0,
    embeddingsGelukt,
    metingen: {
      embeddingMs,
      embeddingRetries: embedStats.retries,
      embeddingRate429: embedStats.rate429,
      schrijfMs,
    },
  };
}
