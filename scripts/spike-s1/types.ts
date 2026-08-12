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

// Eén record uit de golden set (ground truth). Zie README.md §Golden set voor
// het schema en golden_set.EXAMPLE.json voor een ingevuld voorbeeld.
export interface GoldenUnit {
  document: string;
  concept: string;
  type: ConceptType;
  value_normalized: number | string;
  currency?: string | null;
  page: number | null;
  section: string | null;
  evidence: string;
}
