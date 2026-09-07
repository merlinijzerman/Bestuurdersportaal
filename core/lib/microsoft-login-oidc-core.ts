// ============================================================================
//  core/lib/microsoft-login-oidc-core.ts — PURE OIDC-bouwstenen voor de eigen
//  directe authorization-code-flow (fase 1B, #335 T2; ontwerp §3.1, §6.1–§6.3).
// ----------------------------------------------------------------------------
//  Waarom eigen bouwstenen en geen MSAL: MSAL-node voegt in dit pad automatisch
//  `offline_access` toe (refresh-token), wat de minimale-scope-invariant schendt.
//  Deze module bouwt authorize- en tokenrequest zelf, weigert een tokenresponse
//  met refresh_token, laat discovery/JWKS uitsluitend op de Microsoft-authority toe
//  en verifieert het ID-token als RS256 met exact één passende `kid` (node:crypto,
//  gespiegeld aan de spike; besluit V10). Puur: geen fetch, geen env-lezen — de
//  server-only laag (microsoft-login-oidc.ts) doet de I/O.
// ============================================================================

import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from "node:crypto";
import type { MicrosoftLoginFoutcategorie } from "@/core/lib/microsoft-login-error-core";

/** De ENIGE scopes (E2). Contracttest §C1 pint deze en de querystring. */
export const MICROSOFT_LOGIN_SCOPES = ["openid", "profile"] as const;
export const MICROSOFT_LOGIN_SCOPE_STRING = MICROSOFT_LOGIN_SCOPES.join(" ");

export const STANDAARD_AUTHORITY = "https://login.microsoftonline.com";
const LOKALE_SUPABASE_URL = "http://127.0.0.1:54321";

/**
 * Authority-oorsprong. Productie/Preview: altijd Microsoft. Uitsluitend in de
 * expliciete lokale E2E-modus (dubbele grendel, patroon core/lib/ai-provider-
 * endpoint.mjs) mag een lokale OIDC-stub de plaats innemen; élke afwijking gooit.
 */
export function resolveMicrosoftLoginAuthority(env: Record<string, string | undefined> = {}): string {
  if (!env.MICROSOFT_LOGIN_E2E_OIDC) return STANDAARD_AUTHORITY;
  const blok = (reden: string) => {
    throw new Error(`E2E OIDC GEBLOKKEERD: ${reden}`);
  };
  if (env.MICROSOFT_LOGIN_E2E_OIDC !== "local") blok("MICROSOFT_LOGIN_E2E_OIDC moet exact 'local' zijn.");
  if (env.SEED_DOELOMGEVING !== "local") blok("SEED_DOELOMGEVING moet exact 'local' zijn.");
  if (env.NEXT_PUBLIC_SUPABASE_URL !== LOKALE_SUPABASE_URL) blok(`NEXT_PUBLIC_SUPABASE_URL moet exact ${LOKALE_SUPABASE_URL} zijn.`);
  let url: URL;
  try {
    url = new URL(env.MICROSOFT_LOGIN_E2E_OIDC_URL ?? "");
  } catch {
    return blok("MICROSOFT_LOGIN_E2E_OIDC_URL ontbreekt of is ongeldig.");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password) {
    blok("de OIDC-stub-URL moet een lokale http-origin zonder credentials zijn.");
  }
  if (url.pathname !== "/" || url.search || url.hash) blok("de OIDC-stub-URL mag geen pad, query of fragment bevatten.");
  return url.origin;
}

export function discoveryUrl(authority: string, tenantId: string): string {
  return `${authority}/${tenantId}/v2.0/.well-known/openid-configuration`;
}

export function verwachteIssuer(authority: string, tenantId: string): string {
  return `${authority}/${tenantId}/v2.0`;
}

/** Elk endpoint (authorize, token, jwks) moet op de authority-oorsprong liggen. */
export function isToegestaneEndpointUrl(kandidaat: unknown, authority: string): kandidaat is string {
  if (typeof kandidaat !== "string") return false;
  try {
    const u = new URL(kandidaat);
    const a = new URL(authority);
    return u.origin === a.origin && u.protocol === a.protocol && !u.username && !u.password;
  } catch {
    return false;
  }
}

export type DiscoveryDocument = {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly issuer: string;
};

/** Toetst het discovery-document: alle endpoints op de authority, issuer exact. */
export function beoordeelDiscovery(
  json: unknown,
  verwacht: { authority: string; tenantId: string },
): { ok: true; document: DiscoveryDocument } | { ok: false; categorie: "discovery_fout" } {
  const d = json as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return { ok: false, categorie: "discovery_fout" };
  const { authorization_endpoint, token_endpoint, jwks_uri, issuer } = d;
  if (
    !isToegestaneEndpointUrl(authorization_endpoint, verwacht.authority) ||
    !isToegestaneEndpointUrl(token_endpoint, verwacht.authority) ||
    !isToegestaneEndpointUrl(jwks_uri, verwacht.authority) ||
    typeof issuer !== "string"
  ) {
    return { ok: false, categorie: "discovery_fout" };
  }
  // Microsoft publiceert `{tenantid}` letterlijk in het gemeenschappelijke document;
  // per-tenant discovery geeft de concrete issuer. Beide vormen zijn toegestaan.
  const issuerOk =
    issuer.toLowerCase() === verwachteIssuer(verwacht.authority, verwacht.tenantId).toLowerCase() ||
    issuer === `${verwacht.authority}/{tenantid}/v2.0`;
  if (!issuerOk) return { ok: false, categorie: "discovery_fout" };
  return { ok: true, document: { authorization_endpoint, token_endpoint, jwks_uri, issuer } };
}

