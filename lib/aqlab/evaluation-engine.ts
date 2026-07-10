// lib/aqlab/evaluation-engine.ts
// -----------------------------------------------------------------------------
// AQLab — evaluatie-engine (AQL-2, technisch §5.3).
//
// Per output: (1) deterministische checks → (2) heuristische checks →
// (3) blokkade-gate → (4) LLM-judge → (5) human-review-taak indien vereist →
// (6) aggregatie. Levert per-criterium scores + findings + een per-output rollup
// (quality_score STRIKT gescheiden van gate_status), plus de dimensievloer-
// uitkomsten. Deze module is puur (geen DB/I/O); de orchestrator schrijft de
// resultaten weg conform persist_mode.
//
// GUARDRAILS (CLAUDE.md / technisch §5.5):
//   • De judge is ADVISEREND: een judge-signaal kan hooguit 'review_vereist'
//     zetten, NOOIT zelfstandig 'geblokkeerd'.
//   • Een kritieke finding (open) blokkeert de pass, ongeacht de totaalscore.
//   • quality_score (gradueel) en gate_status (categorisch) zijn twee assen.
// -----------------------------------------------------------------------------

import { criteriumByKey } from "./criteria";
import {
  AUTO_CHECK_REGISTRY,
  HARDE_BLOKKADE_CHECKS,
  type CheckInput,
  type Finding,
  type TestcaseSpec,
} from "./checks";
import {
  isJudgeCriterium,
  type JudgeCriterium,
  type JudgeInput,
  type JudgeResultaat,
} from "./judge";

/** Methode zoals weggeschreven in aqlab_scores.methode. */
export type ScoreMethodeDb = "deterministisch" | "heuristisch" | "llm_judge" | "human";

export type GateStatus = "pass" | "geblokkeerd" | "review_vereist";

/** Eén score-rij (→ aqlab_scores) met de bijbehorende findings (→ aqlab_findings). */
export interface CriteriumScore {
  criterium_code: string;
  methode: ScoreMethodeDb;
  /** 0-100, of null (human / boolean judge zonder numerieke score). */
  score: number | null;
  /** null voor een openstaande human-review. */
  pass: boolean | null;
  motivatie: string;
  bewijs: unknown;
  judge_model?: string | null;
  findings: Finding[];
  /** true = dit criterium telt mee in quality_score (staat in de testcase-checks). */
  teltMeeInKwaliteit: boolean;
}

export interface DimensieVloer {
  dimensie: string;
  vloer: number;
  behaald: number;
  gehaald: boolean;
}

export interface EvaluatieResultaat {
  scores: CriteriumScore[];
  /** Alle findings (per-score + vloer) als platte lijst voor rapportage. */
  findings: Finding[];
  /**
   * Aggregatie-findings die NIET aan een criterium-score hangen (dimensievloeren).
   * De orchestrator schrijft deze weg met score_id = null; de per-score findings
   * staan op CriteriumScore.findings (met hun eigen score_id).
   */
  vloerFindings: Finding[];
  quality_score: number;
  gate_status: GateStatus;
  dimensieVloeren: DimensieVloer[];
  /** pass/fail t.o.v. minimale_acceptatiescore + vloeren + gate. */
  kwaliteitPass: boolean;
  humanReviewVereist: boolean;
}

export interface EvaluatieInput {
  vraag: string;
  antwoord: string;
  bronnenAantal: number;
  /** Bron-/contexttekst voor judge-groundedness. */
  bronContext: string;
  spec: TestcaseSpec;
  snapshotRefs?: string[];
  /** De criterium-codes uit de testcase (aqlab_test_cases.spec.checks). */
  criteria: string[];
  reviewVerplicht: boolean;
}

export interface EvaluatieOpties {
  /**
   * Injecteerbare judge-runner. Ontbreekt hij (bv. hermetische smoke), dan worden
   * de judge-criteria overgeslagen en levert dat een 'review_vereist'-signaal:
   * geen schijnzekerheid — een niet-uitgevoerde judge is geen groen vinkje.
   */
  judge?: (criterium: JudgeCriterium, input: JudgeInput) => Promise<JudgeResultaat>;
}

