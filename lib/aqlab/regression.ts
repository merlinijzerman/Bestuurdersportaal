// lib/aqlab/regression.ts
// -----------------------------------------------------------------------------
// AQLab — regressie-service DB-orchestratie (AQL-3, technisch §5.6). Leest de
// challenger- + baseline-run, aggregeert per testcase en schrijft de delta's +
// release_advies naar aqlab_runs.aggregatie.regressie op de challenger-run.
//
// De PURE adviesregels + types leven in lib/aqlab/regression-core.ts (los getest
// in lib/aqlab-regression.sanity.ts). Dit bestand is "server-only": het raakt de
// service-role client (via de meegegeven svc) en mag nooit client-importeerbaar zijn.
// -----------------------------------------------------------------------------

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsistentieAggregaat, IteratieGateStatus } from "./consistency";
import {
  bepaalRegressieStatus,
  berekenReleaseAdvies,
  gateErnst,
  type RegressieResultaat,
  type RegressieTestcaseDelta,
  type TestcaseUitkomst,
} from "./regression-core";

export * from "./regression-core";

interface RunRij {
  id: string;
  run_type: string;
  baseline_run_id: string | null;
  subset_filter: Record<string, unknown> | null;
  selected_test_case_ids: string[] | null;
  aggregatie: Record<string, unknown> | null;
}

type TcMeta = {
  code: string | null;
  soort: "functioneel" | "security_blocking";
  review_verplicht: boolean;
  consistency_required: boolean;
};

/** Groepeert de outputs van een run per testcase → representatieve uitkomst. */
async function laadUitkomstenPerTestcase(
  svc: SupabaseClient,
  runId: string,
  consistencyAgg: Record<string, ConsistentieAggregaat> | null,
  tcMeta: Map<string, TcMeta>
): Promise<Map<string, TestcaseUitkomst>> {
  const { data } = await svc
    .from("aqlab_run_outputs")
    .select("test_case_id, quality_score, gate_status, model_name")
    .eq("run_id", runId);
  const rows = (data ?? []) as {
    test_case_id: string | null;
    quality_score: number | null;
    gate_status: IteratieGateStatus | null;
    model_name: string | null;
  }[];

  const per = new Map<string, { scores: number[]; ergsteGate: IteratieGateStatus; effectiefVolledig: boolean }>();
  for (const r of rows) {
    if (!r.test_case_id) continue;
    const g = (r.gate_status ?? "review_vereist") as IteratieGateStatus;
    const bestaand = per.get(r.test_case_id) ?? { scores: [], ergsteGate: "pass" as IteratieGateStatus, effectiefVolledig: true };
    if (typeof r.quality_score === "number") bestaand.scores.push(r.quality_score);
    if (gateErnst(g) > gateErnst(bestaand.ergsteGate)) bestaand.ergsteGate = g;
    if (!r.model_name) bestaand.effectiefVolledig = false;
    per.set(r.test_case_id, bestaand);
  }

  const out = new Map<string, TestcaseUitkomst>();
  for (const [tcId, agg] of per) {
    const meta = tcMeta.get(tcId);
    const c = consistencyAgg?.[tcId] ?? null;
    out.set(tcId, {
      test_case_id: tcId,
      code: meta?.code ?? null,
      soort: meta?.soort ?? "functioneel",
      review_verplicht: meta?.review_verplicht ?? false,
      consistency_required: meta?.consistency_required ?? c?.consistency_required ?? false,
      quality_score: agg.scores.length ? Math.round(agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length) : null,
      gate_status: agg.ergsteGate,
      kritiekeBlokkade: agg.ergsteGate === "geblokkeerd",
      consistency: c,
      effectiefVolledig: agg.effectiefVolledig,
    });
  }
  return out;
}

