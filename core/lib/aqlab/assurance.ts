// lib/aqlab/assurance.ts
// -----------------------------------------------------------------------------
// AQLab — assurance-service (AQL-4, technisch §5.8). Het ENIGE tenant-facing
// leespad. Server-side/gecureerd: geeft uitsluitend GEAGGREGEERDE scores/metadata
// terug voor de features die een fonds gebruikt (join fonds_module_manifest), incl.
// de laatst-vrijgegeven status en het assurance_scope-label. NOOIT ruwe output,
// prompt, context, testcase-inhoud of andere-fondsen-data.
//
// "server-only": leest de aqlab_-tabellen (deny-by-default) via de service-role
// (svc). De aqlab-data is PRODUCTBREED (identiek voor elk fonds, bevat geen
// fondsdata); de fonds-scoping komt uit het fonds-eigen manifest. De aanroepende
// route authenticeert de fondsgebruiker (anon+RLS) en levert fondsId + svc.
// -----------------------------------------------------------------------------

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beschikbareModuleKeys, type ModuleKey } from "../module-registry";
import {
  AQLAB_FEATURE_MODULE,
  bepaalGebruikteFeatures,
  bouwAssuranceView,
  type AssuranceMeetwaarden,
  type AssuranceView,
} from "./assurance-core";

interface ReleaseRij {
  id: string;
  run_id: string | null;
  release_status: string;
  besluit_op: string | null;
  aangemaakt_op: string;
  kritieke_bevindingen_count: number;
  audit_export_id: string | null;
}

/** Leest de effectieve modulebeschikbaarheid van een fonds uit het manifest. */
async function beschikbareModulesVanFonds(svc: SupabaseClient, fondsId: string): Promise<Set<ModuleKey>> {
  const { data } = await svc
    .from("fonds_module_manifest").select("module_key, actief").eq("fonds_id", fondsId);
  const overrides: Record<string, boolean> = {};
  for (const r of (data ?? []) as { module_key: string; actief: boolean }[]) overrides[r.module_key] = r.actief;
  return beschikbareModuleKeys(overrides);
}

/** Laatste besluitregel (ongeacht status) voor een feature — bron voor de
 *  STATUS + laatste-controle + kritieke telling in de assurance-view. */
async function laatsteBesluit(svc: SupabaseClient, featureId: string): Promise<ReleaseRij | null> {
  const { data } = await svc
    .from("aqlab_release_decisions")
    .select("id, run_id, release_status, besluit_op, aangemaakt_op, kritieke_bevindingen_count, audit_export_id")
    .eq("feature_id", featureId)
    .order("aangemaakt_op", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ReleaseRij) ?? null;
}

/** Laatst VRIJGEGEVEN besluitregel — de enige bron voor het fonds-downloadbare
 *  auditrapport (niet-vrijgegeven exports zijn nooit fonds-zichtbaar). */
async function laatstVrijgegeven(svc: SupabaseClient, featureId: string): Promise<ReleaseRij | null> {
  const { data } = await svc
    .from("aqlab_release_decisions")
    .select("id, run_id, release_status, besluit_op, aangemaakt_op, kritieke_bevindingen_count, audit_export_id")
    .eq("feature_id", featureId)
    .eq("release_status", "vrijgegeven")
    .order("aangemaakt_op", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ReleaseRij) ?? null;
}

/** Leidt geaggregeerde meetwaarden af uit de run-aggregatie (regressie). Geen
 *  ruwe output — uitsluitend tellingen/ratio's/labels. `besluit` = laatste
 *  (status/scores); `vrijgegeven` = laatst-vrijgegeven (downloadbaar rapport). */
async function meetwaardenVanRun(
  svc: SupabaseClient,
  featureCode: string,
  besluit: ReleaseRij | null,
  vrijgegeven: ReleaseRij | null
): Promise<AssuranceMeetwaarden> {
  const leeg: AssuranceMeetwaarden = {
    feature_code: featureCode,
    release_status: besluit?.release_status ?? null,
    laatste_controle: besluit?.besluit_op ?? besluit?.aangemaakt_op ?? null,
    aantal_functioneel: null,
    aantal_blokkerend: null,
    kritieke_bevindingen: besluit?.kritieke_bevindingen_count ?? 0,
    openstaande_review: 0,
    brongebondenheid_ratio: null,
    format_compliance_ratio: null,
    regressie_status: null,
    // Download + hash UITSLUITEND uit de laatst-vrijgegeven release.
    audit_export_id: vrijgegeven?.audit_export_id ?? null,
    inhoud_hash: null,
  };

  // inhoud_hash uit de vrijgegeven auditexport (voor de read-only download).
  if (vrijgegeven?.audit_export_id) {
    const { data: exp } = await svc
      .from("aqlab_audit_exports").select("inhoud_hash").eq("id", vrijgegeven.audit_export_id).maybeSingle();
    leeg.inhoud_hash = (exp as { inhoud_hash: string } | null)?.inhoud_hash ?? null;
  }
  if (!besluit || !besluit.run_id) return leeg;

  const { data: runData } = await svc
    .from("aqlab_runs").select("aggregatie").eq("id", besluit.run_id).maybeSingle();
  const agg = (runData as { aggregatie: Record<string, unknown> | null } | null)?.aggregatie ?? null;
  const regressie = (agg?.regressie ?? null) as {
    tellingen?: { verbeteringen?: number; regressies?: number; nieuwe_blokkades?: number; openstaande_reviews?: number };
    per_testcase?: { soort?: string }[];
  } | null;
  const consistency = (agg?.consistency ?? null) as Record<string, {
    source_correctness_rate?: number | null; format_pass_rate?: number | null;
  }> | null;

  if (regressie?.per_testcase) {
    leeg.aantal_functioneel = regressie.per_testcase.filter((t) => t.soort === "functioneel").length;
    leeg.aantal_blokkerend = regressie.per_testcase.filter((t) => t.soort === "security_blocking").length;
  }
  if (regressie?.tellingen) {
    const t = regressie.tellingen;
    leeg.openstaande_review = t.openstaande_reviews ?? 0;
    if ((t.regressies ?? 0) > 0 || (t.nieuwe_blokkades ?? 0) > 0) leeg.regressie_status = "regressie";
    else if ((t.verbeteringen ?? 0) > 0) leeg.regressie_status = "verbeterd";
    else leeg.regressie_status = "gelijk";
  }
  if (consistency) {
    const rijen = Object.values(consistency);
    const gem = (vals: (number | null | undefined)[]): number | null => {
      const nums = vals.filter((v): v is number => typeof v === "number");
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    };
    leeg.brongebondenheid_ratio = gem(rijen.map((r) => r.source_correctness_rate));
    leeg.format_compliance_ratio = gem(rijen.map((r) => r.format_pass_rate));
  }
  return leeg;
}

