import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { createOidcStub } from "./oidc-stub.mjs";
import { E2E_OIDC } from "./config.mjs";

async function metStub(fn) {
  const { server, stats, jwk } = createOidcStub();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const basis = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(basis, stats, jwk);
  } finally {
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

const b64uJson = (deel) => JSON.parse(Buffer.from(deel, "base64url").toString("utf8"));

async function doorloopFlow(basis, { verifier = randomBytes(32).toString("base64url"), nonce = "nonce-hash", extra = "" } = {}) {
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "http://fonds-a.localhost:3000/auth/microsoft-login/callback";
  const authorize =
    `${basis}/${E2E_OIDC.tenantId}/oauth2/v2.0/authorize?client_id=${E2E_OIDC.clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_mode=query&scope=openid%20profile&state=S1&nonce=${nonce}&code_challenge=${challenge}&code_challenge_method=S256${extra}`;
  const r1 = await fetch(authorize, { redirect: "manual" });
  const terug = new URL(r1.headers.get("location"));
  return { r1, terug, verifier, redirectUri };
}

test("discovery en JWKS liggen op de stub-authority; issuer per tenant", async () => {
  await metStub(async (basis) => {
    const d = await (await fetch(`${basis}/${E2E_OIDC.tenantId}/v2.0/.well-known/openid-configuration`)).json();
    assert.equal(d.issuer, `${basis}/${E2E_OIDC.tenantId}/v2.0`);
    assert.ok(d.token_endpoint.startsWith(basis) && d.jwks_uri.startsWith(basis) && d.authorization_endpoint.startsWith(basis));
    const jwks = await (await fetch(d.jwks_uri)).json();
    assert.equal(jwks.keys.length, 1);
    assert.equal(jwks.keys[0].kid, "e2e-k1");
  });
});

test("authorize → 302 met code+state; token met juiste PKCE-verifier → RS256 ID-token met de gevraagde nonce en acct=0", async () => {
  await metStub(async (basis, stats, jwk) => {
    const { r1, terug, verifier, redirectUri } = await doorloopFlow(basis);
    assert.equal(r1.status, 302);
    assert.equal(terug.origin + terug.pathname, redirectUri);
    assert.equal(terug.searchParams.get("state"), "S1");
    const code = terug.searchParams.get("code");
    assert.ok(code);

    const body = new URLSearchParams({ client_id: E2E_OIDC.clientId, client_secret: "x", grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, scope: "openid profile" });
    const r2 = await fetch(`${basis}/${E2E_OIDC.tenantId}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    const t = await r2.json();
    assert.equal(r2.status, 200);
    assert.equal(t.scope, "openid profile");
    assert.equal("refresh_token" in t, false, "standaard geen refresh-token");
    const [h, p, s] = t.id_token.split(".");
    assert.equal(b64uJson(h).alg, "RS256");
    const claims = b64uJson(p);
    assert.equal(claims.nonce, "nonce-hash");
    assert.equal(claims.acct, 0);
    assert.equal(claims.tid, E2E_OIDC.tenantId);
    assert.equal(claims.aud, E2E_OIDC.clientId);
    assert.equal(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url")), true);
    assert.equal(stats.tokens, 1);

    // Code is eenmalig.
    const r3 = await fetch(`${basis}/${E2E_OIDC.tenantId}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    assert.equal(r3.status, 400);
  });
});

test("verkeerde PKCE-verifier of andere redirect_uri → invalid_grant", async () => {
  await metStub(async (basis) => {
    const { terug, redirectUri } = await doorloopFlow(basis);
    const code = terug.searchParams.get("code");
    const fout = new URLSearchParams({ client_id: E2E_OIDC.clientId, client_secret: "x", grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: "verkeerd", scope: "openid profile" });
    const r = await fetch(`${basis}/${E2E_OIDC.tenantId}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: fout });
    assert.equal(r.status, 400);
  });
});

test("testbesturing: identiteit instelbaar (gast, andere tenant, refresh-token) en e2e_error geeft een weigering terug", async () => {
  await metStub(async (basis) => {
    await fetch(`${basis}/stub/identiteit`, { method: "POST", body: JSON.stringify({ acct: 1, metRefreshToken: true }) });
    const { terug, verifier, redirectUri } = await doorloopFlow(basis);
    const body = new URLSearchParams({ client_id: E2E_OIDC.clientId, client_secret: "x", grant_type: "authorization_code", code: terug.searchParams.get("code"), redirect_uri: redirectUri, code_verifier: verifier, scope: "openid profile" });
    const t = await (await fetch(`${basis}/${E2E_OIDC.tenantId}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body })).json();
    assert.equal(b64uJson(t.id_token.split(".")[1]).acct, 1);
    assert.ok(t.refresh_token);

    const { terug: geweigerd } = await doorloopFlow(basis, { extra: "&e2e_error=access_denied" });
    assert.equal(geweigerd.searchParams.get("error"), "access_denied");
    assert.equal(geweigerd.searchParams.get("code"), null);
  });
});

test("de stub bewaart alleen vorm: geen state-, nonce-, code- of tokenwaarden in /verzoeken", async () => {
  await metStub(async (basis) => {
    const { terug, verifier, redirectUri } = await doorloopFlow(basis, { nonce: "GEHEIME-NONCE-HASH" });
    const code = terug.searchParams.get("code");
    const body = new URLSearchParams({ client_id: E2E_OIDC.clientId, client_secret: "GEHEIM-SECRET", grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, scope: "openid profile" });
    await fetch(`${basis}/${E2E_OIDC.tenantId}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    const verzoeken = await (await fetch(`${basis}/verzoeken`)).json();
    const dump = JSON.stringify(verzoeken);
    assert.equal(verzoeken.length, 2);
    assert.deepEqual(verzoeken[0].parameters, ["client_id", "code_challenge", "code_challenge_method", "nonce", "redirect_uri", "response_mode", "response_type", "scope", "state"]);
    assert.equal(verzoeken[0].scope, "openid profile");
    assert.equal(verzoeken[1].heeft_secret, true);
    assert.doesNotMatch(dump, /S1|GEHEIME-NONCE-HASH|GEHEIM-SECRET/);
    assert.doesNotMatch(dump, new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
