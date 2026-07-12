// lib/aqlab/modellen-hash.ts
// -----------------------------------------------------------------------------
// AQLab — variantbeheer-light (AQL-5). SERVER-DEEL: de dedup-hash + de starter-
// seed. Apart van lib/aqlab/modellen.ts (client-safe), want dit importeert
// node:crypto (via sha256) en de Supabase-client — niet client-bundelbaar.
//
//   • configHash() — DE ENIGE hash-implementatie (single source of truth); de
//     migratie berekent níets. sha256 over (model + temperature + max_tokens +
//     top_p + retrieval).
//   • seedStarterModelConfigs() — idempotente starter-set (dedup-op-hash),
//     append-only gelogd.
// -----------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "./seed/canonical";
import {
  AQLAB_TOEGESTANE_MODELLEN,
  canoniekeVariant,
  type VariantInstellingen,
} from "../../../core/lib/aqlab/modellen";

/**
 * Dedup-sleutel: sha256 over (model + temperature + max_tokens + top_p +
 * retrieval). Twee runs met identieke effectieve instellingen krijgen dezelfde
 * hash → hergebruik dezelfde append-only modelconfig-rij (geen wildgroei).
 */
export function configHash(v: VariantInstellingen): string {
  return sha256(canoniekeVariant(v));
}

/**
 * Seed de starter-set modelconfiguraties (idempotent, dedup-op-hash). Elke
 * allowlist-entry wordt als provider-default-variant (temperature/top_p null =
 * zoals productie) gepind met een stabiele config_hash. Herhaald draaien =
 * geen dubbele rijen (ON CONFLICT (config_hash) DO NOTHING).
 *
 * Append-only auditregel in aqlab_log. Service-client vereist (server-side/CLI).
 */
export async function seedStarterModelConfigs(
  svc: SupabaseClient
): Promise<{ toegevoegd: number; totaal: number; log: string[] }> {
  const log: string[] = [];
  const rijen = AQLAB_TOEGESTANE_MODELLEN.map((m) => {
    const variant: VariantInstellingen = {
      model: m.model_name,
      temperature: null,
      maxTokens: m.defaultMaxTokens,
      topP: null,
      retrieval: {},
    };
    return {
      naam: m.label,
      // AQL-6: de ECHTE provider per allowlist-entry (niet meer hardcoded).
      model_provider: m.provider,
      model_name: m.model_name,
      temperature_requested: null,
      max_tokens_requested: m.defaultMaxTokens,
      top_p_requested: null,
      retrieval_settings: {},
      is_baseline: m.isBaseline,
      config_hash: configHash(variant),
    };
  });

  // Tel vooraf hoeveel er al bestaan (best-effort telling; de daadwerkelijke
  // dedup gebeurt via de unieke config_hash + ignoreDuplicates hieronder).
  const hashes = rijen.map((r) => r.config_hash);
  const { data: bestaand, error: selErr } = await svc
    .from("aqlab_model_configurations")
    .select("config_hash")
    .in("config_hash", hashes);
  if (selErr) throw new Error(`seed modelconfigs voorafgaande telling mislukt: ${selErr.message}`);
  const bestaandSet = new Set((bestaand ?? []).map((r) => r.config_hash as string));
  const nieuw = rijen.filter((r) => !bestaandSet.has(r.config_hash));

  if (nieuw.length > 0) {
    const { error } = await svc
      .from("aqlab_model_configurations")
      .upsert(nieuw, { onConflict: "config_hash", ignoreDuplicates: true });
    if (error) throw new Error(`seed modelconfigs mislukt: ${error.message}`);
    // Append-only auditregel (nooit UPDATE/DELETE).
    const { error: loge } = await svc.from("aqlab_log").insert({
      actie: "modelconfig_seed",
      object_type: "aqlab_model_configurations",
      nieuwe_waarde: { toegevoegd: nieuw.map((r) => r.naam), model_namen: nieuw.map((r) => r.model_name) },
    });
    if (loge) throw new Error(`aqlab_log (modelconfig_seed): ${loge.message}`);
  }

  log.push(`starter-modelconfigs: ${rijen.length} in allowlist, ${nieuw.length} nieuw toegevoegd`);
  return { toegevoegd: nieuw.length, totaal: rijen.length, log };
}
