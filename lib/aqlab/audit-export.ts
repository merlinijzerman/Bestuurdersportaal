// lib/aqlab/audit-export.ts
// -----------------------------------------------------------------------------
// AQLab — auditexport-service DB-orchestratie (AQL-4, technisch §5.7). Genereert
// een BEVROREN HTML-auditrapport, berekent de inhoud_hash (sha256), slaat de
// bytes op in de private Storage-bucket 'aqlab-audit' en legt de export
// APPEND-ONLY vast in aqlab_audit_exports. Verificatie = opgeslagen bytes opnieuw
// hashen en met de vastgelegde inhoud_hash vergelijken.
//
// "server-only": raakt de service-role client (svc) + Storage. De aqlab_-tabellen
// en de bucket zijn deny-by-default; schrijven loopt via de service-role ACHTER de
// withPlatform-capability+audit-wrapper (aanroeper, CAP_OPERATE/CAP_GOVERN).
// -----------------------------------------------------------------------------

import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "./seed/canonical";
import {
  renderAqlabAuditHtml,
  type AqlabAuditFinding,
  type AqlabAuditReview,
  type AqlabAuditScore,
  type AqlabAuditView,
} from "./audit-html";

const BUCKET = "aqlab-audit";

export interface GenereerAuditInput {
  run_id: string;
  /** Het besluit dat dit rapport bevriest (of null bij een tussenrapport). */
  besluit: "vrijgegeven" | "geblokkeerd" | null;
  besluit_door: string | null;
  /** auth.users.id van wie de export genereert (gegenereerd_door). */
  gegenereerd_door: string | null;
}

export interface GenereerAuditResultaat {
  ok: boolean;
  reden: string | null;
  id: string | null;
  inhoud_hash: string | null;
  opslag_ref: string | null;
}

/** Best-effort id→naam uit platform_identities (auditrapport toont namen). */
async function haalNamen(svc: SupabaseClient, ids: (string | null)[]): Promise<Map<string, string>> {
  const uniek = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  if (!uniek.length) return out;
  const { data } = await svc.from("platform_identities").select("id, naam").in("id", uniek);
  for (const r of (data ?? []) as { id: string; naam: string }[]) out.set(r.id, r.naam);
  return out;
}

/**
 * Bouwt de zelf-bevattende AqlabAuditView uit de DB (bevriest de run-toestand op
 * dit moment). Geeft null als de run niet bestaat.
 */
