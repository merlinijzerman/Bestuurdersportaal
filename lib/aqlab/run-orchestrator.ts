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
import {
  berekenConsistentie,
  type IteratieMeting,
  type IteratieGateStatus,
  type ConsistentieAggregaat,
} from "./consistency";
import { berekenRegressie } from "./regression";

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
  /** Door de gebruiker gekozen run-naam/label (AQL-5, terugvindbaarheid). */
  naam?: string | null;
  notitie?: string | null;
  /** Regressie-as (technisch §2.6): baseline/challenger + gewijzigde as. */
  baseline_run_id?: string | null;
  rol?: "baseline" | "challenger" | null;
  soort?: "functioneel" | "security_blocking" | null;
  gewijzigde_as?: "prompt" | "model" | "temperature" | "max_tokens" | "retrieval" | "geen" | "meerdere" | null;
  atomair?: boolean | null;
  /**
   * Consistentie expliciet aan/uit voor subset/ad-hoc (scherm 3). undefined =
   * volg de testcase-instelling (consistency_required). false = forceer 1 iteratie.
   */
  consistency_enabled?: boolean | null;
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
// AQL-6: OpenAI/Mistral-tarieven zijn INDICATIEF — verifieer tegen de actuele
// prijslijst van de provider vóór ze in een formeel kostenoordeel meewegen.
const KOSTEN_PER_MTOK: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-haiku-4-5-20251001": { in: 0.8, out: 4 },
  // Challengers (ander provider dan productie) — indicatieve tarieven.
  "gpt-4.1": { in: 3, out: 12 },
  "gpt-4.1-mini": { in: 0.8, out: 3.2 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  // Reasoning-modellen: de out-tokens omvatten óók de (gefactureerde) reasoning-
  // tokens; de effectieve kosten liggen daardoor in de praktijk hoger dan bij een
  // chat-model met hetzelfde zichtbare antwoord. Tarieven indicatief.
  "gpt-5": { in: 1.25, out: 10 },
  "gpt-5-mini": { in: 0.25, out: 2 },
  "gpt-5-nano": { in: 0.05, out: 0.4 },
  "mistral-large-latest": { in: 2, out: 6 },
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
      baseline_run_id: config.baseline_run_id ?? null,
      rol: config.rol ?? null,
      soort: config.soort ?? "functioneel",
      gewijzigde_as: config.gewijzigde_as ?? null,
      atomair: config.atomair ?? null,
      naam: config.naam ?? null,
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
    // consistency_enabled === false forceert 1 iteratie; true (of undefined bij
    // consistency_required) gebruikt de override of de testcase-instelling.
    const consistentieAan =
      config.consistency_enabled === false
        ? false
        : config.consistency_enabled === true || tc.consistency_required === true;
    const iteraties = !consistentieAan
      ? 1
      : config.iteraties ?? tc.consistency_iterations ?? 3;
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
    .select("model_provider, model_name, temperature_requested, max_tokens_requested, top_p_requested, reasoning_effort_requested, retrieval_settings")
    .eq("id", modelConfigId)
    .maybeSingle();
  if (!data) return {};
  return {
    model: (data.model_name as string) || undefined,
    provider: (data.model_provider as AdapterModelConfig["provider"]) ?? undefined,
    reasoningEffort: (data.reasoning_effort_requested as AdapterModelConfig["reasoningEffort"]) ?? undefined,
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
        model_provider: eff.model_provider,
        model_name: eff.model_name,
        temperature_effective: eff.temperature_effective,
        max_tokens_effective: eff.max_tokens_effective,
        top_p_effective: eff.top_p_effective,
        reasoning_effort_effective: eff.reasoning_effort_effective,
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

/** Extraheert stabiele bron-ids uit gebruikte_bronnen (null onder metadata_only). */
function bronIdsUit(gebruikteBronnen: unknown): string[] | null {
  if (!Array.isArray(gebruikteBronnen)) return null;
  const ids = gebruikteBronnen
    .map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      return String(o.document_id ?? o.bron ?? o.titel ?? o.nummer ?? "");
    })
    .filter((s) => s.length > 0);
  return ids.sort();
}

