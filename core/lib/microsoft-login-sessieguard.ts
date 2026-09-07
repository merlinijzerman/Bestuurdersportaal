// ============================================================================
//  core/lib/microsoft-login-sessieguard.ts — guard L3 (server-only), fase 1B #335 T2.
// ----------------------------------------------------------------------------
//  Secundaire afdwinging naast de Auth-hook (L1, T1): een `oauth`-portaalsessie
//  zonder `active` binding wordt in elk chokepoint direct beëindigd. Zonder cache.
//  Wachtwoordsessies (amr zonder oauth) passeren ZONDER gateway-aanroep, zodat
//  het wachtwoordpad byte-identiek blijft (ontwerp §6.11/§6.13).
//
//  Chokepoints: withFondsRoute (401 in dezelfde vorm als "geen sessie"),
//  haalFondsSessie, tenant-layout, login-layout, platform-layout (R-34) en L4 in
//  /auth/callback. De gateway is de bron; het token wordt alleen gedecodeerd om
//  te beslissen óf de gateway wordt geraadpleegd. Gatewayfout = fail-closed.
// ============================================================================
import "server-only";
import type { createServerSupabase } from "@/core/lib/supabase-server";
import { beoordeelBindingGuard, sessieIsOAuth, type GuardOordeel } from "@/core/lib/microsoft-login-sessieguard-core";

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

/** Het access-token van de huidige sessie (uit de cookie), of null. */
export async function huidigAccessToken(supabase: Supabase): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Beoordeelt de sessie van `gebruikerId`. Alleen bij `amr ∋ oauth` wordt de
 * gateway (levende_binding) geraadpleegd; elke gatewayfout is fail-closed.
 */
export async function beoordeelOAuthSessie(supabase: Supabase, gebruikerId: string): Promise<GuardOordeel> {
  const token = await huidigAccessToken(supabase);
  const isOAuth = sessieIsOAuth(token);
  if (!isOAuth) return beoordeelBindingGuard({ isOAuth: false, binding: null });
  try {
    const { levendeBinding } = await import("@/core/lib/microsoft-login-gateway");
    const binding = await levendeBinding(gebruikerId);
    return beoordeelBindingGuard({ isOAuth: true, binding: binding ? { status: binding.status } : null });
  } catch {
    return beoordeelBindingGuard({ isOAuth: true, binding: null, gatewayFout: true });
  }
}

/** Beëindigt de sessie lokaal (best-effort; in een Server Component kan de cookie
 *  niet worden weggeschreven — de redirect naar /login met `fout` laat de client
 *  de sessie alsnog opruimen, en de hook weigert de eerstvolgende refresh). */
export async function beeindigSessie(supabase: Supabase): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* best-effort */
  }
}

/** Heeft de gebruiker een `azure`-identiteit in Supabase (L4-signaal)? */
export function heeftAzureIdentiteit(user: { identities?: Array<{ provider: string }> | null } | null | undefined): boolean {
  return (user?.identities ?? []).some((i) => i.provider === "azure");
}

/** Doel na een beëindigde oauth-sessie op de tenant-surface. */
export const LOGIN_NA_BEEINDIGING = "/login?fout=microsoft";
