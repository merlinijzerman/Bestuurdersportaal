// lib/aqlab/console-lees.ts
// -----------------------------------------------------------------------------
// AQLab — server-only leespaden voor de platform-console (AQL-2, scherm 5/6).
//
// De aqlab_*-tabellen zijn deny-by-default (geen anon/tenant-policy): lezen loopt
// via de niet-tenant service-role-client (lib/supabase-service). De aanroepende
// server-component checkt EERST de capability (platform.aqlab.operate) via de
// platform-identiteit; deze module doet alleen de reads. Nooit importeren vanuit
// een client-component (server-only).
// -----------------------------------------------------------------------------

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsistentieAggregaat } from "./consistency";
import type { RegressieResultaat } from "./regression-core";

export interface RunAggregatie {
  performance?: RunPerformance;
  consistency?: Record<string, ConsistentieAggregaat>;
  regressie?: RegressieResultaat;
}

export interface RunLijstItem {
  id: string;
  run_type: string;
  status: string;
  persist_mode: string;
  test_set_id: string | null;
  baseline_run_id?: string | null;
  rol?: string | null;
  gewijzigde_as?: string | null;
  ad_hoc_question?: string | null;
  promoted_to_testcase?: boolean | null;
  promoted_testcase_id?: string | null;
  totale_kosten: number | null;
  aggregatie: RunAggregatie | null;
  gestart_op: string | null;
  voltooid_op: string | null;
}

export interface RunPerformance {
  outputs?: number;
  latency_gemiddeld?: number | null;
  latency_mediaan?: number | null;
  latency_p95?: number | null;
  langzaamste_test_case_id?: string | null;
  tokens_in?: number;
  tokens_out?: number;
  aantal_geblokkeerd?: number;
  aantal_review_vereist?: number;
}

export interface ScoreRij {
  id: string;
  criterium_code: string;
  methode: string;
  score: number | null;
  pass: boolean | null;
  motivatie: string | null;
  bewijs: unknown;
  judge_model: string | null;
}

export interface FindingRij {
  id: string;
  score_id: string | null;
  type: string | null;
  ernst: string;
  omschrijving: string | null;
  fragment: string | null;
  status: string;
}

export interface OutputMetScores {
  id: string;
  test_case_id: string | null;
  iteratie: number;
  inputvraag: string | null;
  gegenereerd_antwoord: string | null;
  gebruikte_bronnen: unknown;
  snapshot_hash: string | null;
  model_name: string | null;
  temperature_effective: number | null;
  max_tokens_effective: number | null;
  top_p_effective: number | null;
  provider_default_used: boolean | null;
  retrieval_settings_effective: unknown;
  prompt_version_id: string | null;
  tokengebruik: { in?: number; out?: number } | null;
  latency_ms: number | null;
  kosten_indicatie: number | null;
  quality_score: number | null;
  gate_status: string | null;
  foutmelding: string | null;
  tijdstip: string | null;
  scores: ScoreRij[];
  findings: FindingRij[];
}

export async function lijstRuns(svc: SupabaseClient, limit = 50): Promise<RunLijstItem[]> {
  const { data } = await svc
    .from("aqlab_runs")
    .select("id, run_type, status, persist_mode, test_set_id, totale_kosten, aggregatie, gestart_op, voltooid_op")
    .order("gestart_op", { ascending: false })
    .limit(limit);
  return (data ?? []) as RunLijstItem[];
}

export async function haalTestsets(svc: SupabaseClient): Promise<{ id: string; code: string; naam: string }[]> {
  const { data } = await svc
    .from("aqlab_test_sets")
    .select("id, code, naam")
    .eq("status", "actief")
    .order("naam");
  return (data ?? []) as { id: string; code: string; naam: string }[];
}

export interface RunDetail {
  run: RunLijstItem | null;
  outputs: OutputMetScores[];
}