function retrievalIdsUit(snapshotRefs: unknown): string[] | null {
  const o = (snapshotRefs ?? {}) as Record<string, unknown>;
  const ids = o.fixture_ids;
  if (!Array.isArray(ids)) return null;
  return ids.map((x) => String(x)).sort();
}

/**
 * Berekent het consistentie-aggregaat per testcase (of "ad_hoc") uit de
 * gepersisteerde outputs + scores van een run. Werkt onder full_synthetic én
 * metadata_only (scores/gate/snapshot blijven vastgelegd); source_stability valt
 * onder metadata_only terug op de bron-check-uitkomst (bronIds = null).
 */
async function berekenConsistentieVoorRun(
  svc: SupabaseClient,
  runId: string
): Promise<Record<string, ConsistentieAggregaat>> {
  const { data: outs } = await svc
    .from("aqlab_run_outputs")
    .select("id, test_case_id, iteratie, quality_score, gate_status, gebruikte_bronnen, snapshot_refs")
    .eq("run_id", runId);
  const outputs = (outs ?? []) as {
    id: string;
    test_case_id: string | null;
    iteratie: number;
    quality_score: number | null;
    gate_status: string | null;
    gebruikte_bronnen: unknown;
    snapshot_refs: unknown;
  }[];
  if (outputs.length === 0) return {};

  const { data: scoreData } = await svc
    .from("aqlab_scores")
    .select("run_output_id, criterium_code, pass, methode")
    .in("run_output_id", outputs.map((o) => o.id));
  const scoresPer = new Map<string, { criterium_code: string; pass: boolean | null; methode: string }[]>();
  for (const s of (scoreData ?? []) as { run_output_id: string; criterium_code: string; pass: boolean | null; methode: string }[]) {
    (scoresPer.get(s.run_output_id) ?? scoresPer.set(s.run_output_id, []).get(s.run_output_id)!).push(s);
  }

  // Groepeer per testcase (ad-hoc → "ad_hoc").
  const perTc = new Map<string, IteratieMeting[]>();
  for (const o of outputs) {
    const key = o.test_case_id ?? "ad_hoc";
    const scores = scoresPer.get(o.id) ?? [];
    const passByCode: Record<string, boolean | null> = {};
    let judgeOnbetrouwbaar = false;
    for (const s of scores) {
      passByCode[s.criterium_code] = s.pass;
      if (s.methode === "llm_judge" && s.pass === null) judgeOnbetrouwbaar = true;
    }
    const gate = (o.gate_status ?? "review_vereist") as IteratieGateStatus;
    const meting: IteratieMeting = {
      iteratie: o.iteratie,
      gate_status: gate,
      quality_score: o.quality_score,
      passByCode,
      bronIds: bronIdsUit(o.gebruikte_bronnen),
      retrievalIds: retrievalIdsUit(o.snapshot_refs),
      kritiekeBlokkade: gate === "geblokkeerd",
      judgeOnbetrouwbaar,
    };
    (perTc.get(key) ?? perTc.set(key, []).get(key)!).push(meting);
  }

  // Bepaal per testcase of het governance-kritiek/safety is (5/5-regel).
  const echteTcIds = [...perTc.keys()].filter((k) => k !== "ad_hoc");
  const critMeta = new Map<string, { required: boolean; iterations: number; critical: boolean }>();
  if (echteTcIds.length) {
    const { data: tcs } = await svc
      .from("aqlab_test_cases")
      .select("id, consistency_required, consistency_iterations, soort, kritikaliteit")
      .in("id", echteTcIds);
    for (const t of (tcs ?? []) as { id: string; consistency_required: boolean; consistency_iterations: number; soort: string; kritikaliteit: string }[]) {
      critMeta.set(t.id, {
        required: t.consistency_required,
        iterations: t.consistency_iterations ?? 3,
        critical: t.soort === "security_blocking" || t.kritikaliteit === "kritiek" || (t.consistency_iterations ?? 3) >= 5,
      });
    }
  }

  const result: Record<string, ConsistentieAggregaat> = {};
  for (const [key, iteraties] of perTc) {
    // Alleen zinvol bij ≥2 iteraties óf een expliciet consistency_required geval.
    const meta = critMeta.get(key);
    if (iteraties.length < 2 && !(meta?.required)) continue;
    iteraties.sort((a, b) => a.iteratie - b.iteratie);
    const critical = key === "ad_hoc" ? iteraties.length >= 5 : meta?.critical ?? false;
    result[key] = berekenConsistentie(iteraties, {
      iterations: meta?.iterations ?? iteraties.length,
      consistency_required: meta?.required ?? key === "ad_hoc",
      critical,
    });
  }
  return result;
}

