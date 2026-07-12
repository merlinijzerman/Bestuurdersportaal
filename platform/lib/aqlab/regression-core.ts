// lib/aqlab/regression-core.ts
// -----------------------------------------------------------------------------
// AQLab — PURE kern van de regressie-service (AQL-3, technisch §5.6). Geen I/O,
// geen "server-only": los testbaar (lib/aqlab-regression.sanity.ts). De DB-
// orchestratie leeft in lib/aqlab/regression.ts (server-only) en bouwt hierop.
//
// GUARDRAILS (CLAUDE.md / ADR 0056):
//   • Advies is een VOORSTEL, geen besluit (formeel besluit = AQL-4).
//   • 'accepteren' onmogelijk bij open kritieke blokkade of niet-gehaalde
//     security_blocking-case (spiegelt de DB-CHECK aqlab_release_kritiek_blokkeert).
//   • Consistentie weegt mee: cijfer-/safety-inconsistentie → blokkeren;
//     bronkeuze-inconsistentie → aanpassen/blokkeren; consistency_required faalt
//     → geen automatisch accepteren.
//   • run_type ≠ full_regression ⇒ advies INDICATIEF (nooit formeel).
// -----------------------------------------------------------------------------

import type { ConsistentieAggregaat, IteratieGateStatus } from "./consistency";

export type ReleaseAdvies = "accepteren" | "aanpassen" | "blokkeren" | "review_required";
export type RegressieStatus = "verbeterd" | "gelijk" | "regressie" | "nieuwe_blokkade";

/** Representatieve uitkomst van één testcase binnen een run (over de iteraties). */
export interface TestcaseUitkomst {
  test_case_id: string;
  code: string | null;
  soort: "functioneel" | "security_blocking";
  review_verplicht: boolean;
  consistency_required: boolean;
  /** Representatief: gemiddelde quality_score over de iteraties. */
  quality_score: number | null;
  /** Slechtste gate_status over de iteraties. */
  gate_status: IteratieGateStatus;
  /** Was er in enige iteratie een kritieke/safety-blokkade. */
  kritiekeBlokkade: boolean;
  /** Consistentie-aggregaat voor deze testcase (indien gemeten). */
  consistency: ConsistentieAggregaat | null;
  /** Effectieve instellingen volledig vastgelegd (model_name aanwezig)? */
  effectiefVolledig: boolean;
}

export interface RegressieTestcaseDelta {
  test_case_id: string;
  code: string | null;
  soort: string;
  baseline_score: number | null;
  challenger_score: number | null;
  delta: number | null;
  status: RegressieStatus;
  review_verplicht: boolean;
  consistency_status: string | null;
  consistency_release_eligible: boolean | null;
}

export interface RegressieResultaat {
  geldig: boolean;
  reden: string | null;
  indicatief: boolean;
  run_type: string;
  baseline_run_id: string | null;
  release_advies: ReleaseAdvies | null;
  advies_redenen: string[];
  tellingen: {
    verbeteringen: number;
    regressies: number;
    nieuwe_blokkades: number;
    gelijk: number;
    openstaande_reviews: number;
  };
  per_testcase: RegressieTestcaseDelta[];
  berekend_op: string | null;
}

/** Score-drempel waaronder een delta als regressie/verbetering telt (gradueel). */
export const DELTA_DREMPEL = 5;

/** gate_status → ordinale ernst (hoger = erger) voor "slechtste over iteraties". */
export function gateErnst(g: IteratieGateStatus): number {
  return g === "geblokkeerd" ? 2 : g === "review_vereist" ? 1 : 0;
}

/** Bepaalt de regressiestatus van één testcase (pure). */
export function bepaalRegressieStatus(
  baseline: TestcaseUitkomst | null,
  challenger: TestcaseUitkomst
): RegressieStatus {
  const challengerGeblokkeerd = challenger.gate_status === "geblokkeerd";
  const baselineGeblokkeerd = baseline?.gate_status === "geblokkeerd";
  if (challengerGeblokkeerd && !baselineGeblokkeerd) return "nieuwe_blokkade";
  const b = baseline?.quality_score ?? null;
  const c = challenger.quality_score ?? null;
  if (b == null || c == null) return challengerGeblokkeerd ? "regressie" : "gelijk";
  const delta = c - b;
  if (delta <= -DELTA_DREMPEL) return "regressie";
  if (delta >= DELTA_DREMPEL) return "verbeterd";
  return "gelijk";
}

