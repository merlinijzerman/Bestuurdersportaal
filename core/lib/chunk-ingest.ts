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
//    2. R1.2 — context-prefix per chunk (goedkoop Haiku-model) o.b.v. een
//       STRUCTUUR-VENSTER (documenttitel + structuuronderdeel + fragment). De
//       prefix situeert het fragment voor zoekbaarheid en wordt NOOIT getoond.
//    3. Embedding over de VERRIJKTE tekst (prefix + fragment), exact gelijk aan
//       wat de FTS-generated-kolom zoek_vector indexeert
//       (coalesce(context_prefix || ' ', '') || tekst). Zo zien semantische en
//       lexicale retrieval dezelfde verrijkte inhoud.
//
//  PREFIX-ISOLATIE (kernvoorwaarde): `tekst` blijft exact het originele fragment
//  en is en blijft het enige weergaveveld. De prefix leeft in een aparte kolom
//  (context_prefix) en lekt nergens in de getoonde passage of bronvermelding.
//
//  REVERSIBILITEIT: zet context_prefix = NULL → zoek_vector valt terug op
//  baseline en re-embed vanuit `tekst`. Elke chunk draagt prefix_model +
//  indexering_versie als herkomst/versie-stempel.
//
//  "server-only": raakt ANTHROPIC_API_KEY + MISTRAL_API_KEY; nooit naar de browser.
// ============================================================================

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  maakChunksUitSegmenten,
  type ChunkMetLocatie,
  type StructuurType,
} from "./chunking";
import { embedTeksten, naarVectorLiteral, EMBED_MODEL } from "./embeddings";
import { HAIKU_MODEL } from "./llm-modellen";
import type { TekstSegment } from "./document-extractie";

// Versiestempel van deze gedeelde R1.1+R1.2-indexering. Komt op elke chunk
// (indexering_versie) en stuurt de backfill-selectie (NULL/anders = nog baseline).
export const INDEXERING_VERSIE = "r1-structuur-contextueel";

// Goedkoop model voor de context-prefixes (zelfde keuze als de chat-rewrite/map).
// Centraal in lib/llm-modellen.ts zodat ingest, map-stap en reranker niet driften.
export const PREFIX_MODEL = HAIKU_MODEL;

// Versie van de prefix-prompt (SP_PREFIX). Apart van INDEXERING_VERSIE zodat een
// prompt-aanpassing zónder schema-/chunkingwijziging traceerbaar blijft in
// reindex_runs.prompt_versie.
export const PREFIX_PROMPT_VERSIE = "r1-prefix-v1";

// Max parallelle prefix-calls. Bewust laag: een document levert tientallen chunks
// en we willen Anthropic niet overvragen of de Vercel-functietimeout raken.
const PREFIX_CONCURRENTIE = 5;

// Hoeveel tekens van het fragment we aan het prefix-model tonen. Ruim genoeg om
// het fragment te situeren, begrensd tegen kosten.
const PREFIX_INPUT_MAX = 1200;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Eén opslagklare chunk-rij voor document_chunks. `tekst` is het originele
// fragment (weergaveveld); de R1-velden zijn additief en nullable.
export interface ChunkRecord {
  document_id: string;
  chunk_index: number;
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
  structuur_type: StructuurType | null;
  structuur_label: string | null;
  context_prefix: string | null;
  prefix_model: string | null;
  indexering_versie: string | null;
  embedding?: string;
  embedding_model?: string;
}

export interface BouwChunksResultaat {
  records: ChunkRecord[];
  aantalChunks: number;
  aantalPrefixes: number; // chunks waarvoor een prefix is gegenereerd
  embeddingsGelukt: boolean; // of de (verrijkte) embeddings zijn gevuld
}

export interface BouwChunksOpties {
  documentId: string;
  titel: string;
  segmenten: TekstSegment[];
  // R1.2 — context-prefixes genereren via Haiku. Default true. Op false (of bij
  // ontbrekende ANTHROPIC_API_KEY) val je terug op baseline: geen prefix, embed
  // over `tekst`. zoek_vector blijft dan baseline (prefix NULL).
  metPrefix?: boolean;
  // Versiestempel op elke chunk. Default INDEXERING_VERSIE.
  indexeringVersie?: string | null;
}

