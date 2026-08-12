// ============================================================================
//  types.ts — gedeelde runtime-typen voor de S1-spike.
// ----------------------------------------------------------------------------
//  Wegwerp-spike (zie README.md). Geen productiecode: geen DB, geen RLS, geen UI.
//  Deze typen worden gedeeld door extract.ts, measure.ts en report.ts.
// ============================================================================

// De vier concepttypen uit de gesloten start-set. Bepaalt de normalisatie- en
// vergelijkingsregels (numeriek vs. string-exact vs. enum).
export type ConceptType = "percentage" | "date" | "amount" | "policy_choice";

// Eén geëxtraheerd voorkomen na normalisatie en verificatie. Dit is wat
// extract.ts naar output/units.json schrijft en measure.ts inleest.
export interface Unit {
  document: string;
  concept: string;
  type: ConceptType;
  page: number | null; // komt uit het bron-segment (PDF: paginanummer)
  section: string | null; // optionele hint van het model; niet gebruikt in matching
  value_raw: string; // letterlijk zoals het model het teruggaf
  value_normalized: number | string | null; // door ONZE normaliser, niet het model
  currency: string | null; // alleen gevuld voor amount
  evidence: string; // verbatim bronzin volgens het model
  evidence_ok: boolean; // komt de evidence letterlijk voor in de paginatekst?
  norm_ok: boolean; // lukte de normalisatie?
  model_confidence: "hoog" | "midden" | "laag";
}

// Eén golden-record op DOCUMENT×CONCEPT-niveau (ground truth). De NovaWerk-oracle
// is document-niveau: per (document, concept) de canonieke waarde die dat
// document noemt + de distractor-waarden die aanwezig zijn maar NIET aan dit
// concept horen (signaleringsgrens, foutieve testdata, ondergrens, andere
// grootheid). CORRECT = het model bindt `canonical`; MISBOUND = het model bindt
// een waarde uit `distractors` (de gevaarlijke fout). Zie README.md §Golden set.
export interface GoldenUnit {
  document: string;
  concept: string;
  type: ConceptType;
  canonical: number | string; // verwachte genormaliseerde waarde in dit document
  currency?: string | null; // alleen amount
  distractors: (number | string)[]; // genormaliseerde waarden die NIET gebonden mogen worden
  status?: string; // bv. "definitief" | "werkdocument" | "vervallen concept"
  authority_rank?: number; // gezag-rang uit de oracle (informatief)
}