/** Rondt een run af (done + performance-aggregatie) als er geen open jobs meer zijn. */
export async function rondRunAfIndienKlaar(svc: SupabaseClient, runId: string): Promise<boolean> {
  const { count } = await svc
    .from("aqlab_run_jobs")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .in("status", ["wachtend", "bezig"]);
  if ((count ?? 0) > 0) return false;

  const { data: runRow } = await svc.from("aqlab_runs").select("status, aggregatie, totale_kosten, baseline_run_id").eq("id", runId).maybeSingle();
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
  // Consistentie-aggregaat per testcase (ADR 0056) uit de gepersisteerde outputs.
  const consistency = await berekenConsistentieVoorRun(svc, runId);
  const aggregatie = { ...((runRow.aggregatie as Record<string, unknown>) ?? {}), performance, consistency };

  await svc
    .from("aqlab_runs")
    .update({ status: "done", voltooid_op: new Date().toISOString(), aggregatie })
    .eq("id", runId);
  await logAqlab(svc, "run_afgerond", "aqlab_runs", runId, {
    performance,
    consistency_testcases: Object.keys(consistency).length,
  });

  // Regressie challenger-vs-baseline (indien baseline gezet). Best-effort: een
  // fout in de regressieberekening mag het afronden van de run niet blokkeren.
  if ((runRow as { baseline_run_id?: string | null }).baseline_run_id) {
    try {
      await berekenRegressie(svc, runId, new Date().toISOString());
    } catch (e) {
      await logAqlab(svc, "regressie_fout", "aqlab_runs", runId, {
        foutcode: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
    }
  }
  return true;
}

/** Annuleert een run (resterende jobs worden door de worker overgeslagen). */
export async function annuleerRun(svc: SupabaseClient, runId: string): Promise<void> {
  await svc.from("aqlab_runs").update({ status: "cancelled", voltooid_op: new Date().toISOString() }).eq("id", runId);
  await svc.from("aqlab_run_jobs").update({ status: "overgeslagen", bijgewerkt_op: new Date().toISOString() }).eq("run_id", runId).eq("status", "wachtend");
  await logAqlab(svc, "run_geannuleerd", "aqlab_runs", runId);
}

// ── Synchrone ad-hoc consistentietest (AQL-3, scherm 6b) ──────────────────────
// Draait N≤5 iteraties IN-PROCES (niet via de async job-queue) zodat het resultaat
// direct getoond kan worden. Respecteert persist_mode STRIKT: bij 'none' wordt
// niets persistent opgeslagen (alleen teruggegeven voor weergave). Bij
// metadata_only/full_synthetic wordt een ad-hoc run + outputs + scores +
// consistency-aggregaat weggeschreven.
export interface AdHocConsistentieConfig {
  vraag: string;
  rol?: string | null;
  fixtureIds?: string[];
  model_configuration_id?: string | null;
  /**
   * Inline (niet-gepersisteerde) modelconfig. Wint van model_configuration_id.
   * Gebruikt door de synchrone ad-hoc-test (AQL-6.1): de allowlist-modelkeuze wordt
   * meegegeven zonder een aqlab_model_configurations-rij te pinnen, zodat een
   * ad-hoc-test bij persist_mode = none écht niets persistent achterlaat.
   */
  modelConfig?: AdapterModelConfig;
  prompt_version_id?: string | null;
  iteraties: number;
  persist_mode: PersistMode;
  gestart_door?: string | null;
  judgeEnabled?: boolean;
  notitie?: string | null;
}

export interface AdHocIteratieView {
  iteratie: number;
  antwoord: string | null;
  bronnen: unknown;
  bronContext: string | null;
  quality_score: number;
  gate_status: string;
  latency_ms: number;
  tokengebruik: { in: number; out: number };
  kosten_indicatie: number | null;
}

export interface AdHocConsistentieResultaat {
  aggregaat: ConsistentieAggregaat;
  iteraties: AdHocIteratieView[];
  persisted: boolean;
  run_id: string | null;
  persist_mode: PersistMode;
  vraag: string;
}

export async function draaiAdHocConsistentieSync(
  svc: SupabaseClient,
  config: AdHocConsistentieConfig
): Promise<AdHocConsistentieResultaat> {
  const n = Math.max(2, Math.min(5, config.iteraties || 3));
  const persistMode = config.persist_mode;
  const judgeEnabled = config.judgeEnabled ?? true;
  const spec: TestcaseSpec = {};
  const criteria: string[] = [];

  const modelConfig = config.modelConfig ?? await laadModelConfig(svc, config.model_configuration_id);
  const fixtures = await laadFixtures(svc, config.fixtureIds ?? []);

  const metingen: IteratieMeting[] = [];
  const views: AdHocIteratieView[] = [];
  // In-memory bewaren voor de (optionele) persistentie ná de berekening.
  const teBewaren: {
    iteratie: number;
    gen: Awaited<ReturnType<typeof genereerViaAdapter>>;
    evalResultaat: Awaited<ReturnType<typeof evalueerOutput>>;
    kosten: number;
  }[] = [];

  for (let i = 1; i <= n; i++) {
    const gen = await genereerViaAdapter({ vraag: config.vraag, rol: config.rol ?? undefined, fixtures, modelConfig });
    const evalResultaat = await evalueerOutput(
      {
        vraag: config.vraag,
        antwoord: gen.antwoord,
        bronnenAantal: gen.bronnenAantal,
        bronContext: gen.contextTekst,
        spec,
        snapshotRefs: gen.snapshot_refs.fixture_ids,
        criteria,
        reviewVerplicht: false,
      },
      judgeEnabled ? { judge: (c: JudgeCriterium, inp: JudgeInput) => beoordeelMetJudge(c, inp) } : {}
    );
    const kosten = schatKosten(gen.effectieveInstellingen.model_name, gen.tokengebruik.in, gen.tokengebruik.out) ?? 0;

    const passByCode: Record<string, boolean | null> = {};
    let judgeOnbetrouwbaar = false;
    for (const s of evalResultaat.scores) {
      passByCode[s.criterium_code] = s.pass;
      if (s.methode === "llm_judge" && s.pass === null) judgeOnbetrouwbaar = true;
    }
    metingen.push({
      iteratie: i,
      gate_status: evalResultaat.gate_status,
      quality_score: evalResultaat.quality_score,
      passByCode,
      bronIds: bronIdsUit(gen.bronnen),
      retrievalIds: retrievalIdsUit(gen.snapshot_refs),
      kritiekeBlokkade: evalResultaat.gate_status === "geblokkeerd",
      judgeOnbetrouwbaar,
    });
    views.push({
      iteratie: i,
      antwoord: persistMode === "metadata_only" ? null : gen.antwoord,
      bronnen: persistMode === "metadata_only" ? null : gen.bronnen,
      bronContext: persistMode === "metadata_only" ? null : gen.contextTekst,
      quality_score: evalResultaat.quality_score,
      gate_status: evalResultaat.gate_status,
      latency_ms: gen.latency_ms,
      tokengebruik: gen.tokengebruik,
      kosten_indicatie: kosten,
    });
    teBewaren.push({ iteratie: i, gen, evalResultaat, kosten });
  }

  const aggregaat = berekenConsistentie(metingen, {
    iterations: n,
    consistency_required: true,
    critical: n >= 5,
  });

  // persist_mode = none → NIETS persistent (alleen tonen). Geen run-rij, geen outputs.
  if (persistMode === "none") {
    return { aggregaat, iteraties: views, persisted: false, run_id: null, persist_mode: persistMode, vraag: config.vraag };
  }

  // metadata_only / full_synthetic → run-rij + outputs + scores + aggregaat.
  const { data: runRow, error: runErr } = await svc
    .from("aqlab_runs")
    .insert({
      run_type: "ad_hoc",
      status: "running",
      persist_mode: persistMode,
      ad_hoc_question: config.vraag,
      model_configuration_id: config.model_configuration_id ?? null,
      prompt_version_id: config.prompt_version_id ?? null,
      notitie: config.notitie ?? null,
      gestart_door: config.gestart_door ?? null,
    })
    .select("id")
    .single();
  if (runErr || !runRow) throw new Error(`ad-hoc run insert mislukt: ${runErr?.message}`);
  const run_id = runRow.id as string;
  await logAqlab(svc, "adhoc_consistentie_gestart", "aqlab_runs", run_id, { iteraties: n, persist_mode: persistMode });

  const metadataOnly = persistMode === "metadata_only";
  let totaleKosten = 0;
  for (const b of teBewaren) {
    const eff = b.gen.effectieveInstellingen;
    totaleKosten += b.kosten;
    const { data: outRow } = await svc
      .from("aqlab_run_outputs")
      .insert({
        run_id,
        test_case_id: null,
        iteratie: b.iteratie,
        inputvraag: metadataOnly ? null : config.vraag,
        gebruikte_context: metadataOnly ? null : { tekst: b.gen.contextTekst },
        gegenereerd_antwoord: metadataOnly ? null : b.gen.antwoord,
        gebruikte_bronnen: metadataOnly ? null : b.gen.bronnen,
        herkomstlabels: metadataOnly ? null : { citaties: b.gen.citaties },
        snapshot_refs: b.gen.snapshot_refs,
        snapshot_hash: b.gen.snapshot_hash,
        model_provider: eff.model_provider,
        model_name: eff.model_name,
        temperature_effective: eff.temperature_effective,
        max_tokens_effective: eff.max_tokens_effective,
        top_p_effective: eff.top_p_effective,
        reasoning_effort_effective: eff.reasoning_effort_effective,
        provider_default_used: eff.provider_default_used,
        retrieval_settings_effective: b.gen.retrieval_settings_effective,
        prompt_version_id: config.prompt_version_id ?? null,
        tokengebruik: b.gen.tokengebruik,
        latency_ms: b.gen.latency_ms,
        kosten_indicatie: b.kosten,
        quality_score: b.evalResultaat.quality_score,
        gate_status: b.evalResultaat.gate_status,
      })
      .select("id")
      .single();
    const outputId = outRow?.id as string | undefined;
    if (outputId) {
      for (const s of b.evalResultaat.scores) {
        const geredigeerd = metadataOnly && s.methode === "llm_judge";
        await svc.from("aqlab_scores").insert({
          run_output_id: outputId,
          criterium_code: s.criterium_code,
          methode: s.methode,
          score: s.score,
          pass: s.pass,
          motivatie: geredigeerd ? "(motivatie niet bewaard in metadata_only)" : s.motivatie,
          bewijs: geredigeerd ? null : s.bewijs ?? null,
          judge_model: s.judge_model ?? null,
        });
      }
    }
  }

  const aggregatie = { consistency: { ad_hoc: aggregaat } };
  await svc
    .from("aqlab_runs")
    .update({ status: "done", voltooid_op: new Date().toISOString(), aggregatie, totale_kosten: totaleKosten })
    .eq("id", run_id);
  await logAqlab(svc, "adhoc_consistentie_afgerond", "aqlab_runs", run_id, {
    consistency_status: aggregaat.consistency_status,
    release_eligible: aggregaat.release_eligible,
  });

  return { aggregaat, iteraties: views, persisted: true, run_id, persist_mode: persistMode, vraag: config.vraag };
}