export async function bouwAuditView(
  svc: SupabaseClient,
  input: GenereerAuditInput,
  nu: string
): Promise<AqlabAuditView | null> {
  const { data: runData } = await svc
    .from("aqlab_runs")
    .select("id, run_type, gestart_op, voltooid_op, test_set_id, prompt_version_id, model_configuration_id, aggregatie")
    .eq("id", input.run_id)
    .maybeSingle();
  const run = runData as {
    id: string; run_type: string; gestart_op: string | null; voltooid_op: string | null;
    test_set_id: string | null; prompt_version_id: string | null; model_configuration_id: string | null;
    aggregatie: Record<string, unknown> | null;
  } | null;
  if (!run) return null;

  // Feature via test_set.
  let featureCode = "—", featureNaam = "—", testsetCode: string | null = null, testsetNaam: string | null = null;
  if (run.test_set_id) {
    const { data: ts } = await svc
      .from("aqlab_test_sets").select("code, naam, feature_id").eq("id", run.test_set_id).maybeSingle();
    const tsRow = ts as { code: string; naam: string; feature_id: string | null } | null;
    testsetCode = tsRow?.code ?? null;
    testsetNaam = tsRow?.naam ?? null;
    if (tsRow?.feature_id) {
      const { data: feat } = await svc
        .from("aqlab_ai_features").select("code, naam").eq("id", tsRow.feature_id).maybeSingle();
      const f = feat as { code: string; naam: string } | null;
      if (f) { featureCode = f.code; featureNaam = f.naam; }
    }
  }

  // Variant: promptversie + modelconfig.
  let promptVersie: string | null = null;
  if (run.prompt_version_id) {
    const { data: pv } = await svc
      .from("aqlab_prompt_versions").select("soort, versie").eq("id", run.prompt_version_id).maybeSingle();
    const p = pv as { soort: string; versie: number } | null;
    if (p) promptVersie = `${p.soort} v${p.versie}`;
  }
  let modelConfig: string | null = null;
  if (run.model_configuration_id) {
    const { data: mc } = await svc
      .from("aqlab_model_configurations").select("naam, model_name, model_version").eq("id", run.model_configuration_id).maybeSingle();
    const m = mc as { naam: string; model_name: string; model_version: string | null } | null;
    if (m) modelConfig = `${m.naam} (${m.model_name}${m.model_version ? ` ${m.model_version}` : ""})`;
  }

  // Outputs van de run (voor scores/findings/reviews/snapshots/aantal).
  const { data: outs } = await svc
    .from("aqlab_run_outputs").select("id, test_case_id, snapshot_hash").eq("run_id", run.id);
  const outputs = (outs ?? []) as { id: string; test_case_id: string | null; snapshot_hash: string | null }[];
  const outputIds = outputs.map((o) => o.id);
  const aantalTestgevallen = new Set(outputs.map((o) => o.test_case_id).filter(Boolean)).size;
  const snapshotHashes = [...new Set(outputs.map((o) => o.snapshot_hash).filter((x): x is string => !!x))];

  // Scores → geaggregeerd per criterium.
  const scores: AqlabAuditScore[] = [];
  if (outputIds.length) {
    const { data: sc } = await svc
      .from("aqlab_scores").select("criterium_code, methode, score, pass").in("run_output_id", outputIds);
    const per = new Map<string, { methode: string; scores: number[]; passes: boolean[] }>();
    for (const s of (sc ?? []) as { criterium_code: string; methode: string; score: number | null; pass: boolean | null }[]) {
      const g = per.get(s.criterium_code) ?? { methode: s.methode, scores: [], passes: [] };
      if (typeof s.score === "number") g.scores.push(s.score);
      if (typeof s.pass === "boolean") g.passes.push(s.pass);
      per.set(s.criterium_code, g);
    }
    for (const [crit, g] of per) {
      scores.push({
        criterium: crit,
        methode: g.methode,
        score: g.scores.length ? Math.round(g.scores.reduce((a, b) => a + b, 0) / g.scores.length) : null,
        pass: g.passes.length ? g.passes.every(Boolean) : null,
        motivatie: null,
        meetbeperking: g.methode === "llm_judge" ? "Judge is adviserend, nooit enige blokkadegrond." : null,
      });
    }
  }

  // Findings (volledig — platform-audit; nooit in de fonds-view).
  const findings: AqlabAuditFinding[] = [];
  if (outputIds.length) {
    const { data: fnd } = await svc
      .from("aqlab_findings").select("ernst, type, omschrijving, status").in("run_output_id", outputIds);
    for (const f of (fnd ?? []) as AqlabAuditFinding[]) findings.push(f);
  }

  // Human reviews.
  const reviews: AqlabAuditReview[] = [];
  const reviewRows: { reviewer_id: string | null; oordeel: string; motivatie: string | null; beoordeeld_op: string }[] = [];
  if (outputIds.length) {
    const { data: hr } = await svc
      .from("aqlab_human_reviews").select("reviewer_id, oordeel, motivatie, beoordeeld_op").in("run_output_id", outputIds);
    for (const r of (hr ?? []) as typeof reviewRows) reviewRows.push(r);
  }

  const namen = await haalNamen(svc, [input.besluit_door, input.gegenereerd_door, ...reviewRows.map((r) => r.reviewer_id)]);
  for (const r of reviewRows) {
    reviews.push({ oordeel: r.oordeel, motivatie: r.motivatie, door: r.reviewer_id ? namen.get(r.reviewer_id) ?? null : null, op: r.beoordeeld_op });
  }

  const regressie = (run.aggregatie?.regressie ?? null) as { release_advies?: string | null; reden?: string | null } | null;

  return {
    feature: { code: featureCode, naam: featureNaam },
    variant: { prompt_versie: promptVersie, model_config: modelConfig },
    run: { id: run.id, run_type: run.run_type, gestart_op: run.gestart_op, voltooid_op: run.voltooid_op },
    testset: { code: testsetCode, naam: testsetNaam, aantal_testgevallen: aantalTestgevallen },
    snapshot_hashes: snapshotHashes,
    scores,
    findings,
    human_reviews: reviews,
    regressie: { release_advies: regressie?.release_advies ?? null, samenvatting: regressie?.reden ?? null },
    besluit: {
      release_status: input.besluit === "vrijgegeven" ? "vrijgegeven" : input.besluit === "geblokkeerd" ? "geblokkeerd" : "getest",
      besluit: input.besluit,
      besluit_door_naam: input.besluit_door ? namen.get(input.besluit_door) ?? null : null,
      besluit_op: input.besluit ? nu : null,
      motivatie: null,
      kritieke_bevindingen_count: findings.filter((f) => f.ernst === "kritiek" && f.status === "open").length,
      assurance_scope: "productbreed",
    },
    gegenereerd_op: nu,
    gegenereerd_door_naam: input.gegenereerd_door ? namen.get(input.gegenereerd_door) ?? null : null,
  };
}

/**
 * Genereert + bevriest het auditrapport: HTML → sha256 → Storage → append-only
 * aqlab_audit_exports. Retourneert de export-id + hash + opslagpad.
 */
