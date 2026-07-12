// lib/aqlab/release.ts
// -----------------------------------------------------------------------------
// AQLab — release-service DB-orchestratie (AQL-4, technisch §5.6b). Legt het
// vrijgavebesluit vast als APPEND-ONLY regel in aqlab_release_decisions (nooit
// een UPDATE op de run of op een eerder besluit — statuswijziging = nieuwe regel).
//
// De PURE statusmachine + guards leven in lib/aqlab/release-core.ts (los getest
// in lib/aqlab-release.sanity.ts). Dit bestand is "server-only": het raakt de
// service-role client (via de meegegeven svc) en mag nooit client-importeerbaar
// zijn. De aqlab_-tabellen zijn deny-by-default; schrijven loopt via de service-
// role ACHTER de withPlatform-capability+audit-wrapper (aanroeper, CAP_GOVERN).
// -----------------------------------------------------------------------------

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isToegestaneOvergang,
  mapAdviesNaarDb,
  valideerVrijgaveBesluit,
  type Besluit,
  type DbReleaseAdvies,
  type Releasestatus,
  type RunType,
} from "./release-core";

export * from "./release-core";

/** Statussen die als EERSTE besluitregel voor een run zijn toegestaan (er is dan
 *  nog geen voorganger om vanuit te transitioneren). 'aangepast'/'gearchiveerd'
 *  vereisen een voorganger en kunnen dus nooit een openingsregel zijn. */
const INITIELE_STATUSSEN: readonly Releasestatus[] = [
  "concept", "getest", "review_vereist", "vrijgegeven", "geblokkeerd",
];

export interface LegVrijgaveInput {
  run_id: string;
  gewenste_status: Releasestatus;
  /** Formeel besluit (bij vrijgeven/blokkeren), of null bij een tussenstatus. */
  besluit: Besluit | null;
  /** auth.users.id van de Governance Owner (CAP_GOVERN); vereist bij een formeel besluit. */
  besluit_door: string | null;
  /** auth.users.id van de acteur (altijd gelogd, óók bij een tussenstatus zonder besluit). */
  acteur_id?: string | null;
  motivatie: string | null;
  /** Optioneel: koppel het bevroren auditrapport (audit-export-service). */
  audit_export_id?: string | null;
}

export interface LegVrijgaveResultaat {
  ok: boolean;
  redenen: string[];
  release_decision_id: string | null;
  release_status: Releasestatus | null;
  release_advies: DbReleaseAdvies | null;
  kritieke_bevindingen_count: number;
}

interface RunCtx {
  id: string;
  run_type: RunType;
  test_set_id: string | null;
  prompt_version_id: string | null;
  model_configuration_id: string | null;
  aggregatie: Record<string, unknown> | null;
}

/** Telt de open kritieke bevindingen van een run: findings met ernst='kritiek'
 *  en status='open' die aan een output van deze run hangen. */
export async function telKritiekeBevindingen(svc: SupabaseClient, runId: string): Promise<number> {
  const { data: outs } = await svc.from("aqlab_run_outputs").select("id").eq("run_id", runId);
  const outputIds = ((outs ?? []) as { id: string }[]).map((o) => o.id);
  if (outputIds.length === 0) return 0;
  const { count } = await svc
    .from("aqlab_findings")
    .select("id", { count: "exact", head: true })
    .in("run_output_id", outputIds)
    .eq("ernst", "kritiek")
    .eq("status", "open");
  return count ?? 0;
}

/** Meest recente besluitregel voor een feature met release_status='vrijgegeven'
 *  (de bron voor de assurance-view). Null als er geen vrijgave is. */
export async function haalLaatstVrijgegeven(
  svc: SupabaseClient,
  featureId: string
): Promise<{
  id: string;
  run_id: string | null;
  besluit_op: string | null;
  assurance_scope: string;
  audit_export_id: string | null;
  aangemaakt_op: string;
} | null> {
  const { data } = await svc
    .from("aqlab_release_decisions")
    .select("id, run_id, besluit_op, assurance_scope, audit_export_id, aangemaakt_op")
    .eq("feature_id", featureId)
    .eq("release_status", "vrijgegeven")
    .order("aangemaakt_op", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as never) ?? null;
}

/** Meest recente besluitregel (ongeacht status) voor een run — voor de
 *  statusmachine-overgangscontrole en de platform-console. */
async function haalLaatsteBesluitVoorRun(
  svc: SupabaseClient,
  runId: string
): Promise<{ release_status: Releasestatus } | null> {
  const { data } = await svc
    .from("aqlab_release_decisions")
    .select("release_status")
    .eq("run_id", runId)
    .order("aangemaakt_op", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as never) ?? null;
}

