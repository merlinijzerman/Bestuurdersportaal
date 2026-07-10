// lib/aqlab/run-orchestrator.ts
// -----------------------------------------------------------------------------
// AQLab — run-orchestrator (AQL-2, technisch §5.1).
//
// planRun():      zet aqlab_runs op 'queued' en plant idempotente werk-rijen
//                 (aqlab_run_jobs) per (run × testcase × iteratie).
// verwerkBatch(): een worker claimt een batch jobs (FOR UPDATE SKIP LOCKED via
//                 RPC), draait per job de generatie-adapter → evaluatie-engine,
//                 schrijft weg conform persist_mode, en rondt de run af.
//
// Best-effort per testcase: een fout op één output stopt de run niet. Idempotent
// per (run, testcase, iteratie). Kostenplafond, lease/timeout, cancellation en
// begrensde retries worden hier bewaakt. Testverkeer gaat NIET naar governance_log
// (besluit 8) — wél naar aqlab_log (append-only).
//
// server-only: draait uitsluitend met de service-role client (via de platform-
// wrapper of de cron-worker), nooit met een tenant/anon-client.
// -----------------------------------------------------------------------------

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { genereerViaAdapter, type FixtureContext, type AdapterModelConfig } from "./generate-adapter";
import { evalueerOutput, type CriteriumScore } from "./evaluation-engine";
import { beoordeelMetJudge, type JudgeCriterium, type JudgeInput } from "./judge";
import { fixtureTekst } from "./fixtures";
import type { TestcaseSpec } from "./checks";

export type PersistMode = "full_synthetic" | "none" | "metadata_only";

export interface RunConfig {
  run_type?: "full_regression" | "subset" | "ad_hoc";
  test_set_id?: string | null;
  prompt_version_id?: string | null;
  model_configuration_id?: string | null;
  persist_mode?: PersistMode;
  kostenplafond?: number | null;
  gestart_door?: string | null;
  selected_test_case_ids?: string[] | null;
  subset_filter?: Record<string, unknown> | null;
  ad_hoc_question?: string | null;
  /** Override op het aantal iteraties per testcase. */
  iteraties?: number | null;
  notitie?: string | null;
}

export interface BatchOpties {
  workerId: string;
  limiet?: number;
  leaseSeconds?: number;
  /** Judge inschakelen (default true). Uit = judge-criteria → review_vereist. */
  judgeEnabled?: boolean;
}

// Indicatieve kosten (schatting) per miljoen tokens, USD. Bewust conservatief en
// als SCHATTING gelabeld in de UI. Onbekend model → null (geen schijnprecisie).
const KOSTEN_PER_MTOK: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-haiku-4-5-20251001": { in: 0.8, out: 4 },
};
function schatKosten(model: string, tin: number, tout: number): number | null {
  const p = KOSTEN_PER_MTOK[model];
  if (!p) return null;
  return Number(((tin / 1_000_000) * p.in + (tout / 1_000_000) * p.out).toFixed(6));
}

async function logAqlab(
  svc: SupabaseClient,
  actie: string,
  objectType: string,
  objectId: string | null,
  nieuweWaarde?: Record<string, unknown>
): Promise<void> {
  await svc.from("aqlab_log").insert({
    actie,
    object_type: objectType,
    object_id: objectId,
    nieuwe_waarde: nieuweWaarde ?? null,
  });
}

