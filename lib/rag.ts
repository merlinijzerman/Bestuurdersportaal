// RAG pipeline: zoek relevante document chunks voor een vraag
import { createServerSupabase } from "./supabase-server";

export interface DocumentChunk {
  id: string;
  document_id: string;
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
  chunk_index: number;
  documenten: {
    titel: string;
    bron: string;
    bibliotheek: string;
  };
}

export interface BronVerwijzing {
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
}

// Zoek relevante chunks met Postgres full-text search + ILIKE fallback
export async function zoekRelevanteChunks(
  vraag: string,
  fondsId: string,
  maxResults = 6
): Promise<DocumentChunk[]> {
  const supabase = await createServerSupabase();

  // Schoon de zoekterm op — eenvoudige spatie-gescheiden woorden voor plainto_tsquery
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
    documenten!inner(titel, bron, bibliotheek)
  `;

  // Poging 1: full-text search met plain type (plainto_tsquery — meest robuust)
  // Inactieve documenten worden uitgesloten via filter op de joined-relatie.
  if (zoekterm.length > 0) {
    const { data, error } = await supabase
      .from("document_chunks")
      .select(selectQuery)
      .eq("documenten.actief", true)
      .textSearch("zoek_vector", zoekterm, { type: "plain", config: "dutch" })
      .limit(maxResults);

    if (!error && data && data.length > 0) {
      return data as unknown as DocumentChunk[];
    }

    // Poging 2: probeer zonder Dutch config (voor niet-Nederlandse documenten)
    const { data: data2, error: error2 } = await supabase
      .from("document_chunks")
      .select(selectQuery)
      .eq("documenten.actief", true)
      .textSearch("zoek_vector", zoekterm, { type: "plain" })
      .limit(maxResults);

    if (!error2 && data2 && data2.length > 0) {
      return data2 as unknown as DocumentChunk[];
    }
  }

  // Poging 3: ILIKE fallback op het belangrijkste trefwoord
  const trefwoorden = zoekterm.split(" ").filter((w) => w.length > 3);
  if (trefwoorden.length > 0) {
    const hoofdwoord = trefwoorden.sort((a, b) => b.length - a.length)[0];
    const { data: data3 } = await supabase
      .from("document_chunks")
      .select(selectQuery)
      .eq("documenten.actief", true)
      .ilike("tekst", `%${hoofdwoord}%`)
      .limit(maxResults);

    if (data3 && data3.length > 0) {
      return data3 as unknown as DocumentChunk[];
    }
  }

  return [];
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
    });
  });

  return {
    contextTekst: contextDelen.join("\n\n---\n\n"),
    bronnen,
  };
}

// Verwerk PDF tekst in chunks voor opslag
export function maakChunks(
  tekst: string,
  chunkGrootte = 800,
  overlap = 100
): string[] {
  // Splits op alinea's eerst
  const alineas = tekst.split(/\n{2,}/);
  const chunks: string[] = [];
  let huidig = "";

  for (const alinea of alineas) {
    if ((huidig + "\n\n" + alinea).length > chunkGrootte && huidig) {
      chunks.push(huidig.trim());
      // Overlap: pak laatste stuk van vorige chunk mee
      const woorden = huidig.split(" ");
      huidig =
        woorden.slice(-Math.floor(overlap / 6)).join(" ") +
        "\n\n" +
        alinea;
    } else {
      huidig = huidig ? huidig + "\n\n" + alinea : alinea;
    }
  }

  if (huidig.trim()) {
    chunks.push(huidig.trim());
  }

  return chunks.filter((c) => c.length > 50); // Filter te kleine chunks
}
