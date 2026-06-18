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

import { createServerSupabase } from "@/lib/supabase-server";

/** Bekende capabilities. Groeit per increment (C/F voegen toe) zonder RLS-herontwerp. */
export type Capability = "catalog.manage" | "dossiers.manage";

/** Rol → toegekende capabilities. Bron-van-waarheid voor autorisatie in v2.
 *  `dossiers.manage` (TO §5: secretariaat/governance/admin) dekt het handmatig
 *  beheren van dossierstatus/periode; toegekend aan beheerder + voorzitter,
 *  conform de bestaande privileged-rolconventie (voorzitter/beheerder). */
export const ROL_CAPABILITIES: Record<string, Capability[]> = {
  beheerder: ["catalog.manage", "dossiers.manage"],
  voorzitter: ["dossiers.manage"],
  bestuurder: [],
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
