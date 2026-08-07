// ============================================================
//  lib/embeddings.ts — Mistral embeddings (RAG Fase C, fundament).
//
//  Server-side only: gebruikt MISTRAL_API_KEY uit de omgeving (NOOIT met
//  NEXT_PUBLIC_-prefix — de sleutel mag niet naar de browser). Dunne wrapper
//  zonder externe SDK, zodat de provider verwisselbaar blijft.
//
//  Model: `mistral-embed` → 1024 dimensies, exact passend op de kolom
//  document_chunks.embedding vector(1024). Geen dimensiereductie nodig.
// ============================================================

const EMBED_URL = "https://api.mistral.ai/v1/embeddings";

// Centrale config — wisselen van model/dim vergt een volledige re-embed, dus
// nooit verspreid hardcoderen. `embedding_model` wordt bij elke chunk vastgelegd.
export const EMBED_PROVIDER = "mistral";
export const EMBED_MODEL = "mistral-embed";
export const EMBED_DIMS = 1024;

// Mistral-limieten per embeddings-verzoek: max 128 items én max ~16.384 tokens.
// We batchen op beide: een ruim item-maximum én een conservatief tekenbudget
// (~4 tekens/token → 24.000 tekens ≈ ~6.000 tokens, veilig onder de limiet).
const MAX_BATCH_ITEMS = 64;
const MAX_BATCH_CHARS = 24000;
const MAX_RETRIES = 3;

function slaap(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// F0.1 (bouwticket async-ingest v2.1) — optionele teller voor provider-retries.
// Vóór dit ticket werd een 429/5xx stil weggeslikt (alleen een retry, geen
// signaal), waardoor de nulmeting niet kon zien of de embedding-stap tegen de
// Mistral-rate-limit aanliep. De teller telt UITSLUITEND echte provider-retries;
// hij scant geen logs en vangt dus geen betekenisloze ruis op (zoals de
// DEP0169-deprecatiewaarschuwing van een dependency) — die hoort niet in de
// errortelling van de ingest. Optioneel: bestaande callers blijven ongewijzigd.
export interface EmbedStats {
  /** Aantal herhaalde pogingen na een tijdelijke fout (429 of 5xx). */
  retries: number;
  /** Deel van `retries` dat door een 429 (rate limit) kwam. */
  rate429: number;
}

// Embed één batch (≤ MAX_BATCH teksten), met retry/backoff op rate limits (429)
// en tijdelijke serverfouten (5xx). Andere fouten falen direct.
async function embedBatch(teksten: string[], stats?: EmbedStats): Promise<number[][]> {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("MISTRAL_API_KEY ontbreekt in de omgeving");

  for (let poging = 0; poging <= MAX_RETRIES; poging++) {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: teksten }),
    });

    if (res.ok) {
      const data = (await res.json()) as { data: { embedding: number[] }[] };
      return data.data.map((d) => d.embedding);
    }

    const tijdelijk = res.status === 429 || res.status >= 500;
    if (tijdelijk && poging < MAX_RETRIES) {
      if (stats) {
        stats.retries++;
        if (res.status === 429) stats.rate429++;
      }
      await slaap(500 * 2 ** poging); // 0,5s → 1s → 2s
      continue;
    }
    throw new Error(`Mistral embeddings ${res.status}`);
  }
  throw new Error("Mistral embeddings: max retries overschreden");
}

// Embed een willekeurig aantal teksten; splitst automatisch in batches die
// binnen Mistral's item- én tokenlimiet per verzoek blijven. Een enkele zeer
// lange tekst gaat alleen in zijn eigen batch (chunks zijn normaal ~800 tekens,
// ruim onder de per-document-limiet). Gebruikt bij ingest en backfill.
export async function embedTeksten(
  teksten: string[],
  stats?: EmbedStats
): Promise<number[][]> {
  const resultaat: number[][] = [];
  let i = 0;
  while (i < teksten.length) {
    const batch: string[] = [];
    let chars = 0;
    while (
      i < teksten.length &&
      batch.length < MAX_BATCH_ITEMS &&
      (batch.length === 0 || chars + teksten[i].length <= MAX_BATCH_CHARS)
    ) {
      chars += teksten[i].length;
      batch.push(teksten[i]);
      i++;
    }
    resultaat.push(...(await embedBatch(batch, stats)));
  }
  return resultaat;
}

// Eén tekst embedden (bijv. een zoekvraag bij retrieval).
export async function embedTekst(tekst: string): Promise<number[]> {
  const [vector] = await embedTeksten([tekst]);
  return vector;
}

// pgvector verwacht via supabase-js een vector-literal als string ('[1,2,3]'),
// zowel bij insert/update als bij RPC-parameters.
export function naarVectorLiteral(vector: number[]): string {
  return JSON.stringify(vector);
}
