// ============================================================================
//  Capability-model (besluit 0006 B11) — centrale, server-side autorisatie.
// ----------------------------------------------------------------------------
//  v2 start met een config-mapping in code (rol → capabilities[]), afgedwongen
//  via één server-side helper. Géén rol_capabilities-DB-tabel: pas invoeren als
//  rollen fijnmaziger/beheerbaar moeten worden (latere optimalisatie).
//
//  De UI mág knoppen rolafhankelijk tonen, maar dat is GEEN beveiliging — elke
//  schrijfactie wordt server-side gecontroleerd via requireCapability().
//
//  Tenant-isolatie blijft RLS per fonds_id (anon-key). Deze helper leest de rol
//  via diezelfde RLS-client; nooit de service-role-key.
// ============================================================================

import { createServerSupabase } from "@/core/lib/supabase-server";

/** Bekende capabilities. Groeit per increment (C/F voegen toe) zonder RLS-herontwerp. */
export type Capability =
  | "catalog.manage"
  | "dossiers.manage"
  // Increment C — documentstatus/bronstatus/metadata-beheer (FO §6/§7, TO §5).
  | "documents.metadata.update"
  | "documents.status.change"
  | "documents.bronstatus.change"
  | "metadata.review"
  // Increment E — AI-procesclassificatie beoordelen/terugdraaien (TO §5).
  | "classification.review"
  // Increment D — notulensegmenten voorstellen/bevestigen/corrigeren (FO §8, TO §2.5).
  | "notulen.segment.confirm"
  // Increment C+/B13 — generieke (platform-gecureerde) bibliotheek beheren.
  // GERESERVEERD voor de B14-platformrol (Increment P1); bewust aan GEEN
  // tenant-rol toegekend. Tenants zijn read-only op generiek (RLS + uploadweigering);
  // interim-curatie loopt via service-role. Pas mappen zodra de platform-surface bestaat.
  | "generic.library.manage"
  // Increment F — persoonlijk bestuurdersprofiel (FO §14, besluit 0017). Profielen
  // zijn STRIKT ZELFBEHEERD: alleen de persoon zelf wijzigt het eigen profiel. Er is
  // bewust GEEN profile.manage.all — een beheerder/voorzitter kan andermans profiel
  // niet wijzigen (privacy/dataminimalisatie). RLS borgt dit op id=auth.uid().
  | "profile.manage.own"
  // Organisatieprofiel v0.4 — tenant-zelfservice op het generieke, fonds-brede
  // contextprofiel (organisatie_profielen). In tegenstelling tot het PERSOONLIJKE
  // profiel is dit fonds-breed, dus beheerder-gated (analoog aan catalog.manage),
  // niet strikt zelfbeheerd. RLS borgt eigen-fonds; deze capability de rolgate.
  | "organisation.profile.manage"
  // Increment T8 (besluit 0040 / v0.4 §9) — beheer van de fonds-configuratielaag
  // (theming, module-manifest, feature flags, content-overrides) voor het EIGEN
  // fonds. Fonds-breed, dus beheerder/voorzitter-gated (analoog aan
  // organisation.profile.manage). RLS borgt eigen-fonds én dubbelt deze rolgate
  // op de config-tabellen (WITH CHECK). Platform-brede config = Increment P.
  | "fonds.config.manage"
  // Increment T11 (v0.4 §13 / vaststelling 2026-07-08) — LEESrecht op de fonds-
  // modules stuurinformatie en klantbeeld. Dit is de server-side rol-/capability-
  // gate NAAST (a) de manifest-beschikbaarheidscheck en (b) de fonds-RLS op de
  // data. Beide modules verwerken uitsluitend AGGREGAAT-data (geen deelnemer-PII),
  // dus het leesrecht is breed: elke bestuurdersrol mag meekijken. Een sessie
  // zónder deze capability (onbekende rol / geen profiel) wordt server-side
  // geweigerd — beschikbaarheid ≠ autorisatie.
  | "stuurinformatie.view"
  | "klantbeeld.view";

/** Rol → toegekende capabilities. Bron-van-waarheid voor autorisatie in v2.
 *  `dossiers.manage` (TO §5: secretariaat/governance/admin) dekt het handmatig
 *  beheren van dossierstatus/periode; toegekend aan beheerder + voorzitter,
 *  conform de bestaande privileged-rolconventie (voorzitter/beheerder).
 *
 *  De document-/metadata-capabilities (C) volgen dezelfde conventie: "secretariaat"
 *  is een FUNCTIONELE rol, geen autorisatierol — de privileged autorisatierollen
 *  beheerder + voorzitter dragen ze. De TO §5 fijnmazige split
 *  (`…update.own_before_final` / `…update.all`) is bewust uitgesteld (werkopdracht C). */
export const ROL_CAPABILITIES: Record<string, Capability[]> = {
  beheerder: [
    "catalog.manage",
    "dossiers.manage",
    "documents.metadata.update",
    "documents.status.change",
    "documents.bronstatus.change",
    "metadata.review",
    "classification.review",
    "notulen.segment.confirm",
    "profile.manage.own",
    "organisation.profile.manage",
    "fonds.config.manage",
    "stuurinformatie.view",
    "klantbeeld.view",
  ],
  voorzitter: [
    "dossiers.manage",
    "documents.metadata.update",
    "documents.status.change",
    "documents.bronstatus.change",
    "metadata.review",
    "classification.review",
    "notulen.segment.confirm",
    "profile.manage.own",
    "fonds.config.manage",
    "stuurinformatie.view",
    "klantbeeld.view",
  ],
  // I-2-release: ALLE metadatavelden opengesteld voor bestuurders (huidige
  // inrichting, akkoord compliance) — vergemakkelijkt invoer/test. Omvat de
  // koppelvelden (documents.metadata.update) én documentstatus/bronstatus
  // (RAG-actuele-bron-bepalend). Review-AFRONDING (metadata.review) en
  // classification/notulen-review blijven bewust bij beheerder/voorzitter:
  // dat is een beoordelende governance-handeling, geen metadata-bewerking.
  bestuurder: [
    "documents.metadata.update",
    "documents.status.change",
    "documents.bronstatus.change",
    "profile.manage.own",
    "stuurinformatie.view",
    "klantbeeld.view",
  ],
};

/**
 * Pure mappingcheck — heeft deze rol de capability? Testbaar zonder DB.
 * Onbekende of ontbrekende rol = geen capabilities.
 */
export function rolHeeftCapability(
  rol: string | null | undefined,
  cap: Capability
): boolean {
  if (!rol) return false;
  return (ROL_CAPABILITIES[rol] ?? []).includes(cap);
}

/**
 * Server-side autorisatiecheck voor een ingelogde gebruiker. Leest de rol uit
 * profielen (via RLS-client) en toetst tegen de mapping. Routes geven 403 bij
 * `false`. Bron-van-waarheid voor beheeracties; UI-zichtbaarheid is cosmetisch.
 */
export async function requireCapability(
  userId: string,
  cap: Capability
): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data: profiel } = await supabase
    .from("profielen")
    .select("rol")
    .eq("id", userId)
    .single();
  return rolHeeftCapability(profiel?.rol, cap);
}
