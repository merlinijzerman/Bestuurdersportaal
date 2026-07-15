// ============================================================================
//  lib/web-whitelist-data.ts — DB-toegang tot de bronnen-whitelist (0072).
// ----------------------------------------------------------------------------
//  De ENIGE plek met DB-toegang tot public.bron_whitelist voor het RETRIEVALPAD
//  (de chat-route, tenant anon+RLS). De RLS-policy geeft geauthenticeerde
//  gebruikers uitsluitend ACTIEVE entries; dit leespad kan de whitelist dus niet
//  muteren en ziet nooit inactieve/in_review-entries. Curatie loopt apart via de
//  platform-surface (service-role achter withPlatform).
//
//  De pure matching/weging/validatie leeft in lib/web-whitelist.ts; dit bestand
//  doet alleen I/O en levert genormaliseerde WhitelistEntry-objecten.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { isGeldigNormgewicht, type Normgewicht } from "./bronsoort";
import type {
  WhitelistEntry,
  WhitelistMatchtype,
  WhitelistStatus,
} from "./web-whitelist";

function alsMatchtype(v: unknown): WhitelistMatchtype {
  return v === "domein_subdomeinen" || v === "padprefix" ? v : "domein";
}
function alsStatus(v: unknown): WhitelistStatus {
  return v === "inactief" || v === "in_review" ? v : "actief";
}
function alsNormgewicht(v: unknown): Normgewicht {
  return isGeldigNormgewicht(v) ? v : "onbekend";
}

/**
 * Haal de ACTIEVE whitelist-entries onder RLS (tenant-leespad). Bij een fout of
 * lege lijst → lege array (fail-safe: geen entries ⇒ geen web-retrieval, nooit
 * een crash op het chat-pad). Filtert defensief nogmaals op status='actief'.
 */
export async function haalActieveWhitelist(
  supabase: SupabaseClient
): Promise<WhitelistEntry[]> {
  const { data, error } = await supabase
    .from("bron_whitelist")
    .select("id, domein, matchtype, pad, normgewicht, categorie, tier, status, toelichting, review_datum")
    .eq("status", "actief");

  if (error || !Array.isArray(data)) return [];

  return data
    .map((r): WhitelistEntry => ({
      id: String(r.id),
      domein: String(r.domein ?? ""),
      matchtype: alsMatchtype(r.matchtype),
      pad: r.pad ?? null,
      normgewicht: alsNormgewicht(r.normgewicht),
      categorie: r.categorie ?? null,
      tier: r.tier ?? null,
      status: alsStatus(r.status),
      toelichting: String(r.toelichting ?? ""),
      review_datum: r.review_datum ?? null,
    }))
    .filter((e) => e.status === "actief" && e.domein !== "");
}
