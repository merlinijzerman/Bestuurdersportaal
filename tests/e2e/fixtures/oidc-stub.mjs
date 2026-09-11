// ============================================================================
//  Lokale OIDC-stub voor de Microsoft-login-E2E (#335 T2). Patroon: ai-provider-
//  stub.mjs. Speelt "Entra" na voor de eigen directe authorization-code-flow:
//  discovery, JWKS, authorize (302 met code+state) en token (RS256 ID-token met
//  een per proces gegenereerde sleutel). Alleen bereikbaar in de expliciet
//  gegrendelde lokale E2E-modus (core/lib/microsoft-login-oidc-core.ts,
//  resolveMicrosoftLoginAuthority: dubbele grendel), nooit op Preview/Productie.
//
//  Wat de stub bewaart: uitsluitend VORM — parameternamen, scope, response_type,
//  challenge-methode, aantal tokenwissels — nooit state-, nonce-, code- of
//  tokenwaarden (`/verzoeken`). De identiteit die het ID-token draagt is per test
//  instelbaar via `POST /stub/identiteit` (oid/sub/acct/tid, metRefreshToken).
//
//  Belangrijke grens: de lokale GoTrue verifieert ID-tokens tegen de ECHTE
//  Microsoft-JWKS. De stub bewijst daarom alles TOT de Supabase-stap (knop,
//  startparameters, PKCE, claims, weigeringen, replay, neutrale meldingen) en de
//  koppelflow tot en met de reservering; de positieve sign-in/link tegen GoTrue is
//  door spike T0.5 (echte Entra) en de Preview-smoke gedekt, niet door deze stub.
// ============================================================================
import http from "node:http";
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { E2E_OIDC } from "./config.mjs";

export const OIDC_STUB_POORT = E2E_OIDC.poort;
const MAX_VERZOEKEN = 50;

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function leesBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

export function createOidcStub({ tenantId = E2E_OIDC.tenantId, clientId = E2E_OIDC.clientId } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "e2e-k1";
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" };

  const stats = { authorize: 0, tokens: 0, weigeringen: 0 };
  const verzoeken = [];
  const codes = new Map(); // code → { nonce, redirectUri, codeChallenge, clientId }
  let identiteit = { ...E2E_OIDC.identiteit };

  function issuer(base) {
    return `${base}/${tenantId}/v2.0`;
  }

  function idToken(base, nonce) {
    const nu = Math.floor(Date.now() / 1000);
    const payload = {
      iss: issuer(base),
      aud: clientId,
      iat: nu,
      nbf: nu,
      exp: nu + 3600,
      ver: "2.0",
      nonce,
      tid: identiteit.tid ?? tenantId,
      oid: identiteit.oid,
      sub: identiteit.sub,
      acct: identiteit.acct,
      ...(identiteit.idp ? { idp: identiteit.idp } : {}),
    };
    const input = `${b64u({ typ: "JWT", alg: "RS256", kid })}.${b64u(payload)}`;
    const sig = createSign("RSA-SHA256").update(input).sign(privateKey).toString("base64url");
    return `${input}.${sig}`;
  }

  const server = http.createServer(async (req, res) => {
    const base = `http://${req.headers.host}`;
    const url = new URL(req.url, base);
    const p = url.pathname;

    if (req.method === "GET" && p === "/health") return json(res, 200, { ok: true });
    if (req.method === "GET" && p === "/stats") return json(res, 200, stats);
    if (req.method === "GET" && p === "/verzoeken") return json(res, 200, verzoeken);
    if (req.method === "DELETE" && p === "/verzoeken") {
      verzoeken.length = 0;
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && p === "/stub/identiteit") {
      // Testbesturing: welke identiteit het volgende ID-token draagt.
      const body = JSON.parse((await leesBody(req)) || "{}");
      identiteit = { ...E2E_OIDC.identiteit, ...body };
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && p === `/${tenantId}/v2.0/.well-known/openid-configuration`) {
      return json(res, 200, {
        issuer: issuer(base),
        authorization_endpoint: `${base}/${tenantId}/oauth2/v2.0/authorize`,
        token_endpoint: `${base}/${tenantId}/oauth2/v2.0/token`,
        jwks_uri: `${base}/${tenantId}/discovery/v2.0/keys`,
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }
    if (req.method === "GET" && p === `/${tenantId}/discovery/v2.0/keys`) return json(res, 200, { keys: [jwk] });

    if (req.method === "GET" && p === `/${tenantId}/oauth2/v2.0/authorize`) {
      stats.authorize += 1;
      const q = url.searchParams;
      verzoeken.push({
        soort: "authorize",
        parameters: [...q.keys()].sort(),
        scope: q.get("scope"),
        response_type: q.get("response_type"),
        response_mode: q.get("response_mode"),
        code_challenge_method: q.get("code_challenge_method"),
        client_id_ok: q.get("client_id") === clientId,
      });
      if (verzoeken.length > MAX_VERZOEKEN) verzoeken.shift();
      const redirectUri = q.get("redirect_uri");
      const state = q.get("state");
      if (!redirectUri || !state) return json(res, 400, { error: "invalid_request" });
      const terug = new URL(redirectUri);
      if (q.get("e2e_error")) {
        stats.weigeringen += 1;
        terug.searchParams.set("error", q.get("e2e_error"));
        terug.searchParams.set("state", state);
      } else {
        const code = randomBytes(24).toString("base64url");
        codes.set(code, { nonce: q.get("nonce"), redirectUri, codeChallenge: q.get("code_challenge"), clientId: q.get("client_id") });
        terug.searchParams.set("code", code);
        terug.searchParams.set("state", state);
      }
      res.writeHead(302, { location: terug.toString(), "cache-control": "no-store" });
      return res.end();
    }

    if (req.method === "POST" && p === `/${tenantId}/oauth2/v2.0/token`) {
      const form = new URLSearchParams(await leesBody(req));
      stats.tokens += 1;
      verzoeken.push({
        soort: "token",
        parameters: [...form.keys()].sort(),
        grant_type: form.get("grant_type"),
        scope: form.get("scope"),
        heeft_secret: Boolean(form.get("client_secret")),
      });
      if (verzoeken.length > MAX_VERZOEKEN) verzoeken.shift();
      const code = form.get("code");
      const bekend = code ? codes.get(code) : undefined;
      if (!bekend) return json(res, 400, { error: "invalid_grant" });
      codes.delete(code); // eenmalig
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (
        form.get("grant_type") !== "authorization_code" ||
        form.get("redirect_uri") !== bekend.redirectUri ||
        challenge !== bekend.codeChallenge ||
        form.get("client_id") !== bekend.clientId ||
        !form.get("client_secret")
      ) {
        return json(res, 400, { error: "invalid_grant" });
      }
      const antwoord = {
        token_type: "Bearer",
        scope: "openid profile",
        expires_in: 3600,
        access_token: "e2e-opaque-access-token",
        id_token: idToken(base, bekend.nonce),
      };
      if (identiteit.metRefreshToken) antwoord.refresh_token = "e2e-refresh-token-die-de-app-moet-weigeren";
      return json(res, 200, antwoord);
    }

    return json(res, 404, { error: "not_found" });
  });

  return { server, stats, jwk };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server } = createOidcStub();
  server.listen(OIDC_STUB_POORT, "127.0.0.1", () => {
    process.stdout.write(`E2E OIDC-stub luistert op 127.0.0.1:${OIDC_STUB_POORT}\n`);
  });
}
