// RAG pipeline: zoek relevante document chunks voor een vraag
import { createServerSupabase } from "./supabase-server";
import { selecteerChunks } from "./rag-select";
import { embedTekst, naarVectorLiteral } from "./embeddings";
import { notulenBronLabel } from "./notulen";
import type { RetrievalModus } from "./vraagtype";
import { weegBronsoort, type Bronsoortprofiel } from "./weeg-bronsoort";

// Increment G — optionele, additieve retrieval-filters (vóór ranking/RRF in de
// RPC's; defaults reproduceren huidig gedrag). De velden zijn gedenormaliseerd
// op document_chunks (increment E + C+/B13), dus filtering vereist geen join.
export interface RetrievalFilters {
  modus?: RetrievalModus; // 'actueel'|'historisch'|'besluitvorming'|'alles'
  peildatum?: string; // ISO YYYY-MM-DD; default current_date (server-side)
  bronstatus?: string[] | null;
  documentstatus?: string[] | null;
  procesinstantie_ids?: string[] | null;
  bronsoort?: string[] | null;
  // Increment G — bronsoort-WEGING (rang-boost, pure TS): herordent de
  // kandidatenset vóór de top-N-selectie zodat de primaire bronsoort vóór de
  // aanvullende komt. Geen harde uitsluiting (anders dan p_bronsoort hierboven).
  bronsoortprofiel?: Bronsoortprofiel;
}

// Past de bronsoort-weging toe (indien een profiel is gezet) en knipt dan terug
// tot de prompt-set. De weging gebeurt VÓÓR selecteerChunks — dat behoudt de
// inkomende volgorde, dus de boost werkt door in welke chunks de top-N halen.
function weegEnSelecteer(
  gerangschikt: DocumentChunk[],
  filters: RetrievalFilters | undefined,
  maxResults: number,
  maxPerDoc: number
): DocumentChunk[] {
  const gewogen = filters?.bronsoortprofiel
    ? weegBronsoort(gerangschikt, (c) => c.documenten.bibliotheek, filters.bronsoortprofiel)
    : gerangschikt;
  return selecteerChunks(gewogen, maxResults, maxPerDoc);
}

// Bouwt het RPC-parameterblok voor de filters. Alleen gezette velden worden
// meegegeven; ontbrekende keys laten de SQL-defaults (huidig gedrag) intact.
function rpcFilterParams(filters?: RetrievalFilters): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (!filters) return p;
  if (filters.modus) p.p_modus = filters.modus;
  if (filters.peildatum) p.p_peildatum = filters.peildatum;
  if (filters.bronstatus) p.p_bronstatus = filters.bronstatus;
  if (filters.documentstatus) p.p_documentstatus = filters.documentstatus;
  if (filters.procesinstantie_ids) p.p_procesinstantie_ids = filters.procesinstantie_ids;
  if (filters.bronsoort) p.p_bronsoort = filters.bronsoort;
  return p;
}