// ── planRun ──────────────────────────────────────────────────────────────────
export async function planRun(
  svc: SupabaseClient,
  config: RunConfig
): Promise<{ run_id: string; aantalJobs: number }> {
  const runType = config.run_type ?? "full_regression";

  const { data: runRow, error: runErr } = await svc
    .from("aqlab_runs")
    .insert({
      run_type: runType,
      test_set_id: config.test_set_id ?? null,
      prompt_version_id: config.prompt_version_id ?? null,
      model_configuration_id: config.model_configuration_id ?? null,
      status: "queued",
      persist_mode: config.persist_mode ?? "full_synthetic",
      kostenplafond: config.kostenplafond ?? null,
      subset_filter: config.subset_filter ?? null,
      selected_test_case_ids: config.selected_test_case_ids ?? null,
      ad_hoc_question: config.ad_hoc_question ?? null,
      notitie: config.notitie ?? null,
      gestart_door: config.gestart_door ?? null,
    })
    .select("id")
    .single();
  if (runErr || !runRow) throw new Error(`aqlab_runs insert mislukt: ${runErr?.message}`);
  const run_id = runRow.id as string;

  // Bepaal de testcases + iteraties.
  type TcRij = {
    id: string;
    consistency_required: boolean | null;
    consistency_iterations: number | null;
    herhalingen: number | null;
  };
  let testcases: TcRij[] = [];

  if (runType === "ad_hoc") {
    // Ad-hoc: één synthetische vraag, geen testcase. iteraties default 1.
    const n = Math.max(1, config.iteraties ?? 1);
    const jobs = Array.from({ length: n }, (_, i) => ({
      run_id,
      test_case_id: null,
      iteratie: i + 1,
    }));
    await svc.from("aqlab_run_jobs").insert(jobs);
    await logAqlab(svc, "run_gepland", "aqlab_runs", run_id, { run_type: runType, jobs: jobs.length });
    return { run_id, aantalJobs: jobs.length };
  }

  let q = svc
    .from("aqlab_test_cases")
    .select("id, consistency_required, consistency_iterations, herhalingen")
    .eq("actief", true);
  if (runType === "subset" && config.selected_test_case_ids?.length) {
    q = q.in("id", config.selected_test_case_ids);
  } else if (config.test_set_id) {
    q = q.eq("test_set_id", config.test_set_id);
  }
  const { data: tcRows, error: tcErr } = await q;
  if (tcErr) throw new Error(`aqlab_test_cases select mislukt: ${tcErr.message}`);
  testcases = (tcRows ?? []) as TcRij[];

  const jobs: { run_id: string; test_case_id: string; iteratie: number }[] = [];
  for (const tc of testcases) {
    const iteraties =
      config.iteraties ??
      (tc.consistency_required ? tc.consistency_iterations ?? 3 : 1);
    for (let i = 1; i <= Math.max(1, iteraties); i++) {
      jobs.push({ run_id, test_case_id: tc.id, iteratie: i });
    }
  }
  if (jobs.length > 0) {
    // Idempotent: unieke (run, testcase, iteratie) — negeer dubbele inserts.
    const { error: jobErr } = await svc
      .from("aqlab_run_jobs")
      .upsert(jobs, { onConflict: "run_id,test_case_id,iteratie", ignoreDuplicates: true });
    if (jobErr) throw new Error(`aqlab_run_jobs insert mislukt: ${jobErr.message}`);
  }
  await logAqlab(svc, "run_gepland", "aqlab_runs", run_id, { run_type: runType, jobs: jobs.length });
  return { run_id, aantalJobs: jobs.length };
}

// ── Model-config laden ───────────────────────────────────────────────────────
async function laadModelConfig(
  svc: SupabaseClient,
  modelConfigId: string | null | undefined
): Promise<AdapterModelConfig> {
  if (!modelConfigId) return {};
  const { data } = await svc
    .from("aqlab_model_configurations")
    .select("model_name, temperature_requested, max_tokens_requested, top_p_requested, retrieval_settings")
    .eq("id", modelConfigId)
    .maybeSingle();
  if (!data) return {};
  return {
    model: (data.model_name as string) || undefined,
    maxTokens: (data.max_tokens_requested as number) ?? undefined,
    temperature: (data.temperature_requested as number | null) ?? undefined,
    topP: (data.top_p_requested as number | null) ?? undefined,
    retrievalSettings: (data.retrieval_settings as Record<string, unknown>) ?? undefined,
  };
}

// ── Fixtures voor een testcase resolven (titels uit DB, tekst uit repo-MD) ───
async function laadFixtures(
  svc: SupabaseClient,
  fixtureIds: string[]
): Promise<FixtureContext[]> {
  if (fixtureIds.length === 0) return [];
  const { data } = await svc
    .from("aqlab_fixture_documents")
    .select("code, titel")
    .in("code", fixtureIds);
  const titels = new Map((data ?? []).map((r) => [r.code as string, r.titel as string]));
  const out: FixtureContext[] = [];
  for (const id of fixtureIds) {
    const tekst = fixtureTekst(id);
    if (!tekst) continue; // ontbrekende fixture stil overslaan (best-effort)
    out.push({ fixture_id: id, titel: titels.get(id) ?? id, tekst });
  }
  return out;
}

// ── Eén job verwerken ────────────────────────────────────────────────────────
interface RunRij {
  id: string;
  status: string;
  persist_mode: PersistMode;
  model_configuration_id: string | null;
  prompt_version_id: string | null;
  ad_hoc_question: string | null;
  kostenplafond: number | null;
  totale_kosten: number | null;
}

