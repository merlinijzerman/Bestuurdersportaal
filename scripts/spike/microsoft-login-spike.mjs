#!/usr/bin/env node
// ============================================================================
//  Spike T0.5 (#335, besluit 0211) — GEEN productiecode.
// ----------------------------------------------------------------------------
//  Meet tegen een LOKALE Supabase-stack met het wegwerp-hookprototype uit
//  scripts/spike/spike-hook.sql (zie README). Twee modi:
//
//  SPIKE_MODE=hoofd (standaard; hook AAN):
//   S8    /auth/v1/health → versie ≥ 2.185.0
//   S1    ID-token: exacte iss/aud/exp/ver/nonce/tid, niet-lege oid/sub, acct=0, idp afwezig
//   S2    id_token-grant zonder sessie, identiteit onbekend → 422 signup_disabled
//   S3a   link_identity ZONDER reservering → 403 (hook) én geen identiteit (tx teruggerold)
//   S3a'  pending voor IDENTITEIT A (andere sub/tid/oid) → link met token B → 403 én geen identiteit
//   S3b   pending voor B → link_identity → identiteit, zelfde user; provider_id = sub
//   S3c   identity_data.custom_claims.tid/oid == tokenclaims (harde eis: de hook leunt erop)
//   S4    uitloggen → id_token-grant → sessie, amr ∋ oauth
//   S10e  basislijn: oauth-sessie met active binding → GET /rest/v1/profielen → 200
//   S10a  binding revoked → id_token-grant → 403 (hook)
//   S10b  bewaard access-token → REST 200 tot exp (venster); refresh → 403
//   S10c  wachtwoordlogin + refresh bij revoked binding → 200
//   S10d  wachtwoordsessie → GET /rest/v1/profielen → 200
//   S5    binding active → unlink → id_token-grant → 422 signup_disabled
//   S6    hosted flow: alleen redirect_uri-controle; browsertest HANDMATIG
//
//  SPIKE_MODE=s7 (negatieve test; hook UIT in config.toml; SPIKE_SCOPES="openid profile email";
//  inloggen met het TWEEDE account, zelfde e-mailadres als het lokale testaccount):
//   S7a   id_token-grant zonder sessie → verwacht ZONDER linking domain: 200 + identiteit aan het
//         bestaande account (automatische e-mailkoppeling); MET linking domain of zonder email:
//         422 signup_disabled. Het script meet en rapporteert; identiteit wordt opgeruimd.
//
//  Markdown-uitvoer op stdout; geen tokens, codes, nonces of e-mailadressen daarin.
//  LET OP: de terminal (stderr) toont de autorisatie-URL met tijdelijk state-/noncemateriaal.
//
//  Env: SPIKE_SUPABASE_URL, SPIKE_SUPABASE_ANON_KEY, TEST_DATABASE_URL, MICROSOFT_LOGIN_TENANT_ID,
//  MICROSOFT_LOGIN_CLIENT_ID, MICROSOFT_LOGIN_CLIENT_SECRET, SPIKE_TEST_EMAIL, SPIKE_TEST_PASSWORD,
//  optioneel SPIKE_SCOPES, SPIKE_PORT (3999), SPIKE_TIMEOUT_S (300), SPIKE_MODE (hoofd|s7).
// ============================================================================
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { ConfidentialClientApplication } from "@azure/msal-node";
import pgModule from "pg";

const env = (naam, verplicht = true) => {
  const v = process.env[naam]?.trim();
  if (!v && verplicht) throw new Error(`${naam} ontbreekt`);
  return v ?? "";
};

