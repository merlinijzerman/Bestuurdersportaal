// RAG pipeline: zoek relevante document chunks voor een vraag
import { createServerSupabase } from "./supabase-server";
import { selecteerChunks } from "./rag-select";

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
  methode: "fts_dutch_ranked" | "fts_plain" | "ilike" | "geen";
  opgehaald: number;
  geselecteerd: number;
  chunks: { id: string; document_id: string; rang: number | null }[];
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

// Zoek relevante chunks mét retrieval-diagnostiek.
//
// Strategie:
//   1. RPC zoek_chunks — Dutch FTS met relevantie-sortering (ts_rank_cd),
//      over-fetch (~3× of min. 20) zodat de selectie iets te kiezen heeft.
//   2. Fallback: FTS zonder Dutch-config (niet-Nederlandse documenten).
//   3. Laatste redmiddel: ILIKE op het langste trefwoord.
// Tenant-isolatie loopt overal via RLS (de RPC is SECURITY INVOKER).
export async function zoekRelevanteChunksMetMeta(
  vraag: string,
  _fondsId: string,
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

// Verwerk geëxtraheerde tekst in chunks voor RAG-opslag.
//
// Strategie — drie niveaus van splitsing, in afnemende kwaliteit:
//   1. Paragrafen (\n{2,})   → ideaal, behoudt semantische blokken
//   2. Zinnen (. / ? / !)    → fallback als een paragraaf > chunkGrootte is
//   3. Woorden (spaties)     → laatste redmiddel; voorkomt afkappen midden-woord
//
// Tussen chunks houden we een kleine overlap aan zodat zoek-hits aan de rand
// van een chunk nog context meekrijgen.
export function maakChunks(
  tekst: string,
  chunkGrootte = 800,
  overlap = 100
): string[] {
  // Stap 1: splits op paragraaf-grenzen.
  const alineas = tekst.split(/\n{2,}/).map((a) => a.trim()).filter(Boolean);

  // Stap 2: splits te grote alinea's verder op zinsgrenzen, en zinnen die
  // nog steeds te groot zijn op woordgrenzen. Resultaat: een lijst van
  // "atomen" die elk binnen chunkGrootte passen.
  const atomen: string[] = [];
  for (const alinea of alineas) {
    if (alinea.length <= chunkGrootte) {
      atomen.push(alinea);
    } else {
      atomen.push(...splitsOpZinnen(alinea, chunkGrootte));
    }
  }

  // Stap 3: pak atomen samen tot chunks die ongeveer chunkGrootte groot zijn.
  const chunks: string[] = [];
  let huidig = "";
  for (const atoom of atomen) {
    if ((huidig + "\n\n" + atoom).length > chunkGrootte && huidig) {
      chunks.push(huidig.trim());
      // Overlap: pak laatste paar woorden van de vorige chunk mee als context.
      const woorden = huidig.split(/\s+/);
      const overlapWoorden = Math.max(1, Math.floor(overlap / 6));
      huidig = woorden.slice(-overlapWoorden).join(" ") + "\n\n" + atoom;
    } else {
      huidig = huidig ? huidig + "\n\n" + atoom : atoom;
    }
  }

  if (huidig.trim()) {
    chunks.push(huidig.trim());
  }

  return chunks.filter((c) => c.length > 50); // Filter te kleine chunks
}

// Splits een (te groot) tekstblok op zinsgrenzen. Als één zin zelf nog te
// groot is (zeldzaam, maar bv. juridische opsommingen) splitsen we op woorden.
function splitsOpZinnen(blok: string, maxGrootte: number): string[] {
  // Zinsgrens: punt/vraagteken/uitroepteken gevolgd door whitespace en hoofdletter
  // of einde-tekst. Houdt afkortingen niet 100% goed maar is robuust genoeg
  // voor Nederlandse bestuursdocumenten.
  const zinnen = blok
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((z) => z.trim())
    .filter(Boolean);

  const result: string[] = [];
  for (const zin of zinnen) {
    if (zin.length <= maxGrootte) {
      result.push(zin);
    } else {
      // Zin nog steeds te groot — splits op woordgrenzen.
      result.push(...splitsOpWoorden(zin, maxGrootte));
    }
  }
  return result;
}

function splitsOpWoorden(tekst: string, maxGrootte: number): string[] {
  const woorden = tekst.split(/\s+/);
  const result: string[] = [];
  let huidig = "";
  for (const woord of woorden) {
    if ((huidig + " " + woord).length > maxGrootte && huidig) {
      result.push(huidig);
      huidig = woord;
    } else {
      huidig = huidig ? huidig + " " + woord : woord;
    }
  }
  if (huidig) result.push(huidig);
  return result;
}