async function verwerkJob(
  svc: SupabaseClient,
  run: RunRij,
  job: { id: string; test_case_id: string | null; iteratie: number },
  judgeEnabled: boolean
): Promise<{ kosten: number }> {
  // Testcase + spec.
  let spec: TestcaseSpec = {};
  let vraag = run.ad_hoc_question ?? "";
  let rol: string | undefined;
  let reviewVerplicht = false;
  let criteria: string[] = [];

  if (job.test_case_id) {
    const { data: tc } = await svc
      .from("aqlab_test_cases")
      .select("spec, gebruikersvraag, gebruikersrol, review_verplicht")
      .eq("id", job.test_case_id)
      .maybeSingle();
    if (tc) {
      spec = (tc.spec as TestcaseSpec) ?? {};
      vraag = (tc.gebruikersvraag as string) || spec.expected_answer_outline?.must_contain?.[0] || vraag;
      rol = (tc.gebruikersrol as string) || undefined;
      reviewVerplicht = tc.review_verplicht === true || spec.review_required === true;
      criteria = Array.isArray(spec.checks) ? spec.checks : [];
    }
  }

  const modelConfig = await laadModelConfig(svc, run.model_configuration_id);
  const fixtures = await laadFixtures(svc, spec.required_source_ids ?? []);

  // Generatie via de productiekern.
  const gen = await genereerViaAdapter({ vraag, rol, fixtures, modelConfig });

  // Evaluatie.
  const evalResultaat = await evalueerOutput(
    {
      vraag,
      antwoord: gen.antwoord,
      bronnenAantal: gen.bronnenAantal,
      bronContext: gen.contextTekst,
      spec,
      snapshotRefs: gen.snapshot_refs.fixture_ids,
      criteria,
      reviewVerplicht,
    },
    judgeEnabled
      ? { judge: (c: JudgeCriterium, inp: JudgeInput) => beoordeelMetJudge(c, inp) }
      : {}
  );

  const kosten =
    schatKosten(gen.effectieveInstellingen.model_name, gen.tokengebruik.in, gen.tokengebruik.out) ?? 0;

  // Persist conform persist_mode.
  if (run.persist_mode !== "none") {
    const metadataOnly = run.persist_mode === "metadata_only";
    const eff = gen.effectieveInstellingen;

    // Idempotent REPLACE per (run, testcase, iteratie): verwijder een bestaande
    // output eerst — de delete cascadeert scores + findings weg — en schrijf dan
    // vers. Dit maakt herclaims/retries dubbel-vrij én lost de NULLS-DISTINCT-val
    // op voor ad-hoc (test_case_id NULL), waar ON CONFLICT nooit zou matchen.
    let del = svc.from("aqlab_run_outputs").delete().eq("run_id", run.id).eq("iteratie", job.iteratie);
    del = job.test_case_id ? del.eq("test_case_id", job.test_case_id) : del.is("test_case_id", null);
    await del;

    // metadata_only: sla GEEN vrije tekst op — ook niet de judge-motivatie/-bewijs,
    // dat letterlijke fragmenten uit antwoord/bron kan citeren (privacy/persist_mode).
    const redigeer = (s: (typeof evalResultaat.scores)[number]) =>
      metadataOnly && s.methode === "llm_judge";

    const { data: outRow, error: outErr } = await svc
      .from("aqlab_run_outputs")
      .insert({
        run_id: run.id,
        test_case_id: job.test_case_id,
        iteratie: job.iteratie,
        inputvraag: metadataOnly ? null : vraag,
        gebruikte_context: metadataOnly ? null : { tekst: gen.contextTekst },
        gegenereerd_antwoord: metadataOnly ? null : gen.antwoord,
        gebruikte_bronnen: metadataOnly ? null : gen.bronnen,
        herkomstlabels: metadataOnly ? null : { citaties: gen.citaties },
        snapshot_refs: gen.snapshot_refs,
        snapshot_hash: gen.snapshot_hash,
        retrieval_filter: null,
        model_name: eff.model_name,
        temperature_effective: eff.temperature_effective,
        max_tokens_effective: eff.max_tokens_effective,
        top_p_effective: eff.top_p_effective,
        provider_default_used: eff.provider_default_used,
        retrieval_settings_effective: gen.retrieval_settings_effective,
        prompt_version_id: run.prompt_version_id,
        tokengebruik: gen.tokengebruik,
        latency_ms: gen.latency_ms,
        kosten_indicatie: kosten,
        quality_score: evalResultaat.quality_score,
        gate_status: evalResultaat.gate_status,
      })
      .select("id")
      .single();
    if (outErr || !outRow) throw new Error(`aqlab_run_outputs insert mislukt: ${outErr?.message}`);
    const outputId = outRow.id as string;

    // Scores + per-score findings (verse insert; de delete hierboven ruimde oude op).
    for (const s of evalResultaat.scores) {
      const geredigeerd = redigeer(s);
      const { data: scoreRow } = await svc
        .from("aqlab_scores")
        .insert({
          run_output_id: outputId,
          criterium_code: s.criterium_code,
          methode: s.methode,
          score: s.score,
          pass: s.pass,
          // In metadata_only geen citaat-dragende judge-tekst opslaan.
          motivatie: geredigeerd ? "(motivatie niet bewaard in metadata_only)" : s.motivatie,
          bewijs: geredigeerd ? null : s.bewijs ?? null,
          judge_model: s.judge_model ?? null,
        })
        .select("id")
        .single();
      const scoreId = scoreRow?.id as string | undefined;
      if (s.findings.length > 0) {
        await svc.from("aqlab_findings").insert(
          s.findings.map((f) => ({
            score_id: scoreId ?? null,
            run_output_id: outputId,
            type: f.type,
            ernst: f.ernst,
            omschrijving: f.omschrijving,
            fragment: f.fragment ?? null,
          }))
        );
      }
    }
    // Aggregatie-findings (dimensievloeren) zonder score_id.
    if (evalResultaat.vloerFindings.length > 0) {
      await svc.from("aqlab_findings").insert(
        evalResultaat.vloerFindings.map((f) => ({
          score_id: null,
          run_output_id: outputId,
          type: f.type,
          ernst: f.ernst,
          omschrijving: f.omschrijving,
          fragment: f.fragment ?? null,
        }))
      );
    }
  }

  await logAqlab(svc, "output_gescoord", "aqlab_runs", run.id, {
    test_case_id: job.test_case_id,
    iteratie: job.iteratie,
    gate_status: evalResultaat.gate_status,
    quality_score: evalResultaat.quality_score,
  });

  return { kosten };
}