// Diagnostiek-vorm van de toegepaste filters voor governance_log.retrieval_meta.
function metaFilters(filters?: RetrievalFilters): RetrievalMeta["filters"] {
  if (!filters) return undefined;
  return {
    modus: filters.modus ?? "alles",
    peildatum: filters.peildatum ?? new Date().toISOString().slice(0, 10),
    bronstatus: filters.bronstatus ?? null,
    documentstatus: filters.documentstatus ?? null,
    procesinstantie_ids: filters.procesinstantie_ids ?? null,
    bronsoort: filters.bronsoort ?? null,
  };
}

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
    // Increment G — gedenormaliseerde bronkaart-/weging-/auditvelden (optioneel;
    // de fallback-cascade levert ze niet, de RPC's wel).
    documentstatus?: string | null;
    bronstatus?: string | null;
    documentdatum?: string | null;
    geldig_vanaf?: string | null;
    geldig_tot?: string | null;
    procesinstantie_id?: string | null;
    bronorganisatie?: string | null;
    normgewicht?: string | null;
    extern_url?: string | null;
  };
  // Increment D — aanwezig zodra de chunk uit een bevestigd notulensegment komt.
  // Gevuld door verrijkNotulenChunks() ná retrieval (de RPC's leveren dit niet);
  // stuurt de bronvermelding "Vastgestelde notulen [verg], agendapunt N — [titel]".
  notulen?: {
    vergadering_titel: string;
    agendapunt_volgnummer: number | null;
    agendapunt_titel: string | null;
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
  // Document-scope (increment 1/2). Aanwezig zodra een vraag tot één/enkele
  // document(en) is beperkt; legt voor de audit vast waarop gescoopt is en welke
  // retrievalstrategie is gekozen.
  scope?: {
    document_ids: string[];
    titels: string[];
    strategie: "targeted" | "full_document" | "map_reduce";
    algemene_kennis: boolean;
    // Increment 2: bij dekkingsbrede strategieën — hoeveel chunks verwerkt en
    // (bij map-reduce) in hoeveel batches; afgekapt = dekking gedeeltelijk.
    verwerkte_chunks?: number;
    batches?: number;
    afgekapt?: boolean;
  };
  // Increment G — de toegepaste retrieval-filters (status/bronstatus/modus/
  // peildatum/bronsoort/procesinstantie). Append-only auditspoor (test #6).
  filters?: {
    modus: RetrievalModus;
    peildatum: string;
    bronstatus?: string[] | null;
    documentstatus?: string[] | null;
    procesinstantie_ids?: string[] | null;
    bronsoort?: string[] | null;
  };
  // Increment G — de actieve antwoordmodus (feitelijk|duiding|sparring|…) en, in
  // besluitvorming-modus, hoeveel Decision Object-besluitbronnen zijn meegenomen.
  antwoordmodus?: string;
  besluitbronnen?: number;
  // Increment I-1 (FO §11d) — auditspoor van de presentatielaag, zodat de
  // (verborgen) bronbasis en getoonde inline-meldingen volledig vastliggen ook
  // nu ze niet meer standaard zichtbaar zijn. Verandert niets aan retrieval.
  bronbasis?: string;
  inline_meldingen?: { type: string; tekst: string }[];
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
  // Increment G — denorm-velden uit de uitgebreide RPC-return.
  documentstatus?: string | null;
  bronstatus?: string | null;
  documentdatum?: string | null;
  geldig_vanaf?: string | null;
  geldig_tot?: string | null;
  procesinstantie_id?: string | null;
  bronorganisatie?: string | null;
  normgewicht?: string | null;
  extern_url?: string | null;
}

