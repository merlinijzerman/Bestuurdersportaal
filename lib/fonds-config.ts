// ============================================================================
//  Fonds-config — SERVER-side leeslaag + schrijf-/audithelpers (T8, besluit 0040).
// ----------------------------------------------------------------------------
//  Eén plek die per request — op basis van het (server-side afgeleide) fonds_id —
//  theming, module-manifest, feature flags en content-overrides oplevert. Alle
//  consumenten (layout/theming, navigatie/module-routing, RAG-flag hybride_zoeken,
//  server-guard) lezen hieruit. Reads/writes lopen via de RLS-client (anon-key);
//  de RLS-policies (T8-migratie) borgen tenant-isolatie ÉN de schrijf-rolgate.
//
//  BESCHIKBAARHEID ≠ AUTORISATIE: moduleBeschikbaar() bepaalt of een module voor
//  een fonds is aangezet — het VERVANGT nooit requireCapability()/RLS. De
//  server-guard hieronder komt BOVENOP de bestaande capability-/RLS-gate.
// ============================================================================

import { createServerSupabase } from "@/lib/supabase-server";
import {
  MODULE_REGISTRY,
  beschikbareModuleKeys,
  isModuleKey,
  type ModuleKey,
} from "@/lib/module-registry";
import {
  valideerThemingTokens,
  bouwThemingCss,
  brandingUitTokens,
  flagAlsBoolean,
  type ThemaTokenKey,
  type JsonWaarde,
} from "@/lib/fonds-config-core";

type Actor = { id: string; naam: string | null };
type ConfigType = "theming" | "manifest" | "flag" | "override";

export type FondsConfig = {
  fondsId: string;
  themingTokens: Partial<Record<ThemaTokenKey, string>>;
  themingCss: string;
  branding: { logoLetter?: string; logoUrl?: string };
  manifest: Map<string, boolean>;
  beschikbareModules: Set<ModuleKey>;
  flags: Map<string, JsonWaarde>;
  overrides: Map<string, string>;
};

// ── Lezen ───────────────────────────────────────────────────────────────────

/**
 * Haalt de volledige config voor een fonds op (theming/manifest/flags/overrides).
 * `fonds_id` moet server-side zijn afgeleid (profiel/resolver). RLS filtert
 * bovendien op het eigen fonds. Fail-safe: ontbrekende rijen → code-defaults.
 */
export async function haalFondsConfig(fondsId: string): Promise<FondsConfig> {
  const supabase = await createServerSupabase();

  const [themingRes, manifestRes, flagsRes, overridesRes] = await Promise.all([
    supabase.from("fonds_theming").select("tokens").eq("fonds_id", fondsId).maybeSingle(),
    supabase.from("fonds_module_manifest").select("module_key, actief").eq("fonds_id", fondsId),
    supabase.from("fonds_feature_flags").select("flag_key, waarde").eq("fonds_id", fondsId),
    supabase.from("fonds_content_overrides").select("sleutel, waarde").eq("fonds_id", fondsId),
  ]);

  const { tokens } = valideerThemingTokens(themingRes.data?.tokens ?? {});

  const manifest = new Map<string, boolean>();
  for (const r of manifestRes.data ?? []) {
    if (isModuleKey(r.module_key)) manifest.set(r.module_key, r.actief);
  }

  const flags = new Map<string, JsonWaarde>();
  for (const r of flagsRes.data ?? []) flags.set(r.flag_key, r.waarde as JsonWaarde);

  const overrides = new Map<string, string>();
  for (const r of overridesRes.data ?? []) overrides.set(r.sleutel, r.waarde);

  return {
    fondsId,
    themingTokens: tokens,
    themingCss: bouwThemingCss(tokens),
    branding: brandingUitTokens(tokens),
    manifest,
    beschikbareModules: beschikbareModuleKeys(manifest),
    flags,
    overrides,
  };
}

/** Alleen de veilige CSS-override (voor injectie in de layout). */
export async function haalThemingCss(fondsId: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("fonds_theming").select("tokens").eq("fonds_id", fondsId).maybeSingle();
  const { tokens } = valideerThemingTokens(data?.tokens ?? {});
  return bouwThemingCss(tokens);
}

/** De set beschikbare modules voor een fonds (registry.defaultActief ⊕ manifest). */
export async function beschikbareModulesVoorFonds(fondsId: string): Promise<Set<ModuleKey>> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("fonds_module_manifest").select("module_key, actief").eq("fonds_id", fondsId);
  const overrides = new Map<string, boolean>();
  for (const r of data ?? []) {
    if (isModuleKey(r.module_key)) overrides.set(r.module_key, r.actief);
  }
  return beschikbareModuleKeys(overrides);
}

