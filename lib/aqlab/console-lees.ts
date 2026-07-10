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

export interface RunLijstItem {
  id: string;
  run_type: string;
  status: string;
  persist_mode: string;
  test_set_id: string | null;
  totale_kosten: number | null;
  aggregatie: { performance?: RunPerformance } | null;
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
    .select("id, run_type, status, persist_mode, test_set_id, totale_kosten, aggregatie, gestart_op, voltooid_op")
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
