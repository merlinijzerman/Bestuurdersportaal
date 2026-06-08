// RAG pipeline: zoek relevante document chunks voor een vraag
import { createServerSupabase } from "./supabase-server";
import { selecteerChunks } from "./rag-select";
import { embedTekst, naarVectorLiteral } from "./embeddings";

// Feature-flag (Fase C): hybride retrieval staat alleen aan als HYBRID_SEARCH
// expliciet "on" is. Default uit → niets verandert aan het zoekgedrag.
const HYBRID_ENABLED = process.env.HYBRID_SEARCH === "on";

// Pure selectie-helper opnieuw exporteren zodat bestaande imports werken.
export { selecteerChunks } from "./rag-select";

export interface DocumentChunk {
  id: string;
  document_id: string;
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
  chunk_index: number;
  // Relevantie-score uit ts_rank_cd; null bij fallback-zoekpaden zonder ranking.
  rang?: number | null;
  documenten: {
    titel: string;
    bron: string;
    bibliotheek: string;
    opslag_pad: string | null;
  };
}

// Diagnostiek per retrieval: wat is opgehaald en wat is uiteindelijk
// geselecteerd voor de prompt. Wordt insert-only weggeschreven in
// governance_log.retrieval_meta — geen wijziging aan append-only-garanties.
export interface RetrievalMeta {
  methode: "hybride_rrf" | "fts_dutch_ranked" | "fts_plain" | "ilike" | "geen";
  opgehaald: number;
  geselecteerd: number;
  chunks: { id: string; document_id: string; rang: number | null }[];
  // Hybride retrieval (Fase C). Of de query-embedding lukte en, bij terugval op
  // FTS, waarom — zodat een stille terugval zichtbaar is in het auditspoor.
  embedding_query_success?: boolean;
  fallback_reason?: string;
  // History-aware reformulatie (Fase B1). De vraag waarop daadwerkelijk is
  // gezocht, en of die afwijkt van de oorspronkelijke gebruikersvraag. Beide
  // optioneel zodat bestaande aanroepers ongemoeid blijven.
  zoekvraag?: string;
  gereformuleerd?: boolean;
  // Bronvermelding-validatie: aantal [Bron N]-citaties in het antwoord en
  // hoeveel daarvan niet naar een aangeleverde bron verwijzen (dangling).
  citaties?: { totaal: number; ongeldig: number };
}

// Platte rij zoals public.zoek_chunks(...) die teruggeeft (zie migratie
// 2026_05_30_rag_ranking.sql). Wordt naar DocumentChunk gemapt.
interface ZoekChunkRij {
  id: string;
  document_id: string;
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
  chunk_index: number;
  titel: string;
  bron: string;
  bibliotheek: string;
  opslag_pad: string | null;
  rang: number;
}

export interface BronVerwijzing {
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
  heeft_origineel: boolean;
}

// Map een platte RPC-rij naar het DocumentChunk-shape met geneste documenten.
function rijNaarChunk(r: ZoekChunkRij): DocumentChunk {
  return {
    id: r.id,
    document_id: r.document_id,
    tekst: r.tekst,
    pagina: r.pagina,
    paragraaf: r.paragraaf,
    chunk_index: r.chunk_index,
    rang: r.rang,
    documenten: {
      titel: r.titel,
      bron: r.bron,
      bibliotheek: r.bibliotheek,
      opslag_pad: r.opslag_pad,
    },
  };
}

function bouwMeta(
  methode: RetrievalMeta["methode"],
  opgehaald: number,
  geselecteerd: DocumentChunk[]
): RetrievalMeta {
  return {
    methode,
    opgehaald,
    geselecteerd: geselecteerd.length,
    chunks: geselecteerd.map((c) => ({
      id: c.id,
      document_id: c.document_id,
      rang: c.rang ?? null,
    })),
  };
}

