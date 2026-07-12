// lib/aqlab/checks/types.ts
// -----------------------------------------------------------------------------
// AQLab — gedeelde types voor de auto-check-bibliotheek (AQL-2, technisch §5.4).
// Pure, deterministische/heuristische checks: elke check retourneert
// {score, pass, motivatie, findings, methode}. Geen I/O, geen model-calls.
// -----------------------------------------------------------------------------

/** Bevindingstype — 1:1 met aqlab_findings.type (migratie aqlab_2). */
export type FindingType =
  | "hallucinatie"
  | "bron_ontbreekt"
  | "format"
  | "autorisatie"
  | "herkomstlabel"
  | "overig";

/** Ernst — 1:1 met aqlab_findings.ernst. `kritiek` (open) blokkeert de pass. */
export type Ernst = "kritiek" | "hoog" | "middel" | "laag";

export interface Finding {
  type: FindingType;
  ernst: Ernst;
  omschrijving: string;
  fragment?: string;
}

/** Auto-check-methode (det/heur). De DB-mapping (aqlab_scores.methode) gebeurt in de engine. */
export type AutoCheckMethode = "deterministisch" | "heuristisch";

export interface CheckUitkomst {
  /** 0-100. Voor pass/fail-checks: pass ? 100 : 0. */
  score: number;
  pass: boolean;
  motivatie: string;
  findings: Finding[];
  methode: AutoCheckMethode;
}

/**
 * De relevante velden uit aqlab_test_cases.spec (jsonb = het volledige seed-
 * testcase-object). Alles optioneel — de checks lezen defensief.
 */
export interface TestcaseSpec {
  expected_answer_outline?: {
    must_contain?: string[];
    exact_facts?: string[];
    may_vary?: string[];
    forbidden?: string[];
  };
  forbidden_claims?: string[];
  required_sections?: string[];
  required_source_ids?: string[];
  excluded_source_ids?: string[];
  dimension_floors?: Record<string, number>;
  /** Getal (0-100) of de sentinel 'binair' voor pass/fail-securitycases. */
  min_quality_score?: number | string;
  /** Expliciete blokkadecriteria (criterium-keys) voor deze testcase. */
  blokkadecriteria?: string[];
  checks?: string[];
  expected_uncertainty_behavior?: string;
  avg_scope_in?: string[];
  soort?: string;
  kritikaliteit?: string;
  review_required?: boolean;
}

/** Input voor één auto-check op één output. */
export interface CheckInput {
  /** Het (zichtbare) gegenereerde antwoord. */
  antwoord: string;
  /** Aantal aangeleverde [Bron N]-bronnen (labels 1..N zijn geldig). */
  bronnenAantal: number;
  /** De testcase-spec (defensief gelezen). */
  spec: TestcaseSpec;
  /** Optioneel: snapshot-/retrieval-refs (fixture-ID's) voor lek-detectie. */
  snapshotRefs?: string[];
}

/** Signatuur van een pure auto-check. */
export type AutoCheck = (input: CheckInput) => CheckUitkomst;