/**
 * Server-side BESCHIKBAARHEIDSCHECK voor een module. Bedoeld als aanvullende gate
 * op hoog-risico module-entrypoints — NAAST (nooit in plaats van)
 * requireCapability() + RLS. Onbekende key → false (deterministisch niet beschikbaar).
 */
export async function moduleBeschikbaar(fondsId: string, key: string): Promise<boolean> {
  if (!isModuleKey(key)) return false;
  const beschikbaar = await beschikbareModulesVoorFonds(fondsId);
  return beschikbaar.has(key);
}

/** Ruwe flagwaarde (jsonb) voor een fonds, of undefined als de flag niet bestaat. */
export async function haalFlag(fondsId: string, flagKey: string): Promise<JsonWaarde | undefined> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("fonds_feature_flags").select("waarde").eq("fonds_id", fondsId)
    .eq("flag_key", flagKey).maybeSingle();
  return data ? (data.waarde as JsonWaarde) : undefined;
}

/**
 * hybride_zoeken-flag voor een fonds. Vervangt de directe fonds_instellingen-
 * lezing (geen gedragsregressie): flag → env-default HYBRID_SEARCH. Zolang de
 * backfill de flag heeft gezet, is dit 1-op-1 het oude gedrag.
 */
export async function hybrideZoekenAan(fondsId: string): Promise<boolean> {
  const flag = await haalFlag(fondsId, "hybride_zoeken");
  if (flag === undefined) return process.env.HYBRID_SEARCH === "on";
  return flagAlsBoolean(flag);
}

// ── Schrijven + append-only audit (versiebeheer) ─────────────────────────────
//  Patroon per write: (1) lees huidige versie; (2) upsert nieuwe waarde met
//  versie+1. Het AUDITSPOOR wordt NIET meer vanuit de app geschreven: een
//  AFTER-trigger op de vier config-tabellen (migratie 2026_07_09_t8b_config_
//  audit_trigger.sql, fn_fonds_config_capture) legt oud→nieuw + versie ATOMISCH
//  in dezelfde transactie vast. Zo kan de logregel niet losraken van de wijziging
//  (geen stil audit-gat) en dwingt de UNIQUE(fonds_id,config_type,sleutel,versie)
//  serialisatie af bij gelijktijdige schrijvers. `bijgewerkt_door` = actor.id
//  (server-side afgeleide user-id); de trigger leest de naam bij uit profielen.
//  De RLS-rolgate op de config-tabellen weigert een niet-privileged schrijver ook
//  op DB-niveau. fonds_id komt van de caller (server-side afgeleid), nooit uit de body.

/** Schrijf/overschrijf een feature flag (waarde jsonb); de trigger audit-logt. */
export async function schrijfFlag(
  fondsId: string, flagKey: string, waarde: JsonWaarde, actor: Actor
): Promise<{ versie: number }> {
  const supabase = await createServerSupabase();
  const { data: huidig } = await supabase
    .from("fonds_feature_flags").select("waarde, versie").eq("fonds_id", fondsId)
    .eq("flag_key", flagKey).maybeSingle();
  const versie = (huidig?.versie ?? 0) + 1;
  const { error } = await supabase.from("fonds_feature_flags").upsert(
    { fonds_id: fondsId, flag_key: flagKey, waarde, versie, bijgewerkt: new Date().toISOString(),
      bijgewerkt_door: actor.id },
    { onConflict: "fonds_id,flag_key" }
  );
  if (error) throw new Error(error.message);
  return { versie };
}

/** Zet een module in het manifest aan/uit; de trigger audit-logt. */
export async function schrijfManifestModule(
  fondsId: string, moduleKey: ModuleKey, actief: boolean, actor: Actor
): Promise<{ versie: number }> {
  if (!MODULE_REGISTRY[moduleKey]?.manifestBeheerbaar) {
    throw new Error(`module '${moduleKey}' is niet via het manifest beheerbaar`);
  }
  const supabase = await createServerSupabase();
  const { data: huidig } = await supabase
    .from("fonds_module_manifest").select("actief, versie").eq("fonds_id", fondsId)
    .eq("module_key", moduleKey).maybeSingle();
  const versie = (huidig?.versie ?? 0) + 1;
  const { error } = await supabase.from("fonds_module_manifest").upsert(
    { fonds_id: fondsId, module_key: moduleKey, actief, versie,
      bijgewerkt: new Date().toISOString(), bijgewerkt_door: actor.id },
    { onConflict: "fonds_id,module_key" }
  );
  if (error) throw new Error(error.message);
  return { versie };
}