function subsetsGelijk(a: string[] | null, b: string[] | null): boolean {
  const sa = new Set(a ?? []);
  const sb = new Set(b ?? []);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/**
 * Berekent de regressie challenger-vs-baseline en schrijft het resultaat naar
 * aqlab_runs.aggregatie.regressie op de challenger-run. Herleidbaar gelogd.
 * Retourneert het resultaat (ook bij ongeldig, met reden). `nu` = ISO-tijdstip
 * (door de aanroeper aangeleverd i.v.m. reproduceerbaarheid).
 */
export async function berekenRegressie(
  svc: SupabaseClient,
  challengerRunId: string,
  nu: string
): Promise<RegressieResultaat> {
  const leeg = (reden: string, run_type = "full_regression", baseline_run_id: string | null = null): RegressieResultaat => ({
    geldig: false,
    reden,
    indicatief: run_type !== "full_regression",
    run_type,
    baseline_run_id,
    release_advies: "review_required",
    advies_redenen: [reden],
    tellingen: { verbeteringen: 0, regressies: 0, nieuwe_blokkades: 0, gelijk: 0, openstaande_reviews: 0 },
    per_testcase: [],
    berekend_op: nu,
  });

  const { data: chData } = await svc
    .from("aqlab_runs")
    .select("id, run_type, baseline_run_id, subset_filter, selected_test_case_ids, aggregatie")
    .eq("id", challengerRunId)
    .maybeSingle();
  const challenger = chData as RunRij | null;
  if (!challenger) return leeg("Challenger-run niet gevonden.");
  if (!challenger.baseline_run_id) return leeg("Geen baseline_run_id — regressie niet berekenbaar.", challenger.run_type, null);

  const { data: baData } = await svc
    .from("aqlab_runs")
    .select("id, run_type, baseline_run_id, subset_filter, selected_test_case_ids, aggregatie")
    .eq("id", challenger.baseline_run_id)
    .maybeSingle();
  const baseline = baData as RunRij | null;
  if (!baseline) return leeg("Baseline-run niet gevonden.", challenger.run_type, challenger.baseline_run_id);

  // Subset-geldigheid: dezelfde subset vereist voor een geldige vergelijking.
  if (challenger.run_type === "subset" && !subsetsGelijk(challenger.selected_test_case_ids, baseline.selected_test_case_ids)) {
    return leeg("Subset wijkt af van de baseline-subset — regressie niet geldig vergelijkbaar.", challenger.run_type, challenger.baseline_run_id);
  }

  const chAgg = (challenger.aggregatie?.consistency as Record<string, ConsistentieAggregaat> | undefined) ?? null;
  const baAgg = (baseline.aggregatie?.consistency as Record<string, ConsistentieAggregaat> | undefined) ?? null;

  const { data: outIds } = await svc
    .from("aqlab_run_outputs")
    .select("test_case_id")
    .in("run_id", [challenger.id, baseline.id]);
  const tcIds = [...new Set(((outIds ?? []) as { test_case_id: string | null }[]).map((r) => r.test_case_id).filter((x): x is string => !!x))];

  const tcMeta = new Map<string, TcMeta>();
  if (tcIds.length) {
    const { data: tcs } = await svc
      .from("aqlab_test_cases")
      .select("id, code, soort, review_verplicht, consistency_required")
      .in("id", tcIds);
    for (const t of (tcs ?? []) as ({ id: string } & TcMeta)[]) {
      tcMeta.set(t.id, { code: t.code, soort: t.soort, review_verplicht: t.review_verplicht, consistency_required: t.consistency_required });
    }
  }

  const challengerPer = await laadUitkomstenPerTestcase(svc, challenger.id, chAgg, tcMeta);
  const baselinePer = await laadUitkomstenPerTestcase(svc, baseline.id, baAgg, tcMeta);

  const onvolledig = [...challengerPer.values(), ...baselinePer.values()].some((u) => !u.effectiefVolledig);
  if (onvolledig) {
    return leeg("Onvolledige effectieve instellingen (model_name ontbreekt) — regressie niet betrouwbaar.", challenger.run_type, challenger.baseline_run_id);
  }

  const challengerLijst = [...challengerPer.values()];
  const bevatBlockingSet = challengerLijst.some((t) => t.soort === "security_blocking");

  const per_testcase: RegressieTestcaseDelta[] = [];
  const tellingen = { verbeteringen: 0, regressies: 0, nieuwe_blokkades: 0, gelijk: 0, openstaande_reviews: 0 };
  for (const tc of challengerLijst) {
    const base = baselinePer.get(tc.test_case_id) ?? null;
    const status = bepaalRegressieStatus(base, tc);
    if (status === "verbeterd") tellingen.verbeteringen++;
    else if (status === "regressie") tellingen.regressies++;
    else if (status === "nieuwe_blokkade") tellingen.nieuwe_blokkades++;
    else tellingen.gelijk++;
    if (tc.review_verplicht) tellingen.openstaande_reviews++;
    per_testcase.push({
      test_case_id: tc.test_case_id,
      code: tc.code,
      soort: tc.soort,
      baseline_score: base?.quality_score ?? null,
      challenger_score: tc.quality_score,
      delta: base?.quality_score != null && tc.quality_score != null ? tc.quality_score - base.quality_score : null,
      status,
      review_verplicht: tc.review_verplicht,
      consistency_status: tc.consistency?.consistency_status ?? null,
      consistency_release_eligible: tc.consistency?.release_eligible ?? null,
    });
  }

  const { advies, redenen, formeel } = berekenReleaseAdvies({
    run_type: challenger.run_type,
    challenger: challengerLijst,
    baselinePer,
    bevatBlockingSet,
  });

  const resultaat: RegressieResultaat = {
    geldig: true,
    reden: null,
    indicatief: !formeel,
    run_type: challenger.run_type,
    baseline_run_id: challenger.baseline_run_id,
    release_advies: advies,
    advies_redenen: redenen,
    tellingen,
    per_testcase: per_testcase.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)),
    berekend_op: nu,
  };

  // Wegschrijven naar aqlab_runs.aggregatie.regressie (herleidbaar; append-only log).
  const { data: cur } = await svc.from("aqlab_runs").select("aggregatie").eq("id", challenger.id).maybeSingle();
  const aggregatie = { ...(((cur?.aggregatie as Record<string, unknown>) ?? {})), regressie: resultaat };
  await svc.from("aqlab_runs").update({ aggregatie }).eq("id", challenger.id);
  await svc.from("aqlab_log").insert({
    actie: "regressie_berekend",
    object_type: "aqlab_runs",
    object_id: challenger.id,
    nieuwe_waarde: { release_advies: advies, geldig: true, tellingen },
  });

  return resultaat;
}
