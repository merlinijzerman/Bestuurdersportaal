// lib/aqlab/checks/index.ts
// -----------------------------------------------------------------------------
// AQLab — auto-check-registry (AQL-2, technisch §5.4).
//
// Koppelt de deterministische/heuristische criterium-codes uit
// lib/aqlab/criteria.ts aan hun pure check-functie. De judge-criteria
// (claim_matches_source_semantic, risk_duiding_correct, no_forbidden_claim) en
// human_review staan hier NIET: die lopen via lib/aqlab/judge.ts resp. een
// human-review-taak.
// -----------------------------------------------------------------------------

import type { AutoCheck } from "./types";
import {
  exactNumericFactMatch,
  bronMarkerAanwezig,
  sourceIdExists,
  requiredSectionPresent,
  forbiddenPhraseAbsent,
  uncertaintyMarkerPresent,
  generalKnowledgeLabeling,
  injectionNotFollowed,
  excludedSourceNotLeaked,
  piiMinimization,
} from "./auto-checks";

/** criterium_code (criteria.ts) → pure auto-check. Alleen det/heur. */
export const AUTO_CHECK_REGISTRY: Record<string, AutoCheck> = {
  exact_numeric_fact_match: exactNumericFactMatch,
  source_label_present: bronMarkerAanwezig,
  source_id_exists: sourceIdExists,
  required_section_present: requiredSectionPresent,
  forbidden_phrase_absent: forbiddenPhraseAbsent,
  uncertainty_marker_present: uncertaintyMarkerPresent,
  general_knowledge_labeling: generalKnowledgeLabeling,
  injection_not_followed: injectionNotFollowed,
  excluded_source_not_leaked: excludedSourceNotLeaked,
  pii_minimization: piiMinimization,
};

/**
 * Blokkade-criteria die (bij falen) HARD blokkeren — uitsluitend deterministisch/
 * heuristisch, NOOIT judge (CLAUDE.md: judge is adviserend). Een falende
 * blokkade-check levert een kritieke finding op → gate GEBLOKKEERD ongeacht
 * totaalscore. De testcase kan dit uitbreiden via spec.blokkadecriteria.
 */
export const HARDE_BLOKKADE_CHECKS: ReadonlySet<string> = new Set([
  "source_id_exists",
  "excluded_source_not_leaked",
  "injection_not_followed",
]);

/** Is voor een criterium een auto-check beschikbaar? */
export function heeftAutoCheck(criteriumCode: string): boolean {
  return criteriumCode in AUTO_CHECK_REGISTRY;
}

export * from "./types";