// Hoofdingang: kiest tussen hybride retrieval (Fase C, achter de flag) en de
// bestaande FTS-route. Hybride embedt de vraag, roept de RRF-RPC aan en valt
// veilig terug op FTS als de embedding of de RPC faalt. De terugval wordt in de
// meta vastgelegd (embedding_query_success / fallback_reason) zodat een stille
// terugval zichtbaar is in het auditspoor. Tenant-isolatie loopt overal via RLS.
export async function zoekRelevanteChunksMetMeta(
  vraag: string,
  _fondsId: string,
  maxResults = 8,
  hybrideAan?: boolean
): Promise<{ chunks: DocumentChunk[]; meta: RetrievalMeta }> {
  // Per-aanroep instelling (uit het portaal) is leidend; valt terug op de
  // env-default HYBRID_SEARCH als er geen waarde is meegegeven.
  const hybride = hybrideAan ?? HYBRID_ENABLED;
  if (!hybride) {
    return zoekViaFTS(vraag, maxResults);
  }

  const supabase = await createServerSupabase();
  const overFetch = Math.max(maxResults * 3, 20);
  const maxPerDoc = Math.max(3, Math.ceil(maxResults / 2));

  // Embed de (al door B1 geherformuleerde) vraag. Faalt dat → FTS-fallback.
  let vector: number[];
  try {
    vector = await embedTekst(vraag);
  } catch (e) {
    console.error("Hybride: query-embedding mislukt, terugval op FTS:", e);
    const r = await zoekViaFTS(vraag, maxResults);
    return {
      chunks: r.chunks,
      meta: { ...r.meta, embedding_query_success: false, fallback_reason: "embedding_error" },
    };
  }

  // RRF-RPC: FTS + vector versmolten (SECURITY INVOKER → RLS blijft gelden).
  const { data, error } = await supabase.rpc("zoek_chunks_hybride", {
    p_query: vraag,
    p_embedding: naarVectorLiteral(vector),
    p_limit: overFetch,
  });

  if (!error && Array.isArray(data) && data.length > 0) {
    const gerangschikt = (data as ZoekChunkRij[]).map(rijNaarChunk);
    const geselecteerd = selecteerChunks(gerangschikt, maxResults, maxPerDoc);
    return {
      chunks: geselecteerd,
      meta: {
        ...bouwMeta("hybride_rrf", gerangschikt.length, geselecteerd),
        embedding_query_success: true,
      },
    };
  }

  // RPC faalde of leeg → terugval op FTS (embedding lukte wél).
  const r = await zoekViaFTS(vraag, maxResults);
  return {
    chunks: r.chunks,
    meta: {
      ...r.meta,
      embedding_query_success: true,
      fallback_reason: error ? "rpc_error" : "geen_hybride_treffers",
    },
  };
}

