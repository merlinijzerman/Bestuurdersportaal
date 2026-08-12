// ============================================================================
//  tekst.ts — kleine tekst-hulpjes, gedeeld door extract.ts en measure.ts.
// ============================================================================

// Whitespace-ongevoelige normalisatie: alle witruimte → één spatie, lowercase,
// trim. Gebruikt om te toetsen of een evidence-zin LETTERLIJK (op reflow na) in
// de paginatekst voorkomt — PDF-extractie kan regelafbrekingen anders leggen dan
// het model teruggeeft.
export function normWS(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// Komt `evidence` (whitespace-genormaliseerd) letterlijk voor in `bron`?
export function evidenceVerbatim(evidence: string, bron: string): boolean {
  const e = normWS(evidence);
  if (e.length < 3) return false;
  return normWS(bron).includes(e);
}

// Tokeniseer voor Jaccard-overlap: lowercase, leestekens weg, split op witruimte.
export function tokens(s: string): Set<string> {
  return new Set(
    normWS(s)
      .replace(/[^\p{L}\p{N}%€.,-]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
  );
}

// Jaccard-overlap tussen twee tekstfragmenten (0..1).
export function jaccard(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersectie = 0;
  for (const t of ta) if (tb.has(t)) intersectie++;
  return intersectie / (ta.size + tb.size - intersectie);
}