export async function haalRunDetail(svc: SupabaseClient, runId: string): Promise<RunDetail> {
  const { data: runData } = await svc
    .from("aqlab_runs")
    .select("id, run_type, status, persist_mode, test_set_id, baseline_run_id, rol, gewijzigde_as, ad_hoc_question, promoted_to_testcase, promoted_testcase_id, totale_kosten, aggregatie, gestart_op, voltooid_op")
    .eq("id", runId)
    .maybeSingle();
  const run = (runData as RunLijstItem) ?? null;

  const { data: outData } = await svc
    .from("aqlab_run_outputs")
    .select(
      "id, test_case_id, iteratie, inputvraag, gegenereerd_antwoord, gebruikte_bronnen, snapshot_hash, model_name, temperature_effective, max_tokens_effective, top_p_effective, provider_default_used, retrieval_settings_effective, prompt_version_id, tokengebruik, latency_ms, kosten_indicatie, quality_score, gate_status, foutmelding, tijdstip"
    )
    .eq("run_id", runId)
    .order("tijdstip", { ascending: true });
  const outputs = (outData ?? []) as OutputMetScores[];
  if (outputs.length === 0) return { run, outputs: [] };

  const outputIds = outputs.map((o) => o.id);
  const { data: scoreData } = await svc
    .from("aqlab_scores")
    .select("id, run_output_id, criterium_code, methode, score, pass, motivatie, bewijs, judge_model")
    .in("run_output_id", outputIds);
  const { data: findingData } = await svc
    .from("aqlab_findings")
    .select("id, run_output_id, score_id, type, ernst, omschrijving, fragment, status")
    .in("run_output_id", outputIds);

  const scoresPer = new Map<string, ScoreRij[]>();
  for (const s of (scoreData ?? []) as (ScoreRij & { run_output_id: string })[]) {
    (scoresPer.get(s.run_output_id) ?? scoresPer.set(s.run_output_id, []).get(s.run_output_id)!).push(s);
  }
  const findingsPer = new Map<string, FindingRij[]>();
  for (const f of (findingData ?? []) as (FindingRij & { run_output_id: string })[]) {
    (findingsPer.get(f.run_output_id) ?? findingsPer.set(f.run_output_id, []).get(f.run_output_id)!).push(f);
  }

  for (const o of outputs) {
    o.scores = scoresPer.get(o.id) ?? [];
    o.findings = findingsPer.get(o.id) ?? [];
  }
  return { run, outputs };
}

// ── AQL-3: leespaden voor scherm 3 (run samenstellen) + scherm 4 (vergelijking) ──

export interface ModelConfigItem { id: string; naam: string; model_name: string; is_baseline: boolean }
export async function haalModelConfiguraties(svc: SupabaseClient): Promise<ModelConfigItem[]> {
  const { data } = await svc
    .from("aqlab_model_configurations")
    .select("id, naam, model_name, is_baseline")
    .order("naam");
  return (data ?? []) as ModelConfigItem[];
}

export interface FixtureItem { code: string; titel: string }
export async function haalFixtures(svc: SupabaseClient): Promise<FixtureItem[]> {
  const { data } = await svc
    .from("aqlab_fixture_documents")
    .select("code, titel")
    .order("code");
  // Ontdubbel op code (meerdere versies mogelijk).
  const seen = new Set<string>();
  const uit: FixtureItem[] = [];
  for (const r of (data ?? []) as FixtureItem[]) {
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    uit.push(r);
  }
  return uit;
}

export interface TestcaseItem {
  id: string;
  code: string;
  titel: string;
  soort: string;
  kritikaliteit: string;
  consistency_required: boolean;
  review_verplicht: boolean;
}
export async function haalTestcases(svc: SupabaseClient, testSetId?: string | null): Promise<TestcaseItem[]> {
  let q = svc
    .from("aqlab_test_cases")
    .select("id, code, titel, soort, kritikaliteit, consistency_required, review_verplicht")
    .eq("actief", true)
    .order("code");
  if (testSetId) q = q.eq("test_set_id", testSetId);
  const { data } = await q;
  return (data ?? []) as TestcaseItem[];
}