/**
 * Authorize-URL: exact `openid profile`, response_type=code, response_mode=query,
 * PKCE S256, `nonce` = sha256-hex van onze nonce. GEEN prompt, GEEN login_hint,
 * GEEN domain_hint (die zouden accountinformatie in de URL zetten).
 */
export function bouwAuthorizeUrl(args: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonceHash: string;
  codeChallenge: string;
}): string {
  const u = new URL(args.authorizationEndpoint);
  u.search = "";
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", MICROSOFT_LOGIN_SCOPE_STRING);
  u.searchParams.set("state", args.state);
  u.searchParams.set("nonce", args.nonceHash);
  u.searchParams.set("code_challenge", args.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/** Tokenrequest-body (application/x-www-form-urlencoded). */
export function bouwTokenRequestBody(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): string {
  const p = new URLSearchParams();
  p.set("client_id", args.clientId);
  p.set("client_secret", args.clientSecret);
  p.set("grant_type", "authorization_code");
  p.set("code", args.code);
  p.set("redirect_uri", args.redirectUri);
  p.set("code_verifier", args.codeVerifier);
  p.set("scope", MICROSOFT_LOGIN_SCOPE_STRING);
  return p.toString();
}

/**
 * Tokenresponse: MOET een id_token dragen; MAG GEEN refresh_token dragen (E2);
 * de teruggegeven scope mag niets buiten `openid profile` bevatten.
 */
export function beoordeelTokenResponse(
  json: unknown,
): { ok: true; idToken: string } | { ok: false; categorie: Extract<MicrosoftLoginFoutcategorie, "token_response_ongeldig"> } {
  const r = json as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return { ok: false, categorie: "token_response_ongeldig" };
  if ("refresh_token" in r && r.refresh_token !== undefined && r.refresh_token !== null) {
    return { ok: false, categorie: "token_response_ongeldig" };
  }
  if (typeof r.id_token !== "string" || r.id_token.split(".").length !== 3) {
    return { ok: false, categorie: "token_response_ongeldig" };
  }
  if (typeof r.scope === "string") {
    const toegestaan = new Set<string>(MICROSOFT_LOGIN_SCOPES);
    const extra = r.scope.split(/\s+/).filter((s) => s && !toegestaan.has(s));
    if (extra.length) return { ok: false, categorie: "token_response_ongeldig" };
  }
  return { ok: true, idToken: r.id_token };
}

// ── JWT / JWKS ──────────────────────────────────────────────────────────────

export type JwtDelen = {
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
  readonly signingInput: string;
  readonly signature: Buffer;
};

function b64urlJson(deel: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(deel, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Decodeert zonder te verifiëren (verificatie: verifieerRs256). */
export function decodeJwt(token: string): JwtDelen | null {
  const delen = token.split(".");
  if (delen.length !== 3 || delen.some((d) => !d || !/^[A-Za-z0-9_-]+$/.test(d))) return null;
  const header = b64urlJson(delen[0]!);
  const payload = b64urlJson(delen[1]!);
  if (!header || !payload) return null;
  return { header, payload, signingInput: `${delen[0]}.${delen[1]}`, signature: Buffer.from(delen[2]!, "base64url") };
}

/** Exact één RSA-sleutel met deze `kid`, geschikt voor RS256 (alg afwezig of RS256, use afwezig of sig). */
export function kiesJwk(jwks: unknown, kid: unknown): JsonWebKey | null {
  if (typeof kid !== "string" || !kid) return null;
  const keys = (jwks as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) return null;
  const passend = keys.filter((k): k is JsonWebKey & { kid: string } => {
    const j = k as Record<string, unknown> | null;
    return (
      !!j &&
      j.kid === kid &&
      j.kty === "RSA" &&
      typeof j.n === "string" &&
      typeof j.e === "string" &&
      (j.alg === undefined || j.alg === "RS256") &&
      (j.use === undefined || j.use === "sig")
    );
  });
  return passend.length === 1 ? passend[0]! : null;
}

/** RS256-verificatie met node:crypto. `alg` in de header MOET RS256 zijn. */
export function verifieerRs256(delen: JwtDelen, jwk: JsonWebKey): boolean {
  if (delen.header.alg !== "RS256") return false;
  try {
    const sleutel = createPublicKey({ key: jwk, format: "jwk" });
    return cryptoVerify("RSA-SHA256", Buffer.from(delen.signingInput, "utf8"), sleutel, delen.signature);
  } catch {
    return false;
  }
}