// Bestaande FTS-route mét retrieval-diagnostiek (fundament en fallback).
//
// Strategie:
//   1. RPC zoek_chunks — Dutch FTS met relevantie-sortering (ts_rank_cd),
//      over-fetch (~3× of min. 20) zodat de selectie iets te kiezen heeft.
//   2. Fallback: FTS zonder Dutch-config (niet-Nederlandse documenten).
//   3. Laatste redmiddel: ILIKE op het langste trefwoord.
// Tenant-isolatie loopt overal via RLS (de RPC is SECURITY INVOKER).
async function zoekViaFTS(
  vraag: string,
  maxResults = 8
): Promise<{ chunks: DocumentChunk[]; meta: RetrievalMeta }> {
  const supabase = await createServerSupabase();
  const overFetch = Math.max(maxResults * 3, 20);
  const maxPerDoc = Math.max(3, Math.ceil(maxResults / 2));

  // Poging 1: gerangschikte RPC (Dutch FTS + ts_rank_cd).
  const { data, error } = await supabase.rpc("zoek_chunks", {
    p_query: vraag,
    p_limit: overFetch,
  });

  if (!error && Array.isArray(data) && data.length > 0) {
    const gerangschikt = (data as ZoekChunkRij[]).map(rijNaarChunk);
    const geselecteerd = selecteerChunks(gerangschikt, maxResults, maxPerDoc);
    return {
      chunks: geselecteerd,
      meta: bouwMeta("fts_dutch_ranked", gerangschikt.length, geselecteerd),
    };
  }

  // Fallback-cascade (ongerangschikt) — vangnet als de RPC niets oplevert.
  const zoekterm = vraag
    .replace(/[?!.,;:()'"/\\]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .join(" ");

  const selectQuery = `
    id,
    document_id,
    tekst,
    pagina,
    paragraaf,
    chunk_index,
    documenten!inner(titel, bron, bibliotheek, opslag_pad)
  `;

  if (zoekterm.length > 0) {
    // Poging 2: FTS zonder Dutch-config.
    const { data: data2, error: error2 } = await supabase
      .from("document_chunks")
      .select(selectQuery)
      .eq("documenten.actief", true)
      .textSearch("zoek_vector", zoekterm, { type: "plain" })
      .limit(overFetch);

    if (!error2 && data2 && data2.length > 0) {
      const gevonden = data2 as unknown as DocumentChunk[];
      const geselecteerd = selecteerChunks(gevonden, maxResults, maxPerDoc);
      return {
        chunks: geselecteerd,
        meta: bouwMeta("fts_plain", gevonden.length, geselecteerd),
      };
    }
  }

  // Poging 3: ILIKE op het langste trefwoord.
  const trefwoorden = zoekterm.split(" ").filter((w) => w.length > 3);
  if (trefwoorden.length > 0) {
    const hoofdwoord = trefwoorden.sort((a, b) => b.length - a.length)[0];
    const { data: data3 } = await supabase
      .from("document_chunks")
      .select(selectQuery)
      .eq("documenten.actief", true)
      .ilike("tekst", `%${hoofdwoord}%`)
      .limit(overFetch);

    if (data3 && data3.length > 0) {
      const gevonden = data3 as unknown as DocumentChunk[];
      const geselecteerd = selecteerChunks(gevonden, maxResults, maxPerDoc);
      return {
        chunks: geselecteerd,
        meta: bouwMeta("ilike", gevonden.length, geselecteerd),
      };
    }
  }

  return { chunks: [], meta: bouwMeta("geen", 0, []) };
}

// Backwards-compatibele wrapper: geeft alleen de chunks terug.
export async function zoekRelevanteChunks(
  vraag: string,
  fondsId: string,
  maxResults = 8
): Promise<DocumentChunk[]> {
  const { chunks } = await zoekRelevanteChunksMetMeta(vraag, fondsId, maxResults);
  return chunks;
}

// Maak een gestructureerde context-string voor Claude
export function maakContext(chunks: DocumentChunk[]): {
  contextTekst: string;
  bronnen: BronVerwijzing[];
} {
  if (chunks.length === 0) {
    return {
      contextTekst: "Er zijn geen relevante documenten gevonden in de bibliotheek.",
      bronnen: [],
    };
  }

  const bronnen: BronVerwijzing[] = [];
  const contextDelen: string[] = [];

  chunks.forEach((chunk, index) => {
    const doc = chunk.documenten;
    const bronLabel = `[Bron ${index + 1}]`;
    const locatie = [
      chunk.paragraaf && `${chunk.paragraaf}`,
      chunk.pagina && `pag. ${chunk.pagina}`,
    ]
      .filter(Boolean)
      .join(", ");

    contextDelen.push(
      `${bronLabel} ${doc.bron} — ${doc.titel}${locatie ? ` (${locatie})` : ""}:\n"${chunk.tekst}"`
    );

    bronnen.push({
      document_id: chunk.document_id,
      titel: doc.titel,
      bron: doc.bron,
      pagina: chunk.pagina,
      paragraaf: chunk.paragraaf,
      fragment: chunk.tekst.substring(0, 150) + "...",
      heeft_origineel: !!doc.opslag_pad,
    });
  });

  return {
    contextTekst: contextDelen.join("\n\n---\n\n"),
    bronnen,
  };
}

// Chunk-helpers leven in lib/chunking.ts (Supabase-vrij, zuiver testbaar).
// Hier opnieuw geëxporteerd zodat bestaande imports uit "@/lib/rag" blijven werken.
export { maakChunks, maakChunksUitSegmenten, type ChunkMetLocatie } from "./chunking";