const MODE = env("SPIKE_MODE", false) || "hoofd";
const SUPABASE_URL = env("SPIKE_SUPABASE_URL").replace(/\/$/, "");
const ANON = env("SPIKE_SUPABASE_ANON_KEY");
const DB_URL = env("TEST_DATABASE_URL");
const TENANT = env("MICROSOFT_LOGIN_TENANT_ID").toLowerCase();
const CLIENT_ID = env("MICROSOFT_LOGIN_CLIENT_ID");
const CLIENT_SECRET = env("MICROSOFT_LOGIN_CLIENT_SECRET");
const TEST_EMAIL = env("SPIKE_TEST_EMAIL");
const TEST_PASSWORD = env("SPIKE_TEST_PASSWORD");
const SCOPES = (env("SPIKE_SCOPES", false) || "openid profile").split(/\s+/).filter(Boolean);
const PORT = Number(env("SPIKE_PORT", false) || 3999);
const TIMEOUT_MS = Number(env("SPIKE_TIMEOUT_S", false) || 300) * 1000;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const MSA_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
const b64url = (n) => randomBytes(n).toString("base64url");
const challenge = (v) => createHash("sha256").update(v).digest("base64url");
const decodeJwt = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
const nietLeeg = (v) => typeof v === "string" && v.length > 0;

const regels = [];
let rood = 0;
const meet = (id, omschrijving, verwacht, gemeten, ok) => {
  if (!ok) rood += 1;
  regels.push(`| ${id} | ${omschrijving} | ${verwacht} | ${gemeten} | ${ok ? "✅" : "❌"} |`);
  process.stderr.write(`${ok ? "OK  " : "FOUT"} ${id}: ${gemeten}\n`);
};
/** S7 is alleen zinvol met een vooraf uitgesproken verwachting; beide uitkomsten "groen" rekenen is geen test. */
const S7_VERWACHT = env("SPIKE_S7_VERWACHT", MODE === "s7");
if (MODE === "s7" && !["auto_link", "signup_disabled"].includes(S7_VERWACHT)) throw new Error("SPIKE_S7_VERWACHT moet auto_link of signup_disabled zijn");
const info = (id, omschrijving, gemeten) => regels.push(`| ${id} | ${omschrijving} | — | ${gemeten} | ℹ️ |`);

