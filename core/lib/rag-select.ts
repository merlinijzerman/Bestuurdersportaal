// ============================================================
//  lib/rag-select.ts — pure selectie-helpers voor RAG-retrieval.
//
//  Geen Supabase-imports, zodat dit zuiver en deterministisch te testen is
//  (zelfde principe als lib/stemming.ts). Wordt door lib/rag.ts gebruikt om
//  een op relevantie gesorteerde lijst chunks terug te knippen tot de set
//  die in de prompt belandt.
// ============================================================

// Minimaal contract dat selecteerChunks nodig heeft. DocumentChunk in
// lib/rag.ts voldoet hieraan; door generiek te werken behoudt de aanroeper
// zijn eigen, rijkere type.
export interface SelecteerbareChunk {
  id: string;
  document_id: string;
  tekst: string;
  rang?: number | null;
}

// Genormaliseerde woordset voor overlap-meting: lowercase, leestekens weg,
// woorden ≤2 tekens eruit (lidwoorden/ruis).
export function woordSet(tekst: string): Set<string> {
  return new Set(
    tekst
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

// Jaccard-similariteit tussen twee woordsets: |doorsnede| / |unie|.
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let doorsnede = 0;
  for (const w of a) if (b.has(w)) doorsnede++;
  const unie = a.size + b.size - doorsnede;
  return unie === 0 ? 0 : doorsnede / unie;
}

// Knipt een (op relevantie gesorteerde) lijst chunks terug tot de set die in
// de prompt belandt. Twee criteria zodat over-fetchen zin heeft:
//   • maxPerDocument — voorkomt dat één document de hele context vult.
//   • dedup — aangrenzende chunks delen door de overlap (zie maakChunks) vaak
//     tekst; bijna-identieke chunks voegen geen context toe.
// Behoudt de inkomende volgorde (rang-volgorde). Puur & deterministisch.
export function selecteerChunks<T extends SelecteerbareChunk>(
  chunks: T[],
  maxResults = 8,
  maxPerDocument = 3,
  dedupDrempel = 0.85
): T[] {
  const gekozen: T[] = [];
  const perDoc = new Map<string, number>();
  const woordSets: Set<string>[] = [];

  for (const chunk of chunks) {
    if (gekozen.length >= maxResults) break;

    const aantalDoc = perDoc.get(chunk.document_id) ?? 0;
    if (aantalDoc >= maxPerDocument) continue;

    const ws = woordSet(chunk.tekst);
    const isDuplicaat = woordSets.some((b) => jaccard(ws, b) >= dedupDrempel);
    if (isDuplicaat) continue;

    gekozen.push(chunk);
    perDoc.set(chunk.document_id, aantalDoc + 1);
    woordSets.push(ws);
  }

  return gekozen;
}