// Verrijk een fragment met zijn context-prefix voor embedding/FTS. MOET exact
// de SQL-expressie van zoek_vector spiegelen (coalesce(prefix || ' ', '') || tekst),
// zodat de embedding dezelfde verrijkte inhoud ziet als de lexicale index.
export function verrijkTekst(prefix: string | null, tekst: string): string {
  return prefix ? `${prefix} ${tekst}` : tekst;
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

async function genereerPrefix(
  titel: string,
  chunk: ChunkMetLocatie
): Promise<string | null> {
  try {
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

    const response = await anthropic.messages.create({
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
    });

    const ruw = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    return ruw.length > 0 ? ruw : null;
  } catch (e) {
    console.error("[chunk-ingest] context-prefix mislukt voor één fragment:", e);
    return null;
  }
}

// Genereer prefixes voor alle chunks met begrensde parallelliteit (volgorde
// behouden). Geeft een array even lang als `chunks` terug; per positie de
// prefix of null (bij fout/lege uitkomst).
async function genereerPrefixes(
  titel: string,
  chunks: ChunkMetLocatie[]
): Promise<(string | null)[]> {
  const resultaat: (string | null)[] = new Array(chunks.length).fill(null);
  let volgende = 0;

  async function werker() {
    while (volgende < chunks.length) {
      const i = volgende++;
      resultaat[i] = await genereerPrefix(titel, chunks[i]);
    }
  }

  const werkers = Array.from(
    { length: Math.min(PREFIX_CONCURRENTIE, chunks.length) },
    () => werker()
  );
  await Promise.all(werkers);
  return resultaat;
}

// Bouwt de volledige, opslagklare chunk-records voor één document: structuur-
// chunking → (optioneel) context-prefix → embedding over de verrijkte tekst.
// Best-effort op de twee externe stappen: faalt de prefix-generatie dan blijft
// die chunk baseline; faalt de embedding-API dan worden de chunks zonder vector
// opgeslagen (FTS blijft werken). De caller insert de records en schrijft de
// herkomst (reindex_runs) — dit blijft puur (geen Supabase-toegang hier).
export async function bouwChunkRecords(
  opties: BouwChunksOpties
): Promise<BouwChunksResultaat> {
  const {
    documentId,
    titel,
    segmenten,
    metPrefix = true,
    indexeringVersie = INDEXERING_VERSIE,
  } = opties;

  const chunks = maakChunksUitSegmenten(segmenten);

  // R1.2 — context-prefixes (best-effort, alleen met sleutel + metPrefix).
  const prefixAan = metPrefix && !!process.env.ANTHROPIC_API_KEY;
  const prefixes = prefixAan
    ? await genereerPrefixes(titel, chunks)
    : (new Array(chunks.length).fill(null) as (string | null)[]);
  const aantalPrefixes = prefixes.filter((p) => p != null).length;

  // Embedding over de VERRIJKTE tekst (prefix + fragment) — spiegelt zoek_vector.
  const verrijkt = chunks.map((c, i) => verrijkTekst(prefixes[i], c.tekst));

  const records: ChunkRecord[] = chunks.map((chunk, index) => ({
    document_id: documentId,
    chunk_index: index,
    tekst: chunk.tekst,
    pagina: chunk.pagina,
    paragraaf: chunk.paragraaf,
    structuur_type: chunk.structuur_type ?? null,
    structuur_label: chunk.structuur_label ?? null,
    context_prefix: prefixes[index],
    prefix_model: prefixes[index] != null ? PREFIX_MODEL : null,
    indexering_versie: indexeringVersie ?? null,
  }));

  let embeddingsGelukt = false;
  try {
    const vectoren = await embedTeksten(verrijkt);
    if (vectoren.length === records.length) {
      records.forEach((rec, i) => {
        rec.embedding = naarVectorLiteral(vectoren[i]);
        rec.embedding_model = EMBED_MODEL;
      });
      embeddingsGelukt = true;
    }
  } catch (e) {
    console.error(
      "[chunk-ingest] embeddings mislukt — chunks zonder vector opgeslagen:",
      e
    );
  }

  return {
    records,
    aantalChunks: records.length,
    aantalPrefixes,
    embeddingsGelukt,
  };
}
