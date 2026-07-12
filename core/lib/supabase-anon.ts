// ============================================================================
//  Anon Supabase-client — cookieloos, RLS AAN (D1, werkopdracht C1).
// ----------------------------------------------------------------------------
//  Voor server-side aanroepen van de publieke SECURITY DEFINER-RPC's die de
//  gedeelde (app/publiek) surface van de service-role verlossen (Fase B crit. 2):
//   - resolve_tenant_host        (host→fonds, core/lib/tenant-domains.ts)
//   - contact_aanvraag_insert    (publieke contactinzending, /api/contact)
//   - contact_notificatie_status (post-mail-status, /api/contact)
//
//  Draait als de `anon`-rol: RLS blijft aan, tenant_domains/contact_aanvragen
//  blijven deny-by-default. GEEN sessie/cookies (machine-client) en NADRUKKELIJK
//  GEEN service-role — dit ís het pad dat de service-role uit het gedeelde
//  project haalt. De anon-key is publiek (NEXT_PUBLIC_*); deze helper bundelt
//  alleen de server-side aanroep zonder sessiestatus.
// ============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createAnonSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL/ANON_KEY ontbreekt — anon-client kan niet starten."
    );
  }
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
