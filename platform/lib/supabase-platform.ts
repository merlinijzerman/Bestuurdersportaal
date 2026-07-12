// ============================================================================
//  Platform Supabase-client — SERVICE-ROLE, RLS-BYPASS (Increment P0).
// ----------------------------------------------------------------------------
//  ⚠️ Dit is het ENIGE bestand dat de service-role-key mag aanraken. Het draait
//  uitsluitend server-side (import "server-only" laat een client-import falen
//  bij build) en mag NOOIT vanuit een tenant-route (app/(dashboard)/...) of
//  client component geïmporteerd worden. Een statische CI-check faalt als de
//  key of dit pad in de clientbundel/tenant-paden voorkomt (TO §12 test 2).
//
//  Deze client bypasst RLS en is daarmee het cross-tenant data-pad (TO §5). Hij
//  mag UITSLUITEND achter de capability+audit-wrapper (lib/platform-wrapper.ts)
//  worden aangeroepen — invariant (a): geen service-role-aanroep buiten
//  withPlatform.
//
//  Geen sessie/cookies: dit is een machine-client (geen auth.uid()). De
//  identiteit van de actor komt uit de platform-auth-sessie (lib/platform-auth.ts),
//  niet uit deze client.
// ============================================================================

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createPlatformSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL ontbreekt — platform-client kan niet starten.");
  }
  if (!serviceRoleKey) {
    // Fail-closed: zonder service-role-key gaat geen enkele platformhandeling door.
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ontbreekt — vereist voor de platform back-office (server-only)."
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