export interface ReleaseConsoleContext {
  run_type: RunType;
  run_advies: DbReleaseAdvies | null;
  laatste_status: Releasestatus | null;
  laatste_besluit: Besluit | null;
  laatste_besluit_op: string | null;
  laatste_audit_export_id: string | null;
  kritieke_bevindingen_count: number;
}

/** Leest de release-context van een run voor de platform-console (scherm 8):
 *  het run-advies, de laatste besluitregel en de open kritieke telling. */
export async function haalReleaseConsole(
  svc: SupabaseClient,
  runId: string
): Promise<ReleaseConsoleContext | null> {
  const { data: runData } = await svc
    .from("aqlab_runs").select("run_type, aggregatie").eq("id", runId).maybeSingle();
  const run = runData as { run_type: RunType; aggregatie: Record<string, unknown> | null } | null;
  if (!run) return null;

  const regressie = (run.aggregatie?.regressie ?? null) as { release_advies?: string | null } | null;
  const { advies } = mapAdviesNaarDb((regressie?.release_advies ?? null) as never);

  const { data: laatste } = await svc
    .from("aqlab_release_decisions")
    .select("release_status, besluit, besluit_op, audit_export_id")
    .eq("run_id", runId)
    .order("aangemaakt_op", { ascending: false })
    .limit(1)
    .maybeSingle();
  const l = laatste as {
    release_status: Releasestatus; besluit: Besluit | null; besluit_op: string | null; audit_export_id: string | null;
  } | null;

  return {
    run_type: run.run_type,
    run_advies: advies,
    laatste_status: l?.release_status ?? null,
    laatste_besluit: l?.besluit ?? null,
    laatste_besluit_op: l?.besluit_op ?? null,
    laatste_audit_export_id: l?.audit_export_id ?? null,
    kritieke_bevindingen_count: await telKritiekeBevindingen(svc, runId),
  };
}

/**
 * Legt een vrijgavebesluit vast als append-only regel. Retourneert een
 * gestructureerde weigering (ok=false + redenen) als de guard de combinatie
 * afwijst; dan wordt niets geschreven. `nu` = ISO-tijdstip (aanroeper levert het
 * i.v.m. reproduceerbaarheid).
 */
interface VoorbereideVrijgave {
  ok: true;
  run: RunCtx;
  featureId: string | null;
  dbAdvies: DbReleaseAdvies | null;
  kritiek: number;
  vorigeStatus: Releasestatus | null;
  motivatie_verplicht: boolean;
}
type VoorbereidingUitkomst = VoorbereideVrijgave | { ok: false; redenen: string[] };

/** Laadt de run-context, telt kritieke bevindingen, controleert de statusmachine
 *  en draait de pure guard — ZONDER te schrijven. Gedeeld door de voorafgaande
 *  validatie (valideerVrijgaveMogelijk) en de vastlegging, zodat een geweigerd
 *  besluit nooit een neveneffect (bv. een bevroren auditexport) achterlaat. */
async function bereidVrijgaveVoor(svc: SupabaseClient, input: LegVrijgaveInput): Promise<VoorbereidingUitkomst> {
  const { data: runData } = await svc
    .from("aqlab_runs")
    .select("id, run_type, test_set_id, prompt_version_id, model_configuration_id, aggregatie")
    .eq("id", input.run_id)
    .maybeSingle();
  const run = runData as RunCtx | null;
  if (!run) return { ok: false, redenen: ["Run niet gevonden."] };

  let featureId: string | null = null;
  if (run.test_set_id) {
    const { data: ts } = await svc
      .from("aqlab_test_sets").select("feature_id").eq("id", run.test_set_id).maybeSingle();
    featureId = (ts as { feature_id: string | null } | null)?.feature_id ?? null;
  }

  const regressie = (run.aggregatie?.regressie ?? null) as { release_advies?: string | null } | null;
  const runAdviesRaw = (regressie?.release_advies ?? null) as
    | "accepteren" | "aanpassen" | "blokkeren" | "review_required" | null;
  const { advies: dbAdvies } = mapAdviesNaarDb(runAdviesRaw);

  const kritiek = await telKritiekeBevindingen(svc, run.id);

  const vorige = await haalLaatsteBesluitVoorRun(svc, input.run_id);
  if (vorige) {
    if (!isToegestaneOvergang(vorige.release_status, input.gewenste_status)) {
      return { ok: false, redenen: [`Statusovergang '${vorige.release_status}' → '${input.gewenste_status}' is niet toegestaan.`] };
    }
  } else if (!INITIELE_STATUSSEN.includes(input.gewenste_status)) {
    return { ok: false, redenen: [`'${input.gewenste_status}' kan geen openingsstatus zijn (vereist een voorgaand besluit).`] };
  }

  const oordeel = valideerVrijgaveBesluit({
    run_type: run.run_type,
    gewenste_status: input.gewenste_status,
    besluit: input.besluit,
    run_advies: dbAdvies,
    kritieke_bevindingen_count: kritiek,
    motivatie: input.motivatie,
    heeft_besluitnemer: !!input.besluit_door,
  });
  if (!oordeel.toegestaan) return { ok: false, redenen: oordeel.redenen };

  return {
    ok: true, run, featureId, dbAdvies, kritiek,
    vorigeStatus: vorige?.release_status ?? null,
    motivatie_verplicht: oordeel.motivatie_verplicht,
  };
}

