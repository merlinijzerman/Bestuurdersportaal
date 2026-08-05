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
//
//  De PURE mapping (Capability, ROL_CAPABILITIES, rolHeeftCapability) is verhuisd
//  naar core/lib/capabilities-map.ts zodat client-code die kan importeren zonder
//  het server-only createServerSupabase-pad mee te bundelen. Hier wordt ze
//  her-geëxporteerd, zodat elke bestaande server-import ongewijzigd blijft werken.
// ============================================================================

import { createServerSupabase } from "@/core/lib/supabase-server";
import { rolHeeftCapability, type Capability } from "@/core/lib/capabilities-map";

export {
  ROL_CAPABILITIES,
  rolHeeftCapability,
  type Capability,
} from "@/core/lib/capabilities-map";

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