/** Kandidaat-baselines: afgeronde runs (nieuwste eerst). */
export async function haalBaselineKandidaten(svc: SupabaseClient, limit = 25): Promise<RunLijstItem[]> {
  const { data } = await svc
    .from("aqlab_runs")
    .select("id, run_type, status, persist_mode, test_set_id, ad_hoc_question, totale_kosten, aggregatie, gestart_op, voltooid_op")
    .eq("status", "done")
    .order("voltooid_op", { ascending: false })
    .limit(limit);
  return (data ?? []) as RunLijstItem[];
}

/** Ad-hoc runs die (nog) niet gepromoveerd zijn — kandidaat voor "opslaan als testcase". */
export async function haalPromoveerbareRuns(svc: SupabaseClient, limit = 25): Promise<RunLijstItem[]> {
  const { data } = await svc
    .from("aqlab_runs")
    .select("id, run_type, status, persist_mode, ad_hoc_question, promoted_to_testcase, gestart_op, voltooid_op, totale_kosten, aggregatie, test_set_id")
    .eq("run_type", "ad_hoc")
    .eq("promoted_to_testcase", false)
    .not("ad_hoc_question", "is", null)
    .order("gestart_op", { ascending: false })
    .limit(limit);
  return (data ?? []) as RunLijstItem[];
}

export interface VergelijkingPaar {
  test_case_id: string | null;
  code: string | null;
  vraag: string | null;
  baseline: OutputMetScores | null;
  challenger: OutputMetScores | null;
}
export interface Vergelijking {
  baseline_run_id: string | null;
  paren: VergelijkingPaar[];
}

/** Scherm 4: representatieve output (iteratie 1) van challenger vs baseline per testcase. */
export async function haalVergelijking(svc: SupabaseClient, challengerRunId: string): Promise<Vergelijking> {
  const { run } = await haalRunDetail(svc, challengerRunId);
  const baselineRunId = run?.baseline_run_id ?? null;
  if (!baselineRunId) return { baseline_run_id: null, paren: [] };

  const [ch, ba] = await Promise.all([
    haalRunDetail(svc, challengerRunId),
    haalRunDetail(svc, baselineRunId),
  ]);
  // Eerste iteratie per testcase als representatief.
  const eersteIteratie = (outs: OutputMetScores[]) => {
    const per = new Map<string, OutputMetScores>();
    for (const o of outs) {
      const key = o.test_case_id ?? "ad_hoc";
      const bestaand = per.get(key);
      if (!bestaand || o.iteratie < bestaand.iteratie) per.set(key, o);
    }
    return per;
  };
  const chPer = eersteIteratie(ch.outputs);
  const baPer = eersteIteratie(ba.outputs);
  const keys = [...new Set([...chPer.keys(), ...baPer.keys()])];

  const codeById = new Map<string, string>();
  const tcIds = keys.filter((k) => k !== "ad_hoc");
  if (tcIds.length) {
    const { data } = await svc.from("aqlab_test_cases").select("id, code").in("id", tcIds);
    for (const t of (data ?? []) as { id: string; code: string }[]) codeById.set(t.id, t.code);
  }

  const paren: VergelijkingPaar[] = keys.map((k) => {
    const challenger = chPer.get(k) ?? null;
    const baseline = baPer.get(k) ?? null;
    const tcId = k === "ad_hoc" ? null : k;
    return {
      test_case_id: tcId,
      code: tcId ? codeById.get(tcId) ?? null : "ad-hoc",
      vraag: challenger?.inputvraag ?? baseline?.inputvraag ?? null,
      baseline,
      challenger,
    };
  });
  return { baseline_run_id: baselineRunId, paren };
}