export async function genereerAuditExport(
  svc: SupabaseClient,
  input: GenereerAuditInput,
  nu: string
): Promise<GenereerAuditResultaat> {
  const view = await bouwAuditView(svc, input, nu);
  if (!view) return { ok: false, reden: "Run niet gevonden.", id: null, inhoud_hash: null, opslag_ref: null };

  const html = renderAqlabAuditHtml(view);
  const inhoudHash = sha256(html);

  // De append-only trigger verbiedt een latere UPDATE van opslag_ref. We genereren
  // de export-id daarom client-side, zodat het opslagpad vóór de INSERT bekend is
  // en opslag_ref meteen (definitief) in de rij staat.
  const exportId = randomUUID();
  const opslagRef = `${input.run_id}/${exportId}.html`;
  const featureId = await featureIdVanRun(svc, input.run_id);

  // 1. Bytes eerst naar de private bucket (upload faalt → geen weesrij).
  const { error: upErr } = await svc.storage
    .from(BUCKET)
    .upload(opslagRef, new Blob([html], { type: "text/html; charset=utf-8" }), {
      contentType: "text/html; charset=utf-8",
      upsert: false,
    });
  if (upErr) {
    return { ok: false, reden: `Opslag mislukt: ${upErr.message}.`, id: null, inhoud_hash: inhoudHash, opslag_ref: null };
  }

  // 2. Append-only rij met de definitieve opslag_ref + inhoud_hash.
  const { error: insErr } = await svc
    .from("aqlab_audit_exports")
    .insert({
      id: exportId,
      run_id: input.run_id,
      feature_id: featureId,
      inhoud_hash: inhoudHash,
      formaat: "html",
      opslag_ref: opslagRef,
      besluit: input.besluit,
      besluit_door: input.besluit ? input.besluit_door : null,
      besluit_op: input.besluit ? nu : null,
      gegenereerd_door: input.gegenereerd_door,
    });
  if (insErr) {
    // Vastleggen mislukt: ruim de zojuist geüploade wees-bytes best-effort op.
    await svc.storage.from(BUCKET).remove([opslagRef]);
    return { ok: false, reden: `Vastleggen mislukt: ${insErr.message}.`, id: null, inhoud_hash: null, opslag_ref: null };
  }

  // 3. Append-only auditspoor ná de mutatie (CLAUDE.md).
  await svc.from("aqlab_log").insert({
    gebruiker_id: input.gegenereerd_door,
    actie: "audit_export_gegenereerd",
    object_type: "aqlab_audit_exports",
    object_id: exportId,
    nieuwe_waarde: { inhoud_hash: inhoudHash, opslag_ref: opslagRef, formaat: "html", besluit: input.besluit },
  });

  return { ok: true, reden: null, id: exportId, inhoud_hash: inhoudHash, opslag_ref: opslagRef };
}

async function featureIdVanRun(svc: SupabaseClient, runId: string): Promise<string | null> {
  const { data: run } = await svc.from("aqlab_runs").select("test_set_id").eq("id", runId).maybeSingle();
  const tsId = (run as { test_set_id: string | null } | null)?.test_set_id ?? null;
  if (!tsId) return null;
  const { data: ts } = await svc.from("aqlab_test_sets").select("feature_id").eq("id", tsId).maybeSingle();
  return (ts as { feature_id: string | null } | null)?.feature_id ?? null;
}

export interface VerifieerResultaat {
  ok: boolean;
  match: boolean;
  reden: string | null;
  opgeslagen_hash: string | null;
  herberekende_hash: string | null;
}

/** Verifieert de integriteit: download de opgeslagen bytes, herbereken sha256 en
 *  vergelijk met de vastgelegde inhoud_hash. */
export async function verifieerAuditExport(
  svc: SupabaseClient,
  exportId: string
): Promise<VerifieerResultaat> {
  const { data: row } = await svc
    .from("aqlab_audit_exports").select("inhoud_hash, opslag_ref, run_id").eq("id", exportId).maybeSingle();
  const r = row as { inhoud_hash: string; opslag_ref: string | null; run_id: string | null } | null;
  if (!r) return { ok: false, match: false, reden: "Export niet gevonden.", opgeslagen_hash: null, herberekende_hash: null };
  const pad = r.opslag_ref ?? (r.run_id ? `${r.run_id}/${exportId}.html` : null);
  if (!pad) return { ok: false, match: false, reden: "Geen opslag-referentie.", opgeslagen_hash: r.inhoud_hash, herberekende_hash: null };

  const { data: blob, error } = await svc.storage.from(BUCKET).download(pad);
  if (error || !blob) return { ok: false, match: false, reden: `Download mislukt: ${error?.message ?? "onbekend"}.`, opgeslagen_hash: r.inhoud_hash, herberekende_hash: null };
  const tekst = await blob.text();
  const herberekend = sha256(tekst);
  return {
    ok: true,
    match: herberekend === r.inhoud_hash,
    reden: null,
    opgeslagen_hash: r.inhoud_hash,
    herberekende_hash: herberekend,
  };
}
