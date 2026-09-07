import assert from "node:assert/strict";
import test from "node:test";
import { createSign, generateKeyPairSync } from "node:crypto";
import {
  beoordeelDiscovery,
  beoordeelTokenResponse,
  bouwAuthorizeUrl,
  bouwTokenRequestBody,
  decodeJwt,
  discoveryUrl,
  isToegestaneEndpointUrl,
  kiesJwk,
  MICROSOFT_LOGIN_SCOPES,
  resolveMicrosoftLoginAuthority,
  STANDAARD_AUTHORITY,
  verifieerRs256,
  verwachteIssuer,
} from "./microsoft-login-oidc-core";

const tid = "11111111-2222-3333-4444-555555555555";

test("scopes zijn exact openid profile (E2)", () => {
  assert.deepEqual([...MICROSOFT_LOGIN_SCOPES], ["openid", "profile"]);
});

test("authorize-URL: exact de negen parameters, geen prompt/login_hint/domain_hint, scope letterlijk", () => {
  const url = new URL(
    bouwAuthorizeUrl({
      authorizationEndpoint: `${STANDAARD_AUTHORITY}/${tid}/oauth2/v2.0/authorize?foo=bar`,
      clientId: "client",
      redirectUri: "https://pgb.example/auth/microsoft-login/callback",
      state: "STATE",
      nonceHash: "NONCEHASH",
      codeChallenge: "CHALLENGE",
    }),
  );
  assert.equal(url.origin + url.pathname, `${STANDAARD_AUTHORITY}/${tid}/oauth2/v2.0/authorize`);
  assert.deepEqual([...url.searchParams.keys()].sort(), [
    "client_id", "code_challenge", "code_challenge_method", "nonce", "redirect_uri", "response_mode", "response_type", "scope", "state",
  ]);
  assert.equal(url.searchParams.get("scope"), "openid profile");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("response_mode"), "query");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("nonce"), "NONCEHASH");
  assert.equal(url.searchParams.get("foo"), null, "vreemde query van het endpoint wordt niet doorgegeven");
  assert.doesNotMatch(url.toString(), /offline_access|email|prompt=|login_hint|domain_hint/);
});

test("tokenrequest-body: authorization_code + PKCE + exact openid profile, geen offline_access", () => {
  const body = new URLSearchParams(
    bouwTokenRequestBody({ clientId: "c", clientSecret: "s", code: "CODE", redirectUri: "https://h/auth/microsoft-login/callback", codeVerifier: "V" }),
  );
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code_verifier"), "V");
  assert.equal(body.get("scope"), "openid profile");
  assert.deepEqual([...body.keys()].sort(), ["client_id", "client_secret", "code", "code_verifier", "grant_type", "redirect_uri", "scope"]);
});

test("tokenresponse: refresh_token → weigeren; extra scope → weigeren; id_token verplicht", () => {
  assert.deepEqual(beoordeelTokenResponse({ id_token: "a.b.c", refresh_token: "r" }), {
    ok: false, categorie: "token_response_ongeldig", reden: "refresh_token_aanwezig",
  });
  assert.deepEqual(beoordeelTokenResponse({ id_token: "a.b.c", scope: "openid profile offline_access" }), {
    ok: false, categorie: "token_response_ongeldig", reden: "extra_scope",
  });
  assert.deepEqual(beoordeelTokenResponse({ id_token: "a.b.c", scope: "openid profile email" }), {
    ok: false, categorie: "token_response_ongeldig", reden: "extra_scope",
  });
  assert.deepEqual(beoordeelTokenResponse({ access_token: "x" }), {
    ok: false, categorie: "token_response_ongeldig", reden: "id_token_ontbreekt",
  });
  assert.deepEqual(beoordeelTokenResponse({ id_token: "a.b.c.d.e" }), {
    ok: false, categorie: "token_response_ongeldig", reden: "id_token_formaat",
  });
  assert.deepEqual(beoordeelTokenResponse(null), {
    ok: false, categorie: "token_response_ongeldig", reden: "geen_object",
  });
  assert.deepEqual(beoordeelTokenResponse({ id_token: "a.b.c", scope: "openid profile", access_token: "x", token_type: "Bearer" }), { ok: true, idToken: "a.b.c" });
});

test("discovery: alle endpoints op de authority, issuer exact of {tenantid}-vorm", () => {
  const goed = {
    authorization_endpoint: `${STANDAARD_AUTHORITY}/${tid}/oauth2/v2.0/authorize`,
    token_endpoint: `${STANDAARD_AUTHORITY}/${tid}/oauth2/v2.0/token`,
    jwks_uri: `${STANDAARD_AUTHORITY}/${tid}/discovery/v2.0/keys`,
    issuer: verwachteIssuer(STANDAARD_AUTHORITY, tid),
  };
  assert.equal(beoordeelDiscovery(goed, { authority: STANDAARD_AUTHORITY, tenantId: tid }).ok, true);
  assert.equal(beoordeelDiscovery({ ...goed, issuer: `${STANDAARD_AUTHORITY}/{tenantid}/v2.0` }, { authority: STANDAARD_AUTHORITY, tenantId: tid }).ok, true);
  assert.equal(beoordeelDiscovery({ ...goed, jwks_uri: "https://evil.example/keys" }, { authority: STANDAARD_AUTHORITY, tenantId: tid }).ok, false);
  assert.equal(beoordeelDiscovery({ ...goed, token_endpoint: `http://login.microsoftonline.com/${tid}/oauth2/v2.0/token` }, { authority: STANDAARD_AUTHORITY, tenantId: tid }).ok, false);
  assert.equal(beoordeelDiscovery({ ...goed, issuer: "https://login.microsoftonline.com/common/v2.0" }, { authority: STANDAARD_AUTHORITY, tenantId: tid }).ok, false);
  assert.equal(discoveryUrl(STANDAARD_AUTHORITY, tid), `https://login.microsoftonline.com/${tid}/v2.0/.well-known/openid-configuration`);
});

