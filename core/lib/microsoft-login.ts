// ============================================================================
//  core/lib/microsoft-login.ts — server-only bedrading van de login-/koppelflow
//  (fase 1B, #335 T2). Koppelt de pure orkestratie aan de T1-gateway, de OIDC-
//  client en de Supabase-serverclient van het huidige request.
// ----------------------------------------------------------------------------
//  Geen service-role, geen Graph, geen import uit het connectordomein
//  (microsoft-vault/-connector/-config). Alles wat hier de Supabase-Auth raakt
//  loopt via de RLS-serverclient (cookies van dit request), zodat een uitgegeven
//  sessie direct als Set-Cookie op de redirect meegaat (Route Handler).
// ============================================================================
import "server-only";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { haalFondsContext } from "@/core/lib/tenant-context";
import { microsoftLoginConfig, microsoftLoginGeconfigureerd } from "@/core/lib/microsoft-login-config";
import { maakOidcClient } from "@/core/lib/microsoft-login-oidc";
import * as gateway from "@/core/lib/microsoft-login-gateway";
import { maakMicrosoftLogin, type AuthAdapter, type SupabaseIdentiteit } from "@/core/lib/microsoft-login-orkestratie-core";

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

function identiteiten(user: { identities?: Array<{ provider: string; identity_id?: string; id?: string }> | null } | null | undefined): SupabaseIdentiteit[] {
  return (user?.identities ?? []).map((i) => ({ provider: i.provider, providerId: (i as { id?: string }).id ?? "" }));
}

/** GoTrue meldt een hookweigering als 403 met de hooktekst; alles anders is `auth_fout`. */
function authFout(error: { status?: number; message?: string } | null): "hook_geweigerd" | "auth_fout" {
  return error?.status === 403 ? "hook_geweigerd" : "auth_fout";
}

/** Auth-adapter rond de serverclient van dit request. */
export function maakAuthAdapter(supabase: Supabase): AuthAdapter {
  return {
    async huidigeGebruiker() {
      const { data } = await supabase.auth.getUser();
      return data.user ? { id: data.user.id, identities: identiteiten(data.user) } : null;
    },
    async signInWithIdToken({ token, nonce }) {
      const { data, error } = await supabase.auth.signInWithIdToken({ provider: "azure", token, nonce });
      if (error || !data.user) return { fout: authFout(error) };
      return { user: { id: data.user.id, identities: identiteiten(data.user) } };
    },
    async linkIdentity({ token, nonce }) {
      const { data, error } = await supabase.auth.linkIdentity({ provider: "azure", token, nonce });
      if (error || !data.user) return { fout: authFout(error) };
      return { user: { id: data.user.id, identities: identiteiten(data.user) } };
    },
    async unlinkAzure() {
      const { data, error } = await supabase.auth.getUserIdentities();
      if (error || !data) return false;
      const azure = data.identities.find((i) => i.provider === "azure");
      if (!azure) return true; // al weg: idempotent
      const { error: unlinkFout } = await supabase.auth.unlinkIdentity(azure);
      return !unlinkFout;
    },
    async signOut(scope) {
      await supabase.auth.signOut({ scope }).catch(() => undefined);
    },
    async profielFondsId(userId) {
      const { data } = await supabase.from("profielen").select("fonds_id").eq("id", userId).maybeSingle();
      const fonds = (data as { fonds_id?: string | null } | null)?.fonds_id;
      return typeof fonds === "string" && fonds ? fonds : null;
    },
  };
}

/** Eén flow-instantie per request (de auth-adapter hangt aan de request-cookies). */
export async function microsoftLoginVoorRequest() {
  const supabase = await createServerSupabase();
  const config = microsoftLoginConfig();
  return maakMicrosoftLogin({
    gateway,
    oidc: maakOidcClient(config.authority),
    auth: maakAuthAdapter(supabase),
    config: () => config,
    log: (regel) => console.warn(regel),
  });
}

export { microsoftLoginActief, telStartpoging } from "@/core/lib/microsoft-login-gateway";

/**
 * Bestaat de knop "Inloggen met Microsoft" voor deze host? host → fonds (actieve
 * tenant_domains-rij) → configuratie compleet → fondsflag aan. Elke twijfel of
 * fout = `false` (geen knop, geen verborgen element). Nooit gooien: dit draait op
 * de publieke loginpagina.
 */
export async function microsoftLoginBeschikbaarVoorHost(host: string | null | undefined): Promise<boolean> {
  try {
    if (!microsoftLoginGeconfigureerd()) return false;
    const resolutie = await haalFondsContext(host);
    if (resolutie.type !== "gevonden") return false;
    return (await gateway.microsoftLoginActief(resolutie.fondsId)).actief;
  } catch {
    return false;
  }
}