/**
 * Bouwt de read-only assurance-view voor een fonds: alleen de features die het
 * fonds gebruikt (manifest-join), met geaggregeerde scores, laatst-vrijgegeven
 * status, scope-label, disclaimer en de vaste "wat wel/niet"-uitleg.
 */
export async function haalAssuranceVoorFonds(svc: SupabaseClient, fondsId: string): Promise<AssuranceView> {
  const modules = await beschikbareModulesVanFonds(svc, fondsId);
  const featureCodes = bepaalGebruikteFeatures(modules);
  if (featureCodes.length === 0) return bouwAssuranceView([]);

  // feature-code → id.
  const { data: feats } = await svc
    .from("aqlab_ai_features").select("id, code").in("code", featureCodes);
  const idVanCode = new Map<string, string>();
  for (const f of (feats ?? []) as { id: string; code: string }[]) idVanCode.set(f.code, f.id);

  const meetwaarden: AssuranceMeetwaarden[] = [];
  for (const code of featureCodes) {
    const featureId = idVanCode.get(code) ?? null;
    const besluit = featureId ? await laatsteBesluit(svc, featureId) : null;
    const vrijgegeven = featureId ? await laatstVrijgegeven(svc, featureId) : null;
    meetwaarden.push(await meetwaardenVanRun(svc, code, besluit, vrijgegeven));
  }
  return bouwAssuranceView(meetwaarden);
}

/**
 * Autorisatiepoort voor de read-only fonds-download van een auditrapport: mag dit
 * fonds deze export zien? Voorwaarden: (1) de export hoort bij een feature die het
 * fonds gebruikt, én (2) bij een VRIJGEGEVEN besluitregel — niet-vrijgegeven
 * exports (geblokkeerd/getest/review_vereist/los) zijn nooit fonds-zichtbaar.
 * Geeft het opslagpad terug voor de server-gemedieerde stream (nooit een policy).
 */
export async function magFondsAuditExportZien(
  svc: SupabaseClient,
  fondsId: string,
  exportId: string
): Promise<{ ok: boolean; reden: string | null; opslag_ref: string | null }> {
  const { data: exp } = await svc
    .from("aqlab_audit_exports").select("id, feature_id, opslag_ref, run_id").eq("id", exportId).maybeSingle();
  const e = exp as { id: string; feature_id: string | null; opslag_ref: string | null; run_id: string | null } | null;
  if (!e) return { ok: false, reden: "Auditrapport niet gevonden.", opslag_ref: null };
  if (!e.feature_id) return { ok: false, reden: "Auditrapport zonder feature-koppeling.", opslag_ref: null };

  // Feature van de export → code.
  const { data: feat } = await svc
    .from("aqlab_ai_features").select("code").eq("id", e.feature_id).maybeSingle();
  const code = (feat as { code: string } | null)?.code ?? null;
  if (!code || !(code in AQLAB_FEATURE_MODULE)) {
    return { ok: false, reden: "Auditrapport buiten de assurance-scope.", opslag_ref: null };
  }

  // Gebruikt dit fonds die feature?
  const modules = await beschikbareModulesVanFonds(svc, fondsId);
  if (!bepaalGebruikteFeatures(modules).includes(code)) {
    return { ok: false, reden: "Fonds gebruikt deze AI-feature niet.", opslag_ref: null };
  }

  // De export moet gerefereerd zijn vanuit een VRIJGEGEVEN besluitregel; losse of
  // niet-vrijgegeven (geblokkeerd/getest/review_vereist) exports zijn nooit
  // fonds-zichtbaar — alleen "vrijgegeven voor gebruik" rapporten mag het fonds zien.
  const { data: ref } = await svc
    .from("aqlab_release_decisions")
    .select("id")
    .eq("audit_export_id", exportId)
    .eq("release_status", "vrijgegeven")
    .limit(1)
    .maybeSingle();
  if (!ref) return { ok: false, reden: "Auditrapport niet gekoppeld aan een vrijgavebesluit.", opslag_ref: null };

  const pad = e.opslag_ref ?? (e.run_id ? `${e.run_id}/${exportId}.html` : null);
  if (!pad) return { ok: false, reden: "Geen opslag-referentie.", opslag_ref: null };
  return { ok: true, reden: null, opslag_ref: pad };
}