/** Valideert een vrijgavebesluit ZONDER iets te schrijven — voor een pre-check in
 *  de actie (bv. het auditrapport pas bevriezen na groen licht). */
export async function valideerVrijgaveMogelijk(
  svc: SupabaseClient,
  input: LegVrijgaveInput
): Promise<{ ok: boolean; redenen: string[] }> {
  const v = await bereidVrijgaveVoor(svc, input);
  return v.ok ? { ok: true, redenen: [] } : { ok: false, redenen: v.redenen };
}

export async function legVrijgavebesluitVast(
  svc: SupabaseClient,
  input: LegVrijgaveInput,
  nu: string
): Promise<LegVrijgaveResultaat> {
  const weiger = (redenen: string[]): LegVrijgaveResultaat => ({
    ok: false, redenen, release_decision_id: null,
    release_status: null, release_advies: null, kritieke_bevindingen_count: 0,
  });

  const v = await bereidVrijgaveVoor(svc, input);
  if (!v.ok) return weiger(v.redenen);
  const { run, featureId, dbAdvies, kritiek } = v;

  // Append-only INSERT (statuswijziging = nieuwe regel).
  const isBesluit = input.besluit != null;
  const acteur = input.acteur_id ?? input.besluit_door ?? null;
  const { data: ins, error } = await svc
    .from("aqlab_release_decisions")
    .insert({
      run_id: run.id,
      feature_id: featureId,
      prompt_version_id: run.prompt_version_id,
      model_configuration_id: run.model_configuration_id,
      release_status: input.gewenste_status,
      release_advies: dbAdvies,
      besluit: input.besluit,
      besluit_door: isBesluit ? input.besluit_door : null,
      besluit_op: isBesluit ? nu : null,
      motivatie: input.motivatie?.trim() || null,
      kritieke_bevindingen_count: kritiek,
      assurance_scope: "productbreed",
      audit_export_id: input.audit_export_id ?? null,
    })
    .select("id")
    .single();

  if (error || !ins) {
    return weiger([`Vastleggen mislukt: ${error?.message ?? "onbekende fout"}.`]);
  }
  const releaseDecisionId = (ins as { id: string }).id;

  // Append-only auditspoor ná de mutatie (CLAUDE.md). Acteur wordt ALTIJD gelogd
  // (ook bij een tussenstatus zonder formeel besluit); oude_waarde = vorige status.
  const { error: logError } = await svc.from("aqlab_log").insert({
    gebruiker_id: acteur,
    actie: "release_besluit_vastgelegd",
    object_type: "aqlab_release_decisions",
    object_id: releaseDecisionId,
    oude_waarde: v.vorigeStatus ? { release_status: v.vorigeStatus } : null,
    nieuwe_waarde: {
      run_id: run.id,
      release_status: input.gewenste_status,
      release_advies: dbAdvies,
      besluit: input.besluit,
      kritieke_bevindingen_count: kritiek,
      afwijking_motivatie: v.motivatie_verplicht,
    },
  });
  if (logError) {
    // De besluitregel is (append-only) vastgelegd; het domein-logspoor faalde.
    // Niet stil doorgaan: markeer het hiaat in de retourwaarde (de platform-
    // wrapper logt de handeling sowieso apart in platform_event_log).
    return {
      ok: true,
      redenen: [`LET OP: aqlab_log-hiaat (${logError.message}); besluit wél vastgelegd, platform-auditspoor blijft leidend.`],
      release_decision_id: releaseDecisionId,
      release_status: input.gewenste_status,
      release_advies: dbAdvies,
      kritieke_bevindingen_count: kritiek,
    };
  }

  return {
    ok: true,
    redenen: [],
    release_decision_id: releaseDecisionId,
    release_status: input.gewenste_status,
    release_advies: dbAdvies,
    kritieke_bevindingen_count: kritiek,
  };
}
