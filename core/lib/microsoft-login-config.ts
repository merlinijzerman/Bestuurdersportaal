// ============================================================================
//  core/lib/microsoft-login-config.ts — server-only configuratie van de
//  Microsoft-login (App L). Fail-closed: ontbreekt iets, dan gooit dit en tonen
//  knop en routes niets/404 (invariant O1). Géén hergebruik van MICROSOFT_*-
//  connectorvariabelen of -sleutels (besluit 0211 D7, gescheiden domeinen).
// ============================================================================
import "server-only";
import { parseLoginSleutel } from "@/core/lib/microsoft-login-crypto-core";
import { resolveMicrosoftLoginAuthority } from "@/core/lib/microsoft-login-oidc-core";
import type { LoginConfig } from "@/core/lib/microsoft-login-orkestratie-core";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function microsoftLoginConfig(env: NodeJS.ProcessEnv = process.env): LoginConfig {
  const tenantId = env.MICROSOFT_LOGIN_TENANT_ID?.trim();
  const clientId = env.MICROSOFT_LOGIN_CLIENT_ID?.trim();
  const clientSecret = env.MICROSOFT_LOGIN_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) throw new Error("Microsoft-login is niet geconfigureerd.");
  if (!GUID.test(tenantId)) throw new Error("Microsoft-login-tenant-id is ongeldig.");
  const sleutel = parseLoginSleutel(env.MICROSOFT_LOGIN_ENCRYPTION_KEY, env.MICROSOFT_LOGIN_KEY_VERSION);
  const authority = resolveMicrosoftLoginAuthority(env);
  // http-callback alleen op de lokale wegwerp-stack (dezelfde grendel als de gateway-TLS-uitzondering).
  const lokaalToegestaan = env.SEED_DOELOMGEVING === "local";
  return { tenantId, clientId, clientSecret, sleutel, authority, lokaalToegestaan };
}

/** Is de configuratie compleet? Voor de knop/kaart: nooit gooien, alleen ja/nee. */
export function microsoftLoginGeconfigureerd(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    microsoftLoginConfig(env);
    return true;
  } catch {
    return false;
  }
}