// ── GoTrue / PostgREST ────────────────────────────────────────────────────────
async function api(pad, { method = "GET", body, bearer, prefix = "/auth/v1" } = {}) {
  const res = await fetch(`${SUPABASE_URL}${prefix}${pad}`, {
    method,
    headers: { apikey: ANON, "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let json = null;
  try { json = await res.json(); } catch { /* geen body */ }
  return { status: res.status, json, headers: res.headers };
}
const idTokenGrant = (idToken, nonce, extra = {}, bearer) =>
  api("/token?grant_type=id_token", { method: "POST", body: { provider: "azure", id_token: idToken, nonce, ...extra }, bearer });
const foutcode = (r) => r.json?.error_code ?? r.json?.code ?? r.json?.error ?? r.json?.msg ?? "(geen)";
const rest = (bearer) => api("/profielen?select=id&limit=1", { bearer, prefix: "/rest/v1" });
const wachtwoordLogin = () => api("/token?grant_type=password", { method: "POST", body: { email: TEST_EMAIL, password: TEST_PASSWORD } });

// ── Database ─────────────────────────────────────────────────────────────────
const pg = new pgModule.Client({ connectionString: DB_URL });
async function tel() {
  const u = await pg.query("select count(*)::int as n from auth.users");
  const i = await pg.query("select count(*)::int as n from auth.identities where provider = 'azure'");
  return { users: u.rows[0].n, azure: i.rows[0].n };
}
const telTekst = (t) => `users=${t.users}, azure-identiteiten=${t.azure}`;
const zetBinding = (userId, status, ident) => pg.query(
  `insert into spike_private.bindingen (user_id, status, pending_verloopt_op, sub, tid, oid)
   values ($1, $2, case when $2 = 'pending' then now() + interval '10 minutes' end, $3, $4, $5)
   on conflict (user_id) do update set status = excluded.status, pending_verloopt_op = excluded.pending_verloopt_op,
     sub = excluded.sub, tid = excluded.tid, oid = excluded.oid`,
  [userId, status, ident.sub, ident.tid, ident.oid]);
const wisBinding = (userId) => pg.query("delete from spike_private.bindingen where user_id = $1", [userId]);

// ── Eigen OIDC-flow (MSAL, PKCE, state, nonce) ───────────────────────────────
let server = null;
async function haalIdToken() {
  const msal = new ConfidentialClientApplication({
    auth: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, authority: `https://login.microsoftonline.com/${TENANT}` },
  });
  const state = b64url(32), nonce = b64url(32), verifier = b64url(64);
  const url = await msal.getAuthCodeUrl({
    scopes: SCOPES, redirectUri: REDIRECT_URI, state,
    nonce: sha256hex(nonce),                    // GoTrue vergelijkt sha256(nonce-param) met de nonce-claim
    codeChallenge: challenge(verifier), codeChallengeMethod: "S256",
    prompt: "select_account", responseMode: "query",
  });
  process.stderr.write(`\n[bevat tijdelijk state-/noncemateriaal — niet delen]\nOpen in de browser en log in met het Microsoft-${MODE === "s7" ? "TWEEDE" : "test"}account:\n${url}\n\n`);
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server?.close(); reject(new Error(`geen callback binnen ${TIMEOUT_MS / 1000} s`)); }, TIMEOUT_MS);
    server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URI);
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const fout = u.searchParams.get("error"), st = u.searchParams.get("state"), c = u.searchParams.get("code");
      if (fout) { res.writeHead(400, { "Content-Type": "text/plain" }).end("Spike: Entra gaf een fout terug."); clearTimeout(timer); server.close(); return reject(new Error(`Entra-fout: ${fout}`)); }
      if (st !== state) { res.writeHead(400, { "Content-Type": "text/plain" }).end("Spike: state klopt niet."); return; }
      if (!c) { res.writeHead(400, { "Content-Type": "text/plain" }).end("Spike: code ontbreekt."); return; }
      res.writeHead(200, { "Content-Type": "text/plain" }).end("Spike: je kunt dit venster sluiten.");
      clearTimeout(timer); server.close(); resolve(c);
    }).listen(PORT, "127.0.0.1");
  });
  const result = await msal.acquireTokenByCode({ code, scopes: SCOPES, redirectUri: REDIRECT_URI, codeVerifier: verifier, nonce: sha256hex(nonce) });
  return { idToken: result.idToken, claims: result.idTokenClaims ?? {}, nonce };
}

function meetClaims(claims, nonce) {
  const heeft = (k) => Object.prototype.hasOwnProperty.call(claims, k);
  const nu = Math.floor(Date.now() / 1000);
  const issOk = String(claims.iss).toLowerCase() === `https://login.microsoftonline.com/${TENANT}/v2.0`;
  meet("S1a", "`iss` exact", "https://login.microsoftonline.com/<tid>/v2.0", issOk ? "gelijk" : "ANDERS", issOk);
  meet("S1b", "`aud` = App L", "gelijk", claims.aud === CLIENT_ID ? "gelijk" : "ANDERS", claims.aud === CLIENT_ID);
  meet("S1c", "`exp` in de toekomst, `ver` = 2.0", "ja", `exp-nu=${Number(claims.exp) - nu}s, ver=${claims.ver}`, Number(claims.exp) > nu && String(claims.ver) === "2.0");
  meet("S1d", "`nonce` = sha256(onze nonce)", "gelijk", claims.nonce === sha256hex(nonce) ? "gelijk" : "ANDERS", claims.nonce === sha256hex(nonce));
  const tidOk = String(claims.tid).toLowerCase() === TENANT && claims.tid !== MSA_TENANT;
  meet("S1e", "`tid` = onze tenant en ≠ MSA-tenant", "ja", tidOk ? "gelijk" : "ANDERS", tidOk);
  meet("S1f", "`oid` en `sub` niet-leeg", "ja", `oid=${nietLeeg(claims.oid) ? "aanwezig" : "LEEG"}, sub=${nietLeeg(claims.sub) ? "aanwezig" : "LEEG"}`, nietLeeg(claims.oid) && nietLeeg(claims.sub));
  meet("S1g", "`acct` aanwezig en 0", "acct=0", heeft("acct") ? `acct=${claims.acct}` : "ontbreekt", heeft("acct") && Number(claims.acct) === 0);
  meet("S1h", "`idp` afwezig of = iss", "afwezig", heeft("idp") ? (claims.idp === claims.iss ? "= iss" : "≠ iss") : "afwezig", !heeft("idp") || claims.idp === claims.iss);
  info("S1i", `\`email\` / \`xms_edov\` bij scopes "${SCOPES.join(" ")}"`, `email=${heeft("email") ? "aanwezig" : "afwezig"}, xms_edov=${heeft("xms_edov") ? String(claims.xms_edov) : "afwezig"}`);
  info("S1j", "alle claimnamen", Object.keys(claims).sort().join(", "));
}

