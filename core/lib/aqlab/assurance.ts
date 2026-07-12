// lib/aqlab/assurance.ts
// -----------------------------------------------------------------------------
// AQLab — assurance-service (AQL-4, technisch §5.8). Het ENIGE tenant-facing
// leespad. Geeft uitsluitend GEAGGREGEERDE scores/metadata terug voor de features
// die een fonds gebruikt (join fonds_module_manifest), incl. de laatst-vrijgegeven
// status. NOOIT ruwe output, prompt, context, testcase-inhoud of andere-fondsen-data.
//
// D1b (werkopdracht C1): dit pad draaide op de service-role om de deny-by-default
// aqlab_-tabellen te lezen. Nu loopt het via de SESSIE-client (anon-key + JWT,
// rol authenticated) + SECURITY DEFINER-RPC's:
//   - het fonds-manifest wordt met RLS gelezen (eigen fonds, 2026_07_09_t8);
//   - aqlab_assurance_meetwaarden(codes) cureert de meetwaarden IN SQL (het rauwe
//     aggregatie-blob verlaat de DB niet); TS is een dunne mapper;
//   - aqlab_audit_export_bron(id) autoriseert de download van een vrijgegeven rapport.
// De aqlab-data is productbreed (geen fonds_id); de fonds-scoping komt uit de
// sessie. Geen service-role meer op deze gedeelde surface (Fase B, criterium 2).
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

/** Leest de effectieve modulebeschikbaarheid van een fonds uit het manifest, met
 *  de SESSIE-client (RLS: het eigen fonds is leesbaar — 2026_07_09_t8). */
async function beschikbareModulesVanFonds(
  client: SupabaseClient,
  fondsId: string
): Promise<Set<ModuleKey>> {
  const { data } = await client
    .from("fonds_module_manifest")
    .select("module_key, actief")
    .eq("fonds_id", fondsId);
  const overrides: Record<string, boolean> = {};
  for (const r of (data ?? []) as { module_key: string; actief: boolean }[]) {
    overrides[r.module_key] = r.actief;
  }
  return beschikbareModuleKeys(overrides);
}

/** Rij-vorm van aqlab_assurance_meetwaarden. numeric komt in supabase-js als
 *  string terug — vandaar de tolerante typing + numOfNull. */
type MeetwaardenRij = {
  feature_code: string;
  release_status: string | null;
  laatste_controle: string | null;
  kritieke_bevindingen: number | null;
  aantal_functioneel: number | null;
  aantal_blokkerend: number | null;
  openstaande_review: number | null;
  regressie_status: string | null;
  brongebondenheid_ratio: number | string | null;
  format_compliance_ratio: number | string | null;
  vrijgegeven_audit_export_id: string | null;
  inhoud_hash: string | null;
};

function numOfNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Lege meetwaarden voor een feature-code zonder besluitregel (of zonder
 *  aqlab_ai_features-rij) — spiegelt de oude `leeg`-default. */
function leegMeetwaarden(code: string): AssuranceMeetwaarden {
  return {
    feature_code: code,
    release_status: null,
    laatste_controle: null,
    aantal_functioneel: null,
    aantal_blokkerend: null,
    kritieke_bevindingen: 0,
    openstaande_review: 0,
    brongebondenheid_ratio: null,
    format_compliance_ratio: null,
    regressie_status: null,
    audit_export_id: null,
    inhoud_hash: null,
  };
}

function mapMeetwaarden(code: string, rij: MeetwaardenRij | undefined): AssuranceMeetwaarden {
  if (!rij) return leegMeetwaarden(code);
  return {
    feature_code: code,
    release_status: rij.release_status ?? null,
    laatste_controle: rij.laatste_controle ?? null,
    aantal_functioneel: rij.aantal_functioneel ?? null,
    aantal_blokkerend: rij.aantal_blokkerend ?? null,
    kritieke_bevindingen: rij.kritieke_bevindingen ?? 0,
    openstaande_review: rij.openstaande_review ?? 0,
    brongebondenheid_ratio: numOfNull(rij.brongebondenheid_ratio),
    format_compliance_ratio: numOfNull(rij.format_compliance_ratio),
    regressie_status: rij.regressie_status ?? null,
    audit_export_id: rij.vrijgegeven_audit_export_id ?? null,
    inhoud_hash: rij.inhoud_hash ?? null,
  };
}

/**
 * Bouwt de read-only assurance-view voor een fonds: alleen de features die het
 * fonds gebruikt (manifest-join), met geaggregeerde scores, laatst-vrijgegeven
 * status, scope-label, disclaimer en de vaste "wat wel/niet"-uitleg.
 */
export async function haalAssuranceVoorFonds(
  client: SupabaseClient,
  fondsId: string
): Promise<AssuranceView> {
  const modules = await beschikbareModulesVanFonds(client, fondsId);
  const featureCodes = bepaalGebruikteFeatures(modules);
  if (featureCodes.length === 0) return bouwAssuranceView([]);

  const { data } = await client.rpc("aqlab_assurance_meetwaarden", {
    p_codes: featureCodes,
  });
  const perCode = new Map<string, MeetwaardenRij>();
  for (const r of (data ?? []) as MeetwaardenRij[]) perCode.set(r.feature_code, r);

  const meetwaarden = featureCodes.map((code) => mapMeetwaarden(code, perCode.get(code)));
  return bouwAssuranceView(meetwaarden);
}

/**
 * Autorisatiepoort voor de read-only fonds-download van een auditrapport: mag dit
 * fonds deze export zien? Voorwaarden: (1) de export hoort bij een VRIJGEGEVEN
 * besluitregel (de RPC geeft anders opslag_ref = null → geen pad-lek), én (2) bij
 * een feature die het fonds gebruikt. Geeft het opslagpad terug voor de
 * server-gemedieerde stream (de storage-policy laat de sessie-client dat pad lezen).
 */
export async function magFondsAuditExportZien(
  client: SupabaseClient,
  fondsId: string,
  exportId: string
): Promise<{ ok: boolean; reden: string | null; opslag_ref: string | null }> {
  const { data } = await client.rpc("aqlab_audit_export_bron", { p_export_id: exportId });
  const rij = (Array.isArray(data) ? data[0] : data) as
    | { feature_code: string | null; opslag_ref: string | null; is_vrijgegeven: boolean }
    | undefined;
  if (!rij) return { ok: false, reden: "Auditrapport niet gevonden.", opslag_ref: null };
  if (!rij.is_vrijgegeven || !rij.opslag_ref) {
    return {
      ok: false,
      reden: "Auditrapport niet gekoppeld aan een vrijgavebesluit.",
      opslag_ref: null,
    };
  }
  const code = rij.feature_code;
  if (!code || !(code in AQLAB_FEATURE_MODULE)) {
    return { ok: false, reden: "Auditrapport buiten de assurance-scope.", opslag_ref: null };
  }
  const modules = await beschikbareModulesVanFonds(client, fondsId);
  if (!bepaalGebruikteFeatures(modules).includes(code)) {
    return { ok: false, reden: "Fonds gebruikt deze AI-feature niet.", opslag_ref: null };
  }
  return { ok: true, reden: null, opslag_ref: rij.opslag_ref };
}