// Dimensie → bijdragende criteria (voor de dimensievloeren, technisch/functioneel §4).
const DIMENSIE_CRITERIA: Record<string, string[]> = {
  brongebondenheid: [
    "source_label_present",
    "source_id_exists",
    "general_knowledge_labeling",
    "claim_matches_source_semantic",
  ],
  feitelijke_juistheid: [
    "exact_numeric_fact_match",
    "no_forbidden_claim",
    "claim_matches_source_semantic",
    "risk_duiding_correct",
  ],
  format_compliance: ["required_section_present"],
};

/** Numeriek-equivalente score voor vloer-/kwaliteitsberekening (boolean → 100/0). */
function scoreVoorAggregatie(s: CriteriumScore): number | null {
  if (typeof s.score === "number") return s.score;
  if (s.methode === "human") return null; // openstaand — telt niet mee
  if (typeof s.pass === "boolean") return s.pass ? 100 : 0;
  return null;
}

/** Routeer criteria.ts-methode → bepaal of het een auto/judge/human criterium is. */
function methodeVan(code: string): "deterministic" | "heuristic" | "judge" | "human" | null {
  return criteriumByKey(code)?.methode ?? null;
}

export async function evalueerOutput(
  input: EvaluatieInput,
  opties: EvaluatieOpties = {}
): Promise<EvaluatieResultaat> {
  const checkInput: CheckInput = {
    antwoord: input.antwoord,
    bronnenAantal: input.bronnenAantal,
    spec: input.spec,
    snapshotRefs: input.snapshotRefs,
  };

  const origineel = new Set(input.criteria);
  const scores: CriteriumScore[] = [];
  const alleFindings: Finding[] = [];
  let humanReviewVereist = input.reviewVerplicht;
  let judgeOnbetrouwbaar = false;

  // ── (1)+(2) Deterministische + heuristische auto-checks ───────────────────
  // Draai de unie van de testcase-checks en de harde blokkade-checks: die laatste
  // moeten áltijd draaien (veiligheidsvloer), ook als de testcase ze niet noemt.
  const autoTeDraaien = new Set<string>();
  for (const c of input.criteria) {
    if (AUTO_CHECK_REGISTRY[c]) autoTeDraaien.add(c);
  }
  for (const c of HARDE_BLOKKADE_CHECKS) autoTeDraaien.add(c);

  for (const code of autoTeDraaien) {
    const check = AUTO_CHECK_REGISTRY[code];
    if (!check) continue;
    const r = check(checkInput);
    scores.push({
      criterium_code: code,
      methode: r.methode,
      score: r.score,
      pass: r.pass,
      motivatie: r.motivatie,
      bewijs: null,
      findings: r.findings,
      teltMeeInKwaliteit: origineel.has(code),
    });
    alleFindings.push(...r.findings);
  }

  // ── (4) LLM-judge (advies) — alleen de judge-criteria uit de testcase ─────
  const judgeCriteria = input.criteria.filter(isJudgeCriterium) as JudgeCriterium[];
  for (const code of judgeCriteria) {
    if (!opties.judge) {
      // Geen judge beschikbaar → geen groen vinkje; markeer review nodig.
      judgeOnbetrouwbaar = true;
      scores.push({
        criterium_code: code,
        methode: "llm_judge",
        score: null,
        pass: null,
        motivatie: "Judge niet uitgevoerd (geen judge-runner); menselijke review vereist. Geen schijnzekerheid.",
        bewijs: null,
        judge_model: null,
        findings: [],
        teltMeeInKwaliteit: origineel.has(code),
      });
      continue;
    }
    const jr = await opties.judge(code, {
      vraag: input.vraag,
      antwoord: input.antwoord,
      bronContext: input.bronContext,
      forbiddenClaims: input.spec.forbidden_claims,
      expectedFacts: input.spec.expected_answer_outline?.exact_facts,
    });
    if (jr.onbetrouwbaar) judgeOnbetrouwbaar = true;
    scores.push({
      criterium_code: code,
      methode: "llm_judge",
      score: jr.score,
      pass: jr.pass,
      motivatie: jr.motivatie,
      bewijs: jr.bewijs,
      judge_model: jr.judge_model,
      findings: [],
      teltMeeInKwaliteit: origineel.has(code),
    });
  }

  // ── (5) Human-review-criterium (indien in de testcase) ────────────────────
  for (const code of input.criteria) {
    if (methodeVan(code) === "human") {
      humanReviewVereist = true;
      scores.push({
        criterium_code: code,
        methode: "human",
        score: null,
        pass: null,
        motivatie: "Menselijke review vereist; gezaghebbend binnen scope.",
        bewijs: null,
        findings: [],
        teltMeeInKwaliteit: false,
      });
    }
  }

  // ── (3) Blokkade-gate — deterministisch/heuristisch of kritieke finding ───
  // NOOIT judge-only. Een falende harde blokkade-check of een expliciet
  // spec.blokkadecriterium (dat een auto-check is) blokkeert.
  const spec = input.spec;
  const specBlokkade = new Set(spec.blokkadecriteria ?? []);
  const geblokkeerd = scores.some((s) => {
    if (s.methode !== "deterministisch" && s.methode !== "heuristisch") return false;
    const isBlokkade = HARDE_BLOKKADE_CHECKS.has(s.criterium_code) || specBlokkade.has(s.criterium_code);
    return isBlokkade && s.pass === false;
  });
  const kritiekeFindingOpen = alleFindings.some((f) => f.ernst === "kritiek");

  // Judge-signaal dat menselijke review vraagt (NOOIT auto-blokkade): alleen bij
  // een AFKEUR of onbetrouwbaar oordeel (pass=false of open/pass=null). Een schone
  // judge-pass (pass=true) — ook de boolean-variant met score=null — vraagt géén review.
  const judgeVraagtReview = scores.some(
    (s) => s.methode === "llm_judge" && s.pass !== true
  );

  let gate_status: GateStatus;
  if (geblokkeerd || kritiekeFindingOpen) {
    gate_status = "geblokkeerd";
  } else if (humanReviewVereist || judgeOnbetrouwbaar || judgeVraagtReview) {
    gate_status = "review_vereist";
  } else {
    gate_status = "pass";
  }

  // ── (6) Aggregatie — quality_score (alleen de eigen testcase-criteria) ────
  const kwaliteitScores = scores
    .filter((s) => s.teltMeeInKwaliteit)
    .map(scoreVoorAggregatie)
    .filter((v): v is number => v !== null);
  const quality_score =
    kwaliteitScores.length > 0
      ? Math.round(kwaliteitScores.reduce((a, b) => a + b, 0) / kwaliteitScores.length)
      : 0;

  // Dimensievloeren.
  const dimensieVloeren: DimensieVloer[] = [];
  const vloerFindings: Finding[] = [];
  const scoreByCode = new Map(scores.map((s) => [s.criterium_code, s]));
  for (const [dimensie, vloer] of Object.entries(spec.dimension_floors ?? {})) {
    const bijdragen = (DIMENSIE_CRITERIA[dimensie] ?? [])
      .map((code) => scoreByCode.get(code))
      .filter((s): s is CriteriumScore => !!s)
      .map(scoreVoorAggregatie)
      .filter((v): v is number => v !== null);
    if (bijdragen.length === 0) continue;
    const behaald = Math.min(...bijdragen);
    const gehaald = behaald >= vloer;
    dimensieVloeren.push({ dimensie, vloer, behaald, gehaald });
    if (!gehaald) {
      const f: Finding = {
        type: "overig",
        ernst: "hoog",
        omschrijving: `Dimensievloer '${dimensie}' niet gehaald: ${behaald} < ${vloer}.`,
      };
      vloerFindings.push(f);
      alleFindings.push(f);
    }
  }
  const vloerenGehaald = dimensieVloeren.every((d) => d.gehaald);

  // kwaliteitPass t.o.v. minimale_acceptatiescore (numeriek of 'binair').
  const min = spec.min_quality_score;
  let kwaliteitPass: boolean;
  if (min === "binair" || typeof min === "string") {
    kwaliteitPass = gate_status === "pass";
  } else {
    const drempel = typeof min === "number" ? min : 0;
    kwaliteitPass = gate_status === "pass" && quality_score >= drempel && vloerenGehaald;
  }

  return {
    scores,
    findings: alleFindings,
    vloerFindings,
    quality_score,
    gate_status,
    dimensieVloeren,
    kwaliteitPass,
    humanReviewVereist,
  };
}