// ── verwerkBatch ─────────────────────────────────────────────────────────────
export async function verwerkBatch(
  svc: SupabaseClient,
  opts: BatchOpties
): Promise<{ verwerkt: number; afgerond: string[] }> {
  const limiet = opts.limiet ?? 5;
  const leaseSeconds = opts.leaseSeconds ?? 120;
  const judgeEnabled = opts.judgeEnabled ?? true;

  const { data: claimed, error: claimErr } = await svc.rpc("aqlab_claim_run_jobs", {
    p_worker_id: opts.workerId,
    p_limit: limiet,
    p_lease_seconds: leaseSeconds,
  });
  if (claimErr) throw new Error(`claim mislukt: ${claimErr.message}`);
  const jobs = (claimed ?? []) as {
    id: string;
    run_id: string;
    test_case_id: string | null;
    iteratie: number;
    attempts: number;
    max_attempts: number;
  }[];

  const runCache = new Map<string, RunRij>();
  async function laadRun(runId: string): Promise<RunRij | null> {
    if (runCache.has(runId)) return runCache.get(runId)!;
    const { data } = await svc
      .from("aqlab_runs")
      .select("id, status, persist_mode, model_configuration_id, prompt_version_id, ad_hoc_question, kostenplafond, totale_kosten")
      .eq("id", runId)
      .maybeSingle();
    if (!data) return null;
    const r = data as RunRij;
    runCache.set(runId, r);
    return r;
  }

  let verwerkt = 0;
  const geraakteRuns = new Set<string>();

  for (const job of jobs) {
    const run = await laadRun(job.run_id);
    if (!run) continue;
    geraakteRuns.add(run.id);

    // Cancellation: run geannuleerd → job overslaan.
    if (run.status === "cancelled") {
      await svc.from("aqlab_run_jobs").update({ status: "overgeslagen", bijgewerkt_op: new Date().toISOString() }).eq("id", job.id);
      continue;
    }
    // Kostenplafond bereikt → resterende job overslaan.
    if (run.kostenplafond != null && (run.totale_kosten ?? 0) >= run.kostenplafond) {
      await svc.from("aqlab_run_jobs").update({ status: "overgeslagen", foutcode: "kostenplafond", bijgewerkt_op: new Date().toISOString() }).eq("id", job.id);
      continue;
    }
    // Zet run op 'running' bij eerste verwerkte job.
    if (run.status === "queued") {
      await svc.from("aqlab_runs").update({ status: "running" }).eq("id", run.id);
      run.status = "running";
    }

    try {
      const { kosten } = await verwerkJob(svc, run, job, judgeEnabled);
      await svc.from("aqlab_run_jobs").update({ status: "klaar", bijgewerkt_op: new Date().toISOString() }).eq("id", job.id);
      verwerkt++;
      // Kosten atomair optellen (RPC) zodat het kostenplafond ook onder
      // overlappende worker-invocaties correct blijft (geen lost-update).
      const { data: nieuweKosten } = await svc.rpc("aqlab_add_run_cost", {
        p_run_id: run.id,
        p_delta: kosten,
      });
      run.totale_kosten =
        typeof nieuweKosten === "number" ? nieuweKosten : (run.totale_kosten ?? 0) + kosten;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Best-effort: fout stopt de run niet. Begrensde retry.
      const opnieuw = job.attempts < job.max_attempts;
      await svc
        .from("aqlab_run_jobs")
        .update({
          status: opnieuw ? "wachtend" : "mislukt",
          foutcode: msg.slice(0, 200),
          lease_expires_at: null,
          bijgewerkt_op: new Date().toISOString(),
        })
        .eq("id", job.id);
      await logAqlab(svc, "output_fout", "aqlab_runs", run.id, {
        test_case_id: job.test_case_id,
        iteratie: job.iteratie,
        foutcode: msg.slice(0, 200),
        retry: opnieuw,
      });
    }
  }

  // Rond runs af die geen open jobs meer hebben.
  const afgerond: string[] = [];
  for (const runId of geraakteRuns) {
    if (await rondRunAfIndienKlaar(svc, runId)) afgerond.push(runId);
  }
  return { verwerkt, afgerond };
}