async function azureIdentiteitVan(bearer) {
  const u = await api("/user", { bearer });
  return (u.json?.identities ?? []).find((i) => i.provider === "azure") ?? null;
}

// ── Hoofdmodus ───────────────────────────────────────────────────────────────
let userId = null, azureIdentityId = null, laatsteBearer = null, versie = "?";
async function hoofd() {
  const hookAanwezig = await pg.query("select to_regprocedure('public.spike_access_token_hook(jsonb)') is not null as ok");
  if (!hookAanwezig.rows[0].ok) throw new Error("spike_access_token_hook ontbreekt: draai scripts/spike/spike-hook.sql en zet de hook aan in config.toml");

  const nul = await tel();
  const { idToken, claims, nonce } = await haalIdToken();
  const B = { sub: String(claims.sub), tid: String(claims.tid), oid: String(claims.oid) };
  const A = { sub: `spike-andere-sub-${b64url(8)}`, tid: B.tid, oid: `00000000-0000-4000-8000-${b64url(6).replace(/[^a-z0-9]/gi, "0").slice(0, 12)}` };
  meetClaims(claims, nonce);

  // S2
  const s2 = await idTokenGrant(idToken, nonce);
  const s2tel = await tel();
  meet("S2", "id_token-grant zonder sessie, identiteit onbekend", "422 signup_disabled; tellingen ongewijzigd",
    `${s2.status} ${foutcode(s2)}; ${telTekst(s2tel)}`, s2.status === 422 && /signup_disabled/.test(foutcode(s2)) && s2tel.users === nul.users && s2tel.azure === nul.azure);

  // S3a — geen reservering
  const pw = await wachtwoordLogin();
  if (pw.status !== 200) throw new Error(`wachtwoordlogin faalde: ${pw.status} ${foutcode(pw)}`);
  userId = pw.json.user.id; laatsteBearer = pw.json.access_token;
  await wisBinding(userId);
  const s3a = await idTokenGrant(idToken, nonce, { link_identity: true }, pw.json.access_token);
  const s3atel = await tel();
  meet("S3a", "link_identity ZONDER reservering", "403 (hook); geen identiteit (transactie teruggerold)",
    `${s3a.status} ${foutcode(s3a)}; ${telTekst(s3atel)}`, s3a.status === 403 && s3atel.azure === nul.azure);

  // S3a' — pending voor identiteit A, link met token B
  await zetBinding(userId, "pending", A);
  const s3aa = await idTokenGrant(idToken, nonce, { link_identity: true }, pw.json.access_token);
  const s3aatel = await tel();
  const identNaA = await azureIdentiteitVan(pw.json.access_token);
  meet("S3a'", "pending voor identiteit A → link_identity met token B", "403 (hook: sub/tid/oid ≠ reservering); geen identiteit; volledige rollback",
    `${s3aa.status} ${foutcode(s3aa)}; identiteit=${identNaA ? "AANWEZIG" : "geen"}; ${telTekst(s3aatel)}`,
    s3aa.status === 403 && !identNaA && s3aatel.azure === nul.azure);

  // S3b — pending voor B → link
  await zetBinding(userId, "pending", B);
  const s3 = await idTokenGrant(idToken, nonce, { link_identity: true }, pw.json.access_token);
  if (s3.status === 200) laatsteBearer = s3.json.access_token;
  const ident = await azureIdentiteitVan(laatsteBearer);
  azureIdentityId = ident?.identity_id ?? ident?.id ?? null;
  const providerIdOk = Boolean(ident) && (ident.identity_data?.provider_id === B.sub || ident.identity_data?.sub === B.sub || ident.id === B.sub);
  const s3tel = await tel();
  meet("S3b", "link_identity MET pending-reservering voor B", "200; zelfde user.id; azure-identiteit provider_id = sub; users ongewijzigd, +1 identiteit",
    `${s3.status} ${s3.status === 200 ? "" : foutcode(s3)}; user gelijk=${s3.json?.user?.id === userId}; provider_id=sub: ${providerIdOk}; ${telTekst(s3tel)}`,
    s3.status === 200 && s3.json?.user?.id === userId && providerIdOk && s3tel.users === nul.users && s3tel.azure === nul.azure + 1);
  const cc = ident?.identity_data?.custom_claims ?? {};
  meet("S3c", "identity_data.custom_claims.tid/oid = tokenclaims (hook leunt hierop)", "beide gelijk",
    `tid=${cc.tid === B.tid ? "gelijk" : cc.tid === undefined ? "ONTBREEKT" : "ANDERS"}, oid=${cc.oid === B.oid ? "gelijk" : cc.oid === undefined ? "ONTBREEKT" : "ANDERS"}`,
    cc.tid === B.tid && cc.oid === B.oid);
  info("S3i", "identity_data-sleutels", ident ? `${Object.keys(ident.identity_data ?? {}).sort().join(", ")}; custom_claims: ${Object.keys(cc).sort().join(", ") || "(geen)"}` : "(geen identiteit)");
  await zetBinding(userId, "active", B);

  // S4
  await api("/logout", { method: "POST", bearer: laatsteBearer });
  const s4 = await idTokenGrant(idToken, nonce);
  const s4Access = s4.json?.access_token ?? null, s4Refresh = s4.json?.refresh_token ?? null;
  if (s4Access) laatsteBearer = s4Access;
  const amr = s4Access ? (decodeJwt(s4Access).amr ?? []).map((e) => (typeof e === "string" ? e : e.method)) : [];
  meet("S4", "id_token-grant bij active binding", "200; zelfde user.id; amr ∋ oauth",
    `${s4.status} ${s4.status === 200 ? "" : foutcode(s4)}; user gelijk=${s4.json?.user?.id === userId}; amr=${amr.join("+") || "(leeg)"}`,
    s4.status === 200 && s4.json?.user?.id === userId && amr.includes("oauth"));

  // S10e — basislijn oauth-sessie → REST
  const s10e = s4Access ? await rest(s4Access) : { status: 0 };
  meet("S10e", "basislijn: oauth-sessie met active binding → /rest/v1/profielen", "200", `${s10e.status}`, s10e.status === 200);

  // S10a — revoked → grant geweigerd
  await zetBinding(userId, "revoked", B);
  const s10a = await idTokenGrant(idToken, nonce);
  meet("S10a", "binding revoked → id_token-grant (identiteit bestaat)", "403 (hook), geen token",
    `${s10a.status} ${foutcode(s10a)}; token=${s10a.json?.access_token ? "JA" : "nee"}`, s10a.status === 403 && !s10a.json?.access_token);

  // S10b — bewaard token: REST tot exp; refresh geweigerd
  const s10bRest = s4Access ? await rest(s4Access) : { status: 0 };
  const expIn = s4Access ? decodeJwt(s4Access).exp - Math.floor(Date.now() / 1000) : 0;
  const s10bRefresh = s4Refresh ? await api("/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: s4Refresh } }) : { status: 0 };
  meet("S10b", "bewaard access-token na intrekking: directe REST + refresh", "REST 200 tot exp (venster ≤ jwt_expiry); refresh 403",
    `REST ${s10bRest.status} (exp over ${expIn}s); refresh ${s10bRefresh.status} ${s10bRefresh.status === 200 ? "TOKEN UITGEGEVEN" : foutcode(s10bRefresh)}`,
    s10bRest.status === 200 && s10bRefresh.status === 403);

  // S10c — wachtwoordlogin + refresh bij revoked
  const s10c = await wachtwoordLogin();
  const s10cRefresh = s10c.json?.refresh_token ? await api("/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: s10c.json.refresh_token } }) : { status: 0 };
  const pwBearer = s10cRefresh.json?.access_token ?? s10c.json?.access_token ?? null;
  if (pwBearer) laatsteBearer = pwBearer;
  meet("S10c", "wachtwoordlogin + refresh terwijl binding revoked", "beide 200 (hook raakt wachtwoord niet)", `login ${s10c.status}; refresh ${s10cRefresh.status}`, s10c.status === 200 && s10cRefresh.status === 200);

  // S10d — wachtwoordsessie → REST
  const s10d = pwBearer ? await rest(pwBearer) : { status: 0 };
  meet("S10d", "wachtwoordsessie → /rest/v1/profielen", "200", `${s10d.status}`, s10d.status === 200);

  // S5 — unlink → grant → signup_disabled
  await zetBinding(userId, "active", B);
  const s5del = azureIdentityId ? await api(`/user/identities/${azureIdentityId}`, { method: "DELETE", bearer: laatsteBearer }) : { status: 0 };
  if (s5del.status === 200) azureIdentityId = null;
  const s5 = await idTokenGrant(idToken, nonce);
  const s5tel = await tel();
  meet("S5", "unlink → id_token-grant", "unlink 200; daarna 422 signup_disabled; identiteiten op beginstand",
    `unlink ${s5del.status}; grant ${s5.status} ${foutcode(s5)}; ${telTekst(s5tel)}`, s5del.status === 200 && s5.status === 422 && /signup_disabled/.test(foutcode(s5)) && s5tel.azure === nul.azure);

  // S6 — hosted flow (handmatig afronden)
  const s6 = await api(`/authorize?provider=azure&redirect_to=${encodeURIComponent("http://localhost:3000/auth/callback")}`);
  const loc = s6.headers.get("location") ?? "";
  const naarSupabaseCallback = /redirect_uri=[^&]*auth%2Fv1%2Fcallback/i.test(loc);
  info("S6", "hosted flow `/authorize?provider=azure` (HANDMATIG in browser afronden)", `${s6.status}; redirect_uri→<supabase>/auth/v1/callback=${naarSupabaseCallback}. Open de URL uit stderr in de browser; verwacht AADSTS50011 en geen nieuwe rijen`);
  process.stderr.write(`\nS6 handmatig: open in de browser →\n${SUPABASE_URL}/auth/v1/authorize?provider=azure&redirect_to=${encodeURIComponent("http://localhost:3000/auth/callback")}\nverwacht: Entra-foutpagina AADSTS50011; controleer daarna auth.users/auth.identities.\n\n`);

  const eind = await tel();
  meet("S0", "tellingen begin → eind", "gelijk", `${telTekst(nul)} → ${telTekst(eind)}`, eind.users === nul.users && eind.azure === nul.azure);
}

// ── S7-modus (negatieve test; hook UIT) ──────────────────────────────────────
async function s7() {
  const nul = await tel();
  const pw = await wachtwoordLogin();
  if (pw.status !== 200) throw new Error(`wachtwoordlogin faalde: ${pw.status} ${foutcode(pw)}`);
  userId = pw.json.user.id;
  await api("/logout", { method: "POST", bearer: pw.json.access_token });
  const { idToken, claims, nonce } = await haalIdToken();
  meetClaims(claims, nonce);
  info("S7-0", "modus", `hook moet UIT staan; scopes "${SCOPES.join(" ")}"; tweede account met e-mail gelijk aan het testaccount; verwacht: ${S7_VERWACHT}`);
  const s7a = await idTokenGrant(idToken, nonce);
  const na = await tel();
  const rij = await pg.query("select user_id, id from auth.identities where provider = 'azure' and provider_id = $1", [String(claims.sub)]);
  const gekoppeldAanTest = rij.rows[0]?.user_id === userId;
  azureIdentityId = rij.rows[0]?.id ?? null;
  const autoLink = s7a.status === 200 && gekoppeldAanTest && na.users === nul.users;
  const geweigerd = s7a.status === 422 && /signup_disabled/.test(foutcode(s7a)) && na.users === nul.users && na.azure === nul.azure;
  info("S7a", "id_token-grant zonder sessie met tweede account (zelfde e-mail)",
    `${s7a.status} ${s7a.status === 200 ? "SESSIE UITGEGEVEN" : foutcode(s7a)}; identiteit aan testaccount=${gekoppeldAanTest}; ${telTekst(nul)} → ${telTekst(na)}`);
  const uitkomst = autoLink ? "auto_link" : geweigerd ? "signup_disabled" : "onverwacht";
  meet("S7b", "uitkomst versus verwachting", `verwacht ${S7_VERWACHT} (zonder linking domain + email: auto_link = R-28 bewezen voor de id-token-ingang; met linking domain of zonder email: signup_disabled)`,
    uitkomst === "auto_link" ? "automatische koppeling opgetreden" : uitkomst === "signup_disabled" ? "signup_disabled — geen koppeling" : "onverwacht resultaat", uitkomst === S7_VERWACHT);
  if (s7a.json?.access_token) laatsteBearer = s7a.json.access_token;
}

async function main() {
  await pg.connect();
  const health = await api("/health");
  versie = String(health.json?.version ?? "?").replace(/^v/, "");
  const [maj, min] = versie.split(".").map(Number);
  meet("S8", "Auth-versie (`/auth/v1/health`)", "≥ 2.185.0", `v${versie}`, maj > 2 || (maj === 2 && min >= 185));
  if (MODE === "s7") await s7(); else await hoofd();
  process.stdout.write([
    `# Spike T0.5 — #335 Microsoft-login (route B, hookprototype) — modus ${MODE}`,
    ``,
    `- Datum: ${new Date().toISOString().slice(0, 10)}`,
    `- Supabase: ${SUPABASE_URL} (lokale CLI-stack); Auth v${versie}`,
    `- Scopes: \`${SCOPES.join(" ")}\`; redirect-URI: \`${REDIRECT_URI}\``,
    `- Geen tokens, codes, nonces of e-mailadressen in deze uitvoer.`,
    ``,
    `| # | Meting | Verwacht | Gemeten | |`,
    `|---|---|---|---|---|`,
    ...regels,
    ``,
    `S6 (browser) en S9 (hosted platform, zie management-auth-config.mjs) zijn handmatig; zie ontwerp §9.1.`,
    ``,
    rood === 0 ? `**Resultaat: alle harde metingen groen.**` : `**Resultaat: ${rood} harde meting(en) ROOD — spike niet geslaagd.**`,
    ``,
  ].join("\n"));
  if (rood > 0) process.exitCode = 1;
}

main()
  .catch((e) => { process.stderr.write(`SPIKE MISLUKT: ${e.message}\n`); process.exitCode = 1; })
  .finally(async () => {
    try { server?.close(); } catch { /* al dicht */ }
    try {
      if (azureIdentityId) {
        let opgeruimd = false;
        if (laatsteBearer) {
          const r = await api(`/user/identities/${azureIdentityId}`, { method: "DELETE", bearer: laatsteBearer }).catch(() => ({ status: 0 }));
          opgeruimd = r.status === 200;
        }
        if (!opgeruimd) {
          // Spike-only: directe opruiming op de lokale wegwerpstack.
          await pg.query("delete from auth.identities where id = $1 and provider = 'azure'", [azureIdentityId]).catch(() => undefined);
        }
        process.stderr.write(`cleanup: azure-identiteit verwijderd\n`);
      }
      if (userId) await wisBinding(userId).catch(() => undefined);
    } finally {
      await pg.end().catch(() => undefined);
    }
  });