export interface BronVerwijzing {
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
  heeft_origineel: boolean;
  // Increment G — bronkaartvelden (status/bronstatus/datum/bronsoort + generiek-
  // metadata). Optioneel: de fallback-cascade levert ze niet.
  documentstatus?: string | null;
  bronstatus?: string | null;
  documentdatum?: string | null;
  geldig_tot?: string | null;
  bibliotheek?: string | null;
  bronorganisatie?: string | null;
  normgewicht?: string | null;
  extern_url?: string | null;
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
      documentstatus: r.documentstatus ?? null,
      bronstatus: r.bronstatus ?? null,
      documentdatum: r.documentdatum ?? null,
      geldig_vanaf: r.geldig_vanaf ?? null,
      geldig_tot: r.geldig_tot ?? null,
      procesinstantie_id: r.procesinstantie_id ?? null,
      bronorganisatie: r.bronorganisatie ?? null,
      normgewicht: r.normgewicht ?? null,
      extern_url: r.extern_url ?? null,
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
  hybrideAan?: boolean,
  documentIds?: string[],
  filters?: RetrievalFilters
): Promise<{ chunks: DocumentChunk[]; meta: RetrievalMeta }> {
  // Documentscope (increment 1): null = hele bibliotheek. Wordt vóór ranking in
  // de RPC's toegepast. Onafhankelijk van de (mogelijk geherformuleerde) vraag,
  // zodat reformulatie de scope nooit kan wijzigen.
  const scope = documentIds && documentIds.length > 0 ? documentIds : null;

  // Per-aanroep instelling (uit het portaal) is leidend; valt terug op de
  // env-default HYBRID_SEARCH als er geen waarde is meegegeven.
  const hybride = hybrideAan ?? HYBRID_ENABLED;
  if (!hybride) {
    return zoekViaFTS(vraag, maxResults, scope, filters);
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
    const r = await zoekViaFTS(vraag, maxResults, scope, filters);
    return {
      chunks: r.chunks,
      meta: { ...r.meta, embedding_query_success: false, fallback_reason: "embedding_error" },
    };
  }

  // RRF-RPC: FTS + vector versmolten (SECURITY INVOKER → RLS blijft gelden).
  // p_document_ids = scope vóór de fusion (null = hele bibliotheek).
  // Increment G — retrieval-filters worden vóór de fusion in beide armen toegepast.
  const { data, error } = await supabase.rpc("zoek_chunks_hybride", {
    p_query: vraag,
    p_embedding: naarVectorLiteral(vector),
    p_limit: overFetch,
    p_document_ids: scope,
    ...rpcFilterParams(filters),
  });

  if (!error && Array.isArray(data) && data.length > 0) {
    const gerangschikt = (data as ZoekChunkRij[]).map(rijNaarChunk);
    const geselecteerd = weegEnSelecteer(gerangschikt, filters, maxResults, maxPerDoc);
    return {
      chunks: geselecteerd,
      meta: {
        ...bouwMeta("hybride_rrf", gerangschikt.length, geselecteerd),
        embedding_query_success: true,
        filters: metaFilters(filters),
      },
    };
  }

  // RPC faalde of leeg → terugval op FTS (embedding lukte wél).
  const r = await zoekViaFTS(vraag, maxResults, scope, filters);
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
  maxResults = 8,
  scope: string[] | null = null,
  filters?: RetrievalFilters
): Promise<{ chunks: DocumentChunk[]; meta: RetrievalMeta }> {
  const supabase = await createServerSupabase();
  const overFetch = Math.max(maxResults * 3, 20);
  const maxPerDoc = Math.max(3, Math.ceil(maxResults / 2));
  const fMeta = metaFilters(filters);

  // Poging 1: gerangschikte RPC (Dutch FTS + ts_rank_cd).
  // p_document_ids = scope vóór ranking (null = hele bibliotheek).
  // Increment G — retrieval-filters vóór ranking in de RPC.
  const { data, error } = await supabase.rpc("zoek_chunks", {
    p_query: vraag,
    p_limit: overFetch,
    p_document_ids: scope,
    ...rpcFilterParams(filters),
  });

  if (!error && Array.isArray(data) && data.length > 0) {
    const gerangschikt = (data as ZoekChunkRij[]).map(rijNaarChunk);
    const geselecteerd = weegEnSelecteer(gerangschikt, filters, maxResults, maxPerDoc);
    return {
      chunks: geselecteerd,
      meta: { ...bouwMeta("fts_dutch_ranked", gerangschikt.length, geselecteerd), filters: fMeta },
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
    // Poging 2: FTS zonder Dutch-config. Scope ook hier toepassen, anders zou
    // het vangnet buiten het gescopete document kunnen lekken.
    let q2 = supabase
      .from("document_chunks")
      .select(selectQuery)
      .eq("documenten.actief", true)
      .textSearch("zoek_vector", zoekterm, { type: "plain" })
      .limit(overFetch);
    if (scope) q2 = q2.in("document_id", scope);
    // Increment G — filters ook op het vangnet (geen lek langs de modusfilter).
    if (filters?.modus === "actueel") {
      const peil = filters.peildatum ?? new Date().toISOString().slice(0, 10);
      q2 = q2
        .in("documentstatus", ["vastgesteld", "van_kracht"])
        .or("bronstatus.is.null,bronstatus.eq.actief")
        .or(`geldig_vanaf.is.null,geldig_vanaf.lte.${peil}`)
        .or(`geldig_tot.is.null,geldig_tot.gte.${peil}`);
    }
    if (filters?.bronstatus) q2 = q2.in("bronstatus", filters.bronstatus);
    if (filters?.documentstatus) q2 = q2.in("documentstatus", filters.documentstatus);
    if (filters?.procesinstantie_ids) q2 = q2.in("procesinstantie_id", filters.procesinstantie_ids);
    if (filters?.bronsoort) q2 = q2.in("bibliotheek", filters.bronsoort);
    const { data: data2, error: error2 } = await q2;

    if (!error2 && data2 && data2.length > 0) {
      const gevonden = data2 as unknown as DocumentChunk[];
      const geselecteerd = weegEnSelecteer(gevonden, filters, maxResults, maxPerDoc);
      return {
        chunks: geselecteerd,
        meta: { ...bouwMeta("fts_plain", gevonden.length, geselecteerd), filters: fMeta },
      };
    }
  }

  // Poging 3: ILIKE op het langste trefwoord.
  const trefwoorden = zoekterm.split(" ").filter((w) => w.length > 3);
  if (trefwoorden.length > 0) {
    const hoofdwoord = trefwoorden.sort((a, b) => b.length - a.length)[0];
    let q3 = supabase
      .from("document_chunks")
      .select(selectQuery)
      .eq("documenten.actief", true)
      .ilike("tekst", `%${hoofdwoord}%`)
      .limit(overFetch);
    if (scope) q3 = q3.in("document_id", scope);
    // Increment G — zelfde filters op het laatste vangnet.
    if (filters?.modus === "actueel") {
      const peil = filters.peildatum ?? new Date().toISOString().slice(0, 10);
      q3 = q3
        .in("documentstatus", ["vastgesteld", "van_kracht"])
        .or("bronstatus.is.null,bronstatus.eq.actief")
        .or(`geldig_vanaf.is.null,geldig_vanaf.lte.${peil}`)
        .or(`geldig_tot.is.null,geldig_tot.gte.${peil}`);
    }
    if (filters?.bronstatus) q3 = q3.in("bronstatus", filters.bronstatus);
    if (filters?.documentstatus) q3 = q3.in("documentstatus", filters.documentstatus);
    if (filters?.procesinstantie_ids) q3 = q3.in("procesinstantie_id", filters.procesinstantie_ids);
    if (filters?.bronsoort) q3 = q3.in("bibliotheek", filters.bronsoort);
    const { data: data3 } = await q3;

    if (data3 && data3.length > 0) {
      const gevonden = data3 as unknown as DocumentChunk[];
      const geselecteerd = weegEnSelecteer(gevonden, filters, maxResults, maxPerDoc);
      return {
        chunks: geselecteerd,
        meta: { ...bouwMeta("ilike", gevonden.length, geselecteerd), filters: fMeta },
      };
    }
  }

  return { chunks: [], meta: { ...bouwMeta("geen", 0, []), filters: fMeta } };
}

// Backwards-compatibele wrapper: geeft alleen de chunks terug.
export async function zoekRelevanteChunks(
  vraag: string,
  fondsId: string,
  maxResults = 8,
  filters?: RetrievalFilters
): Promise<DocumentChunk[]> {
  const { chunks } = await zoekRelevanteChunksMetMeta(
    vraag,
    fondsId,
    maxResults,
    undefined,
    undefined,
    filters
  );
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

    // Increment D — notulensegmenten dragen een agendapunt-specifieke bronvermelding
    // ("Vastgestelde notulen [verg], agendapunt N — [titel]"); overige chunks houden
    // het bestaande "[bron] — [titel]"-label.
    const bronTitel = chunk.notulen
      ? notulenBronLabel(
          chunk.notulen.vergadering_titel,
          chunk.notulen.agendapunt_volgnummer,
          chunk.notulen.agendapunt_titel
        )
      : `${doc.bron} — ${doc.titel}`;

    // Increment G — generieke bronnen expliciet labelen, zodat het model ze niet
    // presenteert als door het fonds bestuurlijk vastgesteld (#22/#23). Het label
    // staat in de contextregel; de gestructureerde velden gaan mee in `bronnen`.
    const bronsoortLabel =
      doc.bibliotheek === "generiek"
        ? ` [generiek/extern kader${doc.bronorganisatie ? ` — ${doc.bronorganisatie}` : ""}]`
        : "";

    contextDelen.push(
      `${bronLabel} ${bronTitel}${bronsoortLabel}${locatie ? ` (${locatie})` : ""}:\n"${chunk.tekst}"`
    );

    bronnen.push({
      document_id: chunk.document_id,
      titel: chunk.notulen ? bronTitel : doc.titel,
      bron: doc.bron,
      pagina: chunk.pagina,
      paragraaf: chunk.paragraaf,
      fragment: chunk.tekst.substring(0, 150) + "...",
      heeft_origineel: !!doc.opslag_pad,
      documentstatus: doc.documentstatus ?? null,
      bronstatus: doc.bronstatus ?? null,
      documentdatum: doc.documentdatum ?? null,
      geldig_tot: doc.geldig_tot ?? null,
      bibliotheek: doc.bibliotheek ?? null,
      bronorganisatie: doc.bronorganisatie ?? null,
      normgewicht: doc.normgewicht ?? null,
      extern_url: doc.extern_url ?? null,
    });
  });

  return {
    contextTekst: contextDelen.join("\n\n---\n\n"),
    bronnen,
  };
}