/** Rondt een run af (done + performance-aggregatie) als er geen open jobs meer zijn. */
export async function rondRunAfIndienKlaar(svc: SupabaseClient, runId: string): Promise<boolean> {
  const { count } = await svc
    .from("aqlab_run_jobs")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .in("status", ["wachtend", "bezig"]);
  if ((count ?? 0) > 0) return false;

  const { data: runRow } = await svc.from("aqlab_runs").select("status, aggregatie, totale_kosten").eq("id", runId).maybeSingle();
  if (!runRow || runRow.status === "done" || runRow.status === "cancelled") return false;

  // Performance-aggregatie uit de outputs.
  const { data: outs } = await svc
    .from("aqlab_run_outputs")
    .select("test_case_id, latency_ms, tokengebruik, gate_status")
    .eq("run_id", runId);
  const rows = (outs ?? []) as {
    test_case_id: string | null;
    latency_ms: number | null;
    tokengebruik: { in?: number; out?: number } | null;
    gate_status: string | null;
  }[];
  const latencies = rows.map((r) => r.latency_ms ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const perc = (p: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] : null);
  const tokensIn = rows.reduce((a, r) => a + (r.tokengebruik?.in ?? 0), 0);
  const tokensUit = rows.reduce((a, r) => a + (r.tokengebruik?.out ?? 0), 0);
  // Langzaamste testcase.
  let langzaamste: string | null = null;
  let maxLat = -1;
  for (const r of rows) {
    if ((r.latency_ms ?? 0) > maxLat) { maxLat = r.latency_ms ?? 0; langzaamste = r.test_case_id; }
  }
  const geblokkeerd = rows.filter((r) => r.gate_status === "geblokkeerd").length;
  const reviewVereist = rows.filter((r) => r.gate_status === "review_vereist").length;

  const performance = {
    outputs: rows.length,
    latency_gemiddeld: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    latency_mediaan: perc(0.5),
    latency_p95: perc(0.95),
    langzaamste_test_case_id: langzaamste,
    tokens_in: tokensIn,
    tokens_out: tokensUit,
    aantal_geblokkeerd: geblokkeerd,
    aantal_review_vereist: reviewVereist,
  };
  const aggregatie = { ...((runRow.aggregatie as Record<string, unknown>) ?? {}), performance };

  await svc
    .from("aqlab_runs")
    .update({ status: "done", voltooid_op: new Date().toISOString(), aggregatie })
    .eq("id", runId);
  await logAqlab(svc, "run_afgerond", "aqlab_runs", runId, { performance });
  return true;
}

/** Annuleert een run (resterende jobs worden door de worker overgeslagen). */
export async function annuleerRun(svc: SupabaseClient, runId: string): Promise<void> {
  await svc.from("aqlab_runs").update({ status: "cancelled", voltooid_op: new Date().toISOString() }).eq("id", runId);
  await svc.from("aqlab_run_jobs").update({ status: "overgeslagen", bijgewerkt_op: new Date().toISOString() }).eq("run_id", runId).eq("status", "wachtend");
  await logAqlab(svc, "run_geannuleerd", "aqlab_runs", runId);
}
