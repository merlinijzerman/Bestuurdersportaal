// ============================================================================
//  Generieke service-role Supabase-client — SERVER-ONLY, RLS-BYPASS.
// ----------------------------------------------------------------------------
//  Voor server-side schrijfpaden naar tabellen die BEWUST geen anon/auth-policy
//  hebben en niet tenant-gebonden zijn. Eerste gebruiker: /api/contact, dat in
//  `contact_aanvragen` insert (RLS aan, deny-by-default; de browser schrijft
//  nooit direct — zie migratie 2026_06_29_contact_aanvragen.sql, FO REQ-PV-042).
//
//  ⚠️ Net als lib/supabase-platform.ts raakt dit bestand de service-role-key en
//  draait het uitsluitend server-side (`import "server-only"` laat een client-
//  import bij build falen). NOOIT importeren vanuit een client component of een
//  tenant-route (app/(dashboard)/...): de key mag nooit in de clientbundel.
//
//  Verschil met supabase-platform.ts: die client hoort uitsluitend achter de
//  platform-capability+audit-wrapper (withPlatform). Deze client is daar
//  losgekoppeld van — bedoeld voor niet-tenant, niet-platform publieke
//  schrijfpaden zoals het contactformulier. Hou het gebruik beperkt en expliciet.
//
//  Geen sessie/cookies: machine-client, geen auth.uid().
// ============================================================================

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL ontbreekt — service-role-client kan niet starten."
    );
  }
  if (!serviceRoleKey) {
    // Fail-closed: zonder service-role-key kan er niet veilig geschreven worden.
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ontbreekt — vereist voor server-side service-role writes (server-only)."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
