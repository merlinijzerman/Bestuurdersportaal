// ============================================================================
//  Platform-auth: identiteitsresolutie + live MFA/AAL2-check (Increment P0).
// ----------------------------------------------------------------------------
//  Auth-context 3b (B14): platform-identiteiten leven in dezelfde Supabase-
//  auth-pool als tenants, maar krijgen GEEN profielen-rij. De scheiding wordt
//  met code afgedwongen (TO §3.1):
//   - een platform-sessie is geldig als auth.uid() een platform_identities-rij
//     heeft EN geen profielen-rij (anders is het een tenant-account);
//   - de live AAL2-check (niet de mfa_enrolled-boolean) is bindend voor MFA.
//
//  De identiteitslookup gebruikt de SESSIE-client (anon-key + cookies) voor
//  auth.uid()/AAL, en de SERVICE-ROLE-client alleen voor de registers
//  (platform_identities, profielen, platform_identity_capabilities) die voor de
//  anon-key deny-by-default zijn. De service-role wordt hier NIET voor een
//  businessactie gebruikt — alleen voor identiteits-/autorisatie-resolutie die
//  de wrapper nodig heeft vóór de poort opengaat.
// ============================================================================

import "server-only";
import { createServerSupabase } from "@/core/lib/supabase-server";
import { createPlatformSupabase } from "@/platform/lib/supabase-platform";
import {
  PLATFORM_CAPABILITIES,
  type PlatformCapability,
} from "@/platform/lib/platform-capabilities";

export type PlatformIdentiteit = {
  id: string;
  email: string;
  naam: string;
  actief: boolean;
  mfa_enrolled: boolean;
  capabilities: PlatformCapability[];
};

/** Resolveert de actuele platform-identiteit uit de sessie, of null.
 *  Null bij: geen sessie; sessie zonder platform_identities-rij; sessie MÉT een
 *  profielen-rij (= tenant-account, 3b-blokkade). De effectieve capabilities
 *  komen uit de actieve grants (ingetrokken_op is null). */
export async function huidigePlatformIdentiteit(): Promise<PlatformIdentiteit | null> {
  const sessie = await createServerSupabase();
  const {
    data: { user },
  } = await sessie.auth.getUser();
  if (!user) return null;

  const svc = createPlatformSupabase();

  // 3b-blokkade: een account met een profielen-rij is een TENANT-account en mag
  // nooit als platform-identiteit gelden, ook al bestaat er (per ongeluk) een
  // platform_identities-rij met hetzelfde id.
  const { data: profiel } = await svc
    .from("profielen")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (profiel) return null;

  const { data: identity } = await svc
    .from("platform_identities")
    .select("id, email, naam, actief, mfa_enrolled")
    .eq("id", user.id)
    .maybeSingle();
  if (!identity) return null;

  const { data: grants } = await svc
    .from("platform_identity_capabilities")
    .select("capability")
    .eq("identity_id", user.id)
    .is("ingetrokken_op", null);

  const geldig = new Set<string>(PLATFORM_CAPABILITIES);
  const capabilities = (grants ?? [])
    .map((g) => g.capability as string)
    .filter((c): c is PlatformCapability => geldig.has(c));

  return {
    id: identity.id,
    email: identity.email,
    naam: identity.naam,
    actief: identity.actief,
    mfa_enrolled: identity.mfa_enrolled,
    capabilities,
  };
}

/** Live MFA-check: bindend is het sessie-AAL (AAL2), NIET de mfa_enrolled-cache
 *  (TO §3.2). Trekt de auth-provider MFA in, dan zakt het AAL en vervalt de
 *  toegang automatisch — ook bij mfa_enrolled=true (TO §12 test 16b). */
export async function heeftActueleMFA(): Promise<boolean> {
  const sessie = await createServerSupabase();
  const { data, error } = await sessie.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.currentLevel === "aal2";
}