// Haalt ALLE chunks van de gescopete document(en) op, geordend op document en
// chunk-index — voor de dekkingsbrede strategieën van increment 2 (full-document
// en map-reduce). Géén ranking: bij een samenvatting/beoordeling wil je het
// volledige document, niet de top-N. RLS blijft leidend (anon-client); de
// scope-filter (`.in("document_id", …)`) is een AND bovenop de fonds-isolatie.
export async function haalDocumentChunks(
  documentIds: string[]
): Promise<DocumentChunk[]> {
  if (documentIds.length === 0) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("document_chunks")
    .select(
      `id, document_id, tekst, pagina, paragraaf, chunk_index,
       documenten!inner(titel, bron, bibliotheek, opslag_pad)`
    )
    .in("document_id", documentIds)
    .eq("documenten.actief", true)
    .order("document_id", { ascending: true })
    .order("chunk_index", { ascending: true })
    .limit(5000); // veiligheidsplafond tegen extreem grote documenten

  if (error || !data) {
    console.error("haalDocumentChunks fout:", error);
    return [];
  }
  return data as unknown as DocumentChunk[];
}

// Increment D — verrijk opgehaalde chunks met de vergadering/agendapunt van hun
// bevestigde notulensegment, zodat maakContext de bronvermelding "Vastgestelde
// notulen [verg], agendapunt N — [titel]" kan renderen. De retrieval-RPC's
// (zoek_chunks/zoek_chunks_hybride) leveren dit NIET en blijven ongewijzigd; dit
// is één gebatchte vervolgquery op de chunk-id's. RLS-veilig (anon-client). Muteert
// de meegegeven chunks in-place en geeft ze terug.
export async function verrijkNotulenChunks(
  chunks: DocumentChunk[]
): Promise<DocumentChunk[]> {
  if (chunks.length === 0) return chunks;
  const supabase = await createServerSupabase();
  const ids = chunks.map((c) => c.id);

  const { data, error } = await supabase
    .from("document_chunks")
    .select(
      `id,
       notulen_segment_id,
       notulen_segmenten!inner(
         agendapunt_id,
         agendapunten(volgorde, titel),
         vergaderingen!inner(titel)
       )`
    )
    .in("id", ids)
    .not("notulen_segment_id", "is", null);

  if (error || !data || data.length === 0) return chunks;

  const perChunk = new Map<string, DocumentChunk["notulen"]>();
  for (const rij of data as unknown as NotulenVerrijkingRij[]) {
    const seg = rij.notulen_segmenten;
    if (!seg) continue;
    perChunk.set(rij.id, {
      vergadering_titel: seg.vergaderingen?.titel ?? "vergadering",
      agendapunt_volgnummer: seg.agendapunten?.volgorde ?? null,
      agendapunt_titel: seg.agendapunten?.titel ?? null,
    });
  }

  for (const c of chunks) {
    const n = perChunk.get(c.id);
    if (n) c.notulen = n;
  }
  return chunks;
}

// Vorm van de verrijkingsquery hierboven (PostgREST nest embedded relaties).
interface NotulenVerrijkingRij {
  id: string;
  notulen_segment_id: string | null;
  notulen_segmenten: {
    agendapunt_id: string | null;
    agendapunten: { volgorde: number | null; titel: string | null } | null;
    vergaderingen: { titel: string | null } | null;
  } | null;
}

// Chunk-helpers leven in lib/chunking.ts (Supabase-vrij, zuiver testbaar).
// Hier opnieuw geëxporteerd zodat bestaande imports uit "@/lib/rag" blijven werken.
export { maakChunks, maakChunksUitSegmenten, type ChunkMetLocatie } from "./chunking";