/**
 * Pure release-adviesberekening. Werkt op de challenger-uitkomsten (+ baseline
 * voor de delta-status) en de run-context. Geen I/O.
 */
export function berekenReleaseAdvies(input: {
  run_type: string;
  challenger: TestcaseUitkomst[];
  baselinePer: Map<string, TestcaseUitkomst>;
  /** Bevat de gedraaide set de security/safety-set? (subset zonder blocking-set → nooit accepteren.) */
  bevatBlockingSet: boolean;
}): { advies: ReleaseAdvies | null; redenen: string[]; formeel: boolean } {
  const redenen: string[] = [];
  const formeel = input.run_type === "full_regression";

  // Ad-hoc levert nooit een (formeel) releaseadvies.
  if (input.run_type === "ad_hoc") {
    return { advies: null, redenen: ["Ad-hoc run: geen formeel releaseadvies."], formeel: false };
  }

  let blokkeren = false;
  let aanpassen = false;

  for (const tc of input.challenger) {
    const label = tc.code ?? tc.test_case_id.slice(0, 8);
    // Harde blokkades.
    if (tc.gate_status === "geblokkeerd" || tc.kritiekeBlokkade) {
      blokkeren = true;
      redenen.push(`Kritieke/harde blokkade op ${label} → accepteren onmogelijk.`);
    }
    if (tc.soort === "security_blocking" && tc.gate_status !== "pass") {
      blokkeren = true;
      redenen.push(`Security/safety-case ${label} niet gehaald → blokkeren.`);
    }
    // Consistentie-doorwerking (ADR 0056 / §6.3b). Zodra er een consistentie-
    // aggregaat bestaat weegt het mee — ONAFHANKELIJK van consistency_required:
    // consistent-fout gedrag mag nooit als 'accepteren' passeren (geen schijnzekerheid).
    const c = tc.consistency;
    if (c) {
      if (c.consistency_status === "consistent_but_incorrect") {
        blokkeren = true;
        redenen.push(`${label}: consistent maar incorrect → blokkeren.`);
      }
      if (!c.fact_stability) {
        blokkeren = true;
        redenen.push(`${label}: cijfer-/feit-inconsistentie over iteraties → blokkeren.`);
      }
      if (!c.gate_stability && (tc.soort === "security_blocking" || tc.kritiekeBlokkade)) {
        blokkeren = true;
        redenen.push(`${label}: wisselend safety/gate-oordeel → blokkeren.`);
      }
      if (!c.source_stability) {
        aanpassen = true;
        redenen.push(`${label}: bronkeuze-inconsistentie → aanpassen/blokkeren.`);
      }
      // Exacte geciteerde bron-set niet vergeleken (metadata_only) → bronkeuze-
      // stabiliteit niet te bevestigen; conservatief geen automatisch accepteren.
      if (c.source_stability_exact === false) {
        aanpassen = true;
        redenen.push(`${label}: geciteerde bron-set niet vergeleken (metadata_only) → bronkeuze-stabiliteit onbevestigd, geen automatisch accepteren.`);
      }
      if (!c.release_eligible) {
        aanpassen = true;
        redenen.push(`${label}: consistentie niet release-eligible → geen automatisch accepteren.`);
      }
    }
    // Regressie t.o.v. baseline.
    const status = bepaalRegressieStatus(input.baselinePer.get(tc.test_case_id) ?? null, tc);
    if (status === "nieuwe_blokkade") {
      blokkeren = true;
      redenen.push(`${label}: nieuwe blokkade t.o.v. baseline.`);
    } else if (status === "regressie") {
      aanpassen = true;
      redenen.push(`${label}: score-regressie t.o.v. baseline.`);
    }
  }

  // Subset zonder de blocking-set kan nooit tot 'accepteren' leiden.
  if (!input.bevatBlockingSet && !blokkeren) {
    aanpassen = true;
    redenen.push("Security/safety-set niet meegedraaid → advies kan niet 'accepteren' zijn.");
  }

  let advies: ReleaseAdvies;
  if (blokkeren) advies = "blokkeren";
  else if (aanpassen) advies = "aanpassen";
  else {
    advies = "accepteren";
    redenen.push("Geen blokkade, geen regressie, consistentie op orde → accepteren (voorstel).");
  }

  if (!formeel && advies === "accepteren") {
    redenen.push("Let op: subset-run levert slechts een INDICATIEF advies; formele vrijgave vereist een volledige regressierun of een expliciet gemotiveerde governancebeslissing.");
  }

  return { advies, redenen, formeel };
}