test("endpoint-URL: alleen dezelfde origin als de authority, zonder credentials", () => {
  assert.equal(isToegestaneEndpointUrl(`${STANDAARD_AUTHORITY}/x`, STANDAARD_AUTHORITY), true);
  assert.equal(isToegestaneEndpointUrl("https://login.microsoftonline.com.evil.example/x", STANDAARD_AUTHORITY), false);
  assert.equal(isToegestaneEndpointUrl("https://user:pw@login.microsoftonline.com/x", STANDAARD_AUTHORITY), false);
  assert.equal(isToegestaneEndpointUrl(42, STANDAARD_AUTHORITY), false);
});

test("authority: productie altijd Microsoft; E2E-stub alleen met de dubbele grendel", () => {
  assert.equal(resolveMicrosoftLoginAuthority({}), STANDAARD_AUTHORITY);
  assert.equal(resolveMicrosoftLoginAuthority({ SEED_DOELOMGEVING: "local" }), STANDAARD_AUTHORITY);
  const goed = {
    MICROSOFT_LOGIN_E2E_OIDC: "local",
    MICROSOFT_LOGIN_E2E_OIDC_URL: "http://127.0.0.1:8791",
    SEED_DOELOMGEVING: "local",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  };
  assert.equal(resolveMicrosoftLoginAuthority(goed), "http://127.0.0.1:8791");
  for (const [naam, env] of [
    ["verkeerde modus", { ...goed, MICROSOFT_LOGIN_E2E_OIDC: "preview" }],
    ["niet-lokale Supabase", { ...goed, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" }],
    ["geen lokale doelomgeving", { ...goed, SEED_DOELOMGEVING: "preview" }],
    ["externe URL", { ...goed, MICROSOFT_LOGIN_E2E_OIDC_URL: "https://login.microsoftonline.com" }],
    ["pad in URL", { ...goed, MICROSOFT_LOGIN_E2E_OIDC_URL: "http://127.0.0.1:8791/x" }],
  ] as const) {
    assert.throws(() => resolveMicrosoftLoginAuthority(env), /E2E OIDC GEBLOKKEERD/, naam);
  }
});

// ── RS256 met een gegenereerd sleutelpaar ────────────────────────────────────
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid: "k1", use: "sig", alg: "RS256" };
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function teken(header: Record<string, unknown>, payload: Record<string, unknown>, key = privateKey): string {
  const input = `${b64u(header)}.${b64u(payload)}`;
  const sig = createSign("RSA-SHA256").update(input).sign(key).toString("base64url");
  return `${input}.${sig}`;
}

test("JWKS: exact één passende kid; twee gelijke kids of een niet-RSA-sleutel → null", () => {
  assert.ok(kiesJwk({ keys: [jwk] }, "k1"));
  assert.equal(kiesJwk({ keys: [jwk, { ...jwk }] }, "k1"), null, "dubbele kid is ambigu");
  assert.equal(kiesJwk({ keys: [{ ...jwk, kty: "EC" }] }, "k1"), null);
  assert.equal(kiesJwk({ keys: [{ ...jwk, alg: "RS512" }] }, "k1"), null);
  assert.equal(kiesJwk({ keys: [jwk] }, "k2"), null);
  assert.equal(kiesJwk({ keys: [jwk] }, undefined), null);
  assert.equal(kiesJwk(null, "k1"), null);
});

test("RS256: geldige handtekening → true; gemanipuleerde payload, andere sleutel of alg none → false", () => {
  const goed = decodeJwt(teken({ alg: "RS256", typ: "JWT", kid: "k1" }, { sub: "x" }))!;
  assert.ok(goed);
  assert.equal(verifieerRs256(goed, jwk), true);

  const [h, , s] = teken({ alg: "RS256", kid: "k1" }, { sub: "x" }).split(".");
  const gemanipuleerd = decodeJwt(`${h}.${b64u({ sub: "y" })}.${s}`)!;
  assert.equal(verifieerRs256(gemanipuleerd, jwk), false);

  const ander = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const metAndereSleutel = decodeJwt(teken({ alg: "RS256", kid: "k1" }, { sub: "x" }, ander.privateKey))!;
  assert.equal(verifieerRs256(metAndereSleutel, jwk), false);

  const none = decodeJwt(`${b64u({ alg: "none", kid: "k1" })}.${b64u({ sub: "x" })}.${Buffer.from("x").toString("base64url")}`)!;
  assert.equal(verifieerRs256(none, jwk), false);

  const hs = decodeJwt(teken({ alg: "HS256", kid: "k1" }, { sub: "x" }))!;
  assert.equal(verifieerRs256(hs, jwk), false, "alg-confusion: alleen RS256");
});

test("decodeJwt: onleesbare of niet-3-delige tokens → null", () => {
  assert.equal(decodeJwt("a.b"), null);
  assert.equal(decodeJwt("a.b.c"), null);
  assert.equal(decodeJwt(`${b64u([1])}.${b64u({})}.x`), null, "header moet een object zijn");
});