/** Vervang de theming-tokens (na validatie); de trigger audit-logt. Ongeldige/
 *  onbekende tokens worden geweigerd (niet stil weggefilterd) zodat de beheerder
 *  feedback krijgt. */
export async function schrijfTheming(
  fondsId: string, ruweTokens: unknown, actor: Actor
): Promise<{ versie: number; genegeerd: string[] }> {
  const { tokens, genegeerd } = valideerThemingTokens(ruweTokens);
  const supabase = await createServerSupabase();
  const { data: huidig } = await supabase
    .from("fonds_theming").select("tokens, versie").eq("fonds_id", fondsId).maybeSingle();
  const versie = (huidig?.versie ?? 0) + 1;
  const { error } = await supabase.from("fonds_theming").upsert(
    { fonds_id: fondsId, tokens, versie, bijgewerkt: new Date().toISOString(),
      bijgewerkt_door: actor.id },
    { onConflict: "fonds_id" }
  );
  if (error) throw new Error(error.message);
  return { versie, genegeerd };
}

/** Schrijf/overschrijf een content-override; de trigger audit-logt. */
export async function schrijfOverride(
  fondsId: string, sleutel: string, waarde: string, actor: Actor
): Promise<{ versie: number }> {
  const supabase = await createServerSupabase();
  const { data: huidig } = await supabase
    .from("fonds_content_overrides").select("waarde, versie").eq("fonds_id", fondsId)
    .eq("sleutel", sleutel).maybeSingle();
  const versie = (huidig?.versie ?? 0) + 1;
  const { error } = await supabase.from("fonds_content_overrides").upsert(
    { fonds_id: fondsId, sleutel, waarde, versie, bijgewerkt: new Date().toISOString(),
      bijgewerkt_door: actor.id },
    { onConflict: "fonds_id,sleutel" }
  );
  if (error) throw new Error(error.message);
  return { versie };
}

// ── Historie + terugdraaien ──────────────────────────────────────────────────

export type ConfigLogRegel = {
  id: string;
  config_type: ConfigType;
  config_sleutel: string;
  oude_waarde: JsonWaarde | null;
  nieuwe_waarde: JsonWaarde | null;
  versie: number;
  gebruiker_naam: string | null;
  aangemaakt: string;
};

/** Leesbare wijzigingshistorie voor het eigen fonds (append-only auditspoor). */
export async function haalConfigHistorie(
  fondsId: string, limiet = 100
): Promise<ConfigLogRegel[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("fonds_config_log")
    .select("id, config_type, config_sleutel, oude_waarde, nieuwe_waarde, versie, gebruiker_naam, aangemaakt")
    .eq("fonds_id", fondsId)
    .order("aangemaakt", { ascending: false })
    .limit(limiet);
  return (data ?? []) as ConfigLogRegel[];
}

/**
 * Herstelt een eerdere waarde uit een auditregel. Het herstel loopt via het
 * normale schrijfpad, dus het levert zelf een nieuwe versie + nieuwe auditregel
 * op (oud=huidig, nieuw=herstelde waarde) — volledig traceerbaar, append-only
 * blijft intact. De log-id moet binnen het eigen fonds vallen (RLS + expliciete
 * check).
 */
export async function herstelConfig(
  fondsId: string, logId: string, actor: Actor
): Promise<{ versie: number }> {
  const supabase = await createServerSupabase();
  const { data: regel } = await supabase
    .from("fonds_config_log")
    .select("fonds_id, config_type, config_sleutel, nieuwe_waarde")
    .eq("id", logId).maybeSingle();
  if (!regel || regel.fonds_id !== fondsId) {
    throw new Error("auditregel niet gevonden binnen dit fonds");
  }
  // We herstellen de waarde die deze regel HAD gezet (nieuwe_waarde), als nieuwe versie.
  const waarde = regel.nieuwe_waarde as JsonWaarde;
  switch (regel.config_type as ConfigType) {
    case "flag":
      return schrijfFlag(fondsId, regel.config_sleutel, waarde, actor);
    case "manifest":
      return schrijfManifestModule(fondsId, regel.config_sleutel as ModuleKey,
        flagAlsBoolean(waarde), actor);
    case "theming":
      return schrijfTheming(fondsId, waarde, actor);
    case "override":
      return schrijfOverride(fondsId, regel.config_sleutel, String(waarde), actor);
    default:
      throw new Error(`onbekend config_type: ${regel.config_type}`);
  }
}
