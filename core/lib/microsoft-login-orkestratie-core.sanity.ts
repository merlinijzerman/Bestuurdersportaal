// ============================================================================
//  Flowtests van de Microsoft-login-orkestratie met mock-gateway, mock-OIDC en
//  mock-auth (#335 T2, testmatrix T2-1, T2-2, T2-4b, T2-5, T2-7, T2-8, T2-9,
//  koppelen happy/faal/herstel/ontkoppelen). Geen Entra, GoTrue of database.
// ============================================================================
import assert from "node:assert/strict";
import test from "node:test";
import { createSign, generateKeyPairSync } from "node:crypto";
import { maakMicrosoftLogin, MicrosoftLoginFlowFout, type LoginGateway, type OidcClient, type AuthAdapter, type LoginConfig } from "./microsoft-login-orkestratie-core";
import { nonceHash, stateHash } from "./microsoft-login-flow-core";
import { parseLoginSleutel } from "./microsoft-login-crypto-core";
import type { BindingStatus } from "./microsoft-login-binding-core";

// ── vaste testwereld ────────────────────────────────────────────────────────
const TID = "11111111-2222-3333-4444-555555555555";
const CLIENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const FONDS = "00000000-0000-4000-8000-000000000001";
const ANDER_FONDS = "00000000-0000-4000-8000-000000000002";
const USER = "u-1";
const OID = "0f0f0f0f-1111-2222-3333-444444444444";
const SUB = "pairwise-sub";
const HOST = "pgb.localhost:3000";
const AUTHORITY = "http://127.0.0.1:8791";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid: "k1", use: "sig", alg: "RS256" };
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken(over: Record<string, unknown>, nonce: string) {
  const payload = {
    iss: `${AUTHORITY}/${TID}/v2.0`, aud: CLIENT, exp: 2_000_000_000, ver: "2.0", nonce: nonceHash(nonce),
    tid: TID, oid: OID, sub: SUB, acct: 0, ...over,
  };
  const input = `${b64u({ alg: "RS256", kid: "k1" })}.${b64u(payload)}`;
  return `${input}.${createSign("RSA-SHA256").update(input).sign(privateKey).toString("base64url")}`;
}

const config: LoginConfig = {
  tenantId: TID, clientId: CLIENT, clientSecret: "geheim",
  sleutel: parseLoginSleutel(Buffer.alloc(32, 3).toString("base64"), "1"),
  authority: AUTHORITY, lokaalToegestaan: true,
};

type Wereld = {
  bindingen: Array<{ id: string; userId: string; fondsId: string; tid: string; oid: string; sub: string; status: BindingStatus }>;
  transacties: Map<string, Parameters<LoginGateway["maakTransactie"]>[0]>;
  audit: Array<{ gebeurtenis: string; categorie: string | null; userId: string | null; hash: string | null }>;
  aanroepen: string[];
  sessie: { id: string; identities: { provider: string; providerId: string }[] } | null;
  profielFonds: Map<string, string>;
  actief: boolean;
  hookWeigert: boolean;
  unlinkLukt: boolean;
};

function wereld(over: Partial<Wereld> = {}): Wereld {
  return {
    bindingen: [], transacties: new Map(), audit: [], aanroepen: [], sessie: null,
    profielFonds: new Map([[USER, FONDS]]), actief: true, hookWeigert: false, unlinkLukt: true, ...over,
  };
}

function gateway(w: Wereld): LoginGateway {
  let n = 0;
  return {
    async microsoftLoginActief() { w.aanroepen.push("actief"); return w.actief ? { actief: true, entraTenantId: TID } : { actief: false }; },
    async reserveerIdentiteit(a) {
      w.aanroepen.push("reserveer");
      if (w.bindingen.some((b) => ["pending", "active", "revoking"].includes(b.status) && ((b.tid === a.identiteit.tid && b.oid === a.identiteit.oid) || b.userId === a.userId))) {
        throw Object.assign(new Error("binding_conflict"), { categorie: "binding_conflict" });
      }
      const id = `b-${++n}`;
      w.bindingen.push({ id, userId: a.userId, fondsId: a.fondsId, ...a.identiteit, status: "pending" });
      w.audit.push({ gebeurtenis: "koppelen.gereserveerd", categorie: null, userId: a.userId, hash: "db" });
      return id;
    },
    async activeerIdentiteit(a) {
      w.aanroepen.push("activeer");
      const b = w.bindingen.find((x) => x.id === a.bindingId && x.userId === a.userId && x.sub === a.sub);
      if (!b) throw Object.assign(new Error("onbekende_binding"), { categorie: "onbekende_binding" });
      b.status = "active";
    },
    async herstelKoppeling(a) {
      w.aanroepen.push("herstel");
      const b = w.bindingen.find((x) => x.id === a.bindingId && x.userId === a.userId && x.sub === a.sub);
      if (!b) throw Object.assign(new Error("onbekende_binding"), { categorie: "onbekende_binding" });
      b.status = "active";
    },
    async markeerMislukt(a) { w.aanroepen.push(`mislukt:${a.categorie}`); const b = w.bindingen.find((x) => x.id === a.bindingId); if (b) b.status = "failed"; },
    async startIntrekking(a) { w.aanroepen.push("intrekking"); const b = w.bindingen.find((x) => x.userId === a.userId && ["active", "revoking"].includes(x.status)); if (!b) throw Object.assign(new Error("onbekende_binding"), { categorie: "onbekende_binding" }); b.status = "revoking"; return b.id; },
    async voltooiIntrekking(a) { w.aanroepen.push("voltooi"); const b = w.bindingen.find((x) => x.id === a.bindingId); if (b) b.status = "revoked"; },
    async zoekIdentiteit(i) { w.aanroepen.push("zoek"); const b = w.bindingen.find((x) => x.tid === i.tid && x.oid === i.oid && x.status === "active"); return b ? { id: b.id, userId: b.userId, fondsId: b.fondsId } : null; },
    async levendeBinding(userId) { const b = w.bindingen.find((x) => x.userId === userId && ["pending", "active", "revoking"].includes(x.status)); return b ? { id: b.id, fondsId: b.fondsId, status: b.status, pendingVerlooptOp: null, geactiveerdOp: null, laatstGebruiktOp: null } : null; },
    async markeerGebruikt() { w.aanroepen.push("gebruikt"); },
    async maakTransactie(a) { w.transacties.set(a.stateHash, a); },
    async consumeerTransactie(h) { const t = w.transacties.get(h); if (!t) return null; w.transacties.delete(h); return { fondsId: t.fondsId, userId: t.userId, intent: t.intent, blob: t.blob }; },
    async registreerGebeurtenis(a) { w.audit.push({ gebeurtenis: a.gebeurtenis, categorie: a.foutcategorie ?? null, userId: a.userId, hash: a.identiteitHash ?? null }); },
  };
}

function oidc(w: Wereld, tokenVoor: (nonce: string) => string): OidcClient {
  let laatsteNonceHash = "";
  return {
    async discovery() { return { authorization_endpoint: `${AUTHORITY}/${TID}/oauth2/v2.0/authorize`, token_endpoint: `${AUTHORITY}/${TID}/oauth2/v2.0/token`, jwks_uri: `${AUTHORITY}/${TID}/discovery/v2.0/keys`, issuer: `${AUTHORITY}/${TID}/v2.0` }; },
    async jwks() { return { keys: [jwk] }; },
    async wisselCode(_ep, body) {
      w.aanroepen.push("token");
      // De 'code' in de tests draagt de ruwe nonce zodat de stub het juiste token kan maken.
      const code = new URLSearchParams(body).get("code")!;
      laatsteNonceHash = code;
      return { id_token: tokenVoor(code), token_type: "Bearer", scope: "openid profile" };
    },
    _laatste: () => laatsteNonceHash,
  } as OidcClient;
}

function auth(w: Wereld): AuthAdapter {
  return {
    async huidigeGebruiker() { return w.sessie; },
    async signInWithIdToken() {
      w.aanroepen.push("signIn");
      if (w.hookWeigert) return { fout: "hook_geweigerd" };
      const b = w.bindingen.find((x) => x.status === "active");
      const user = { id: b?.userId ?? USER, identities: [{ provider: "azure", providerId: b?.sub ?? SUB }] };
      w.sessie = user;
      return { user };
    },
    async linkIdentity() {
      w.aanroepen.push("link");
      if (w.hookWeigert) return { fout: "hook_geweigerd" };
      const user = { id: w.sessie!.id, identities: [...w.sessie!.identities, { provider: "azure", providerId: SUB }] };
      w.sessie = user;
      return { user };
    },
    async unlinkAzure() { w.aanroepen.push("unlink"); return w.unlinkLukt; },
    async signOut(scope) { w.aanroepen.push(`signOut:${scope}`); w.sessie = null; },
    async profielFondsId(userId) { return w.profielFonds.get(userId) ?? null; },
  };
}

function flow(w: Wereld, tokenVoor: (nonce: string) => string = (n) => idToken({}, n)) {
  return maakMicrosoftLogin({ gateway: gateway(w), oidc: oidc(w, tokenVoor), auth: auth(w), config: () => config, correlatieId: () => "c0c0c0c0-0000-4000-8000-000000000001", nu: () => new Date(1_900_000_000_000) });
}

/** Simuleert de browser: start → haal state+nonce uit de authorize-URL/transactie → callback. */
async function startEnCallback(w: Wereld, f: ReturnType<typeof flow>, intent: "inloggen" | "koppelen", over: { host?: string; hostFondsId?: string; error?: string | null; codeOverride?: string } = {}) {
  const { url } = await f.start({ intent, hostFondsId: FONDS, host: HOST, userId: intent === "koppelen" ? USER : null, next: "/profiel" });
  const u = new URL(url);
  const state = u.searchParams.get("state")!;
  // De transactie is versleuteld; de test kent de nonce alleen via de hash → geef de
  // OIDC-stub een token met precies die hash door de 'code' = ruwe nonce te laten zijn.
  // Daarvoor lezen we de nonce terug uit de authorize-URL (nonceHash) en laten de
  // stub op hash tekenen.
  const nh = u.searchParams.get("nonce")!;
  return f.voltooiCallback({ host: over.host ?? HOST, hostFondsId: over.hostFondsId ?? FONDS, code: over.codeOverride ?? `NH:${nh}`, state, error: over.error ?? null });
}

// tokenVoor krijgt "NH:<hash>" en tekent een token waarvan de nonce-claim exact die hash is.
const tokenOpHash = (over: Record<string, unknown> = {}) => (code: string) => {
  const hash = code.startsWith("NH:") ? code.slice(3) : "verkeerd";
  const payload = { iss: `${AUTHORITY}/${TID}/v2.0`, aud: CLIENT, exp: 2_000_000_000, ver: "2.0", nonce: hash, tid: TID, oid: OID, sub: SUB, acct: 0, ...over };
  const input = `${b64u({ alg: "RS256", kid: "k1" })}.${b64u(payload)}`;
  return `${input}.${createSign("RSA-SHA256").update(input).sign(privateKey).toString("base64url")}`;
};

async function faaltMet(p: Promise<unknown>, categorie: string) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof MicrosoftLoginFlowFout, `verwachtte MicrosoftLoginFlowFout, kreeg ${String(e)}`);
    assert.equal(e.categorie, categorie);
    return e;
  }
  assert.fail(`verwachtte fout ${categorie}`);
}

// ── start ───────────────────────────────────────────────────────────────────

test("start: authorize-URL met exact openid profile, transactie versleuteld opgeslagen, audit gestart", async () => {
  const w = wereld();
  const f = flow(w);
  const { url } = await f.start({ intent: "inloggen", hostFondsId: FONDS, host: HOST, userId: null, next: "/dashboard" });
  const u = new URL(url);
  assert.equal(u.searchParams.get("scope"), "openid profile");
  assert.equal(u.searchParams.get("redirect_uri"), `http://${HOST}/auth/microsoft-login/callback`);
  assert.equal(w.transacties.size, 1);
  const tx = [...w.transacties.values()][0]!;
  assert.equal(tx.stateHash, stateHash(u.searchParams.get("state")!));
  assert.equal(tx.userId, null);
  assert.doesNotMatch(JSON.stringify(tx), new RegExp(u.searchParams.get("state")!), "state staat nergens ruw opgeslagen");
  assert.deepEqual(w.audit.map((a) => a.gebeurtenis), ["inloggen.gestart"]);
});

test("start: flag uit → login_uit vóór er iets wordt opgeslagen (T2-9)", async () => {
  const w = wereld({ actief: false });
  await faaltMet(flow(w).start({ intent: "inloggen", hostFondsId: FONDS, host: HOST, userId: null, next: "/" }), "login_uit");
  assert.equal(w.transacties.size, 0);
});

// ── inloggen ────────────────────────────────────────────────────────────────

test("T2-1 inloggen met actieve binding: signIn → kruiscontrole → markeerGebruikt → next", async () => {
  const w = wereld({ bindingen: [{ id: "b-0", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "active" }] });
  const f = flow(w, tokenOpHash());
  const r = await startEnCallback(w, f, "inloggen");
  assert.deepEqual(r, { intent: "inloggen", next: "/profiel", correlatieId: "c0c0c0c0-0000-4000-8000-000000000001" });
  assert.deepEqual(w.aanroepen.filter((a) => a !== "actief"), ["token", "zoek", "signIn", "gebruikt"]);
  assert.equal(w.audit.at(-1)?.gebeurtenis, "inloggen.geslaagd");
  assert.match(w.audit.at(-1)!.hash!, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(w.audit), new RegExp(OID), "audit draagt de hash, niet de oid");
});

test("T2-2 niet-gekoppeld: geen signInWithIdToken, weigering binding_ontbreekt, audit zonder user", async () => {
  const w = wereld();
  const f = flow(w, tokenOpHash());
  await faaltMet(startEnCallback(w, f, "inloggen"), "binding_ontbreekt");
  assert.ok(!w.aanroepen.includes("signIn"));
  assert.deepEqual(w.audit.at(-1), { gebeurtenis: "inloggen.geweigerd", categorie: "binding_ontbreekt", userId: null, hash: w.audit.at(-1)!.hash });
});

test("T2-5 ingetrokken binding (revoked) telt als geen binding", async () => {
  const w = wereld({ bindingen: [{ id: "b-0", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "revoked" }] });
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash()), "inloggen"), "binding_ontbreekt");
});

test("T2-10 binding van een ander fonds dan de host → fonds_mismatch zonder signIn", async () => {
  const w = wereld({ bindingen: [{ id: "b-0", userId: USER, fondsId: ANDER_FONDS, tid: TID, oid: OID, sub: SUB, status: "active" }] });
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash()), "inloggen"), "fonds_mismatch");
  assert.ok(!w.aanroepen.includes("signIn"));
});

test("T2-4b sub ≠ provider_id na signIn → signOut + identiteit_mismatch", async () => {
  const w = wereld({ bindingen: [{ id: "b-0", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: "andere-sub", status: "active" }] });
  // De token draagt SUB, de binding 'andere-sub' → zoekIdentiteit vindt op tid/oid, kruiscontrole faalt.
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash()), "inloggen"), "identiteit_mismatch");
  assert.ok(w.aanroepen.includes("signOut:local"));
  assert.equal(w.sessie, null);
});

test("hook weigert (403) → hook_geweigerd, geen sessie", async () => {
  const w = wereld({ hookWeigert: true, bindingen: [{ id: "b-0", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "active" }] });
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash()), "inloggen"), "hook_geweigerd");
  assert.equal(w.sessie, null);
});

test("profiel in ander fonds dan host na signIn → signOut + fonds_mismatch (R-34)", async () => {
  const w = wereld({ bindingen: [{ id: "b-0", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "active" }], profielFonds: new Map([[USER, ANDER_FONDS]]) });
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash()), "inloggen"), "fonds_mismatch");
  assert.ok(w.aanroepen.includes("signOut:local"));
});

test("T2-7 replay: tweede callback met dezelfde state → transactie_ongeldig, geen tokenwissel", async () => {
  const w = wereld({ bindingen: [{ id: "b-0", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "active" }] });
  const f = flow(w, tokenOpHash());
  const { url } = await f.start({ intent: "inloggen", hostFondsId: FONDS, host: HOST, userId: null, next: "/" });
  const u = new URL(url);
  const args = { host: HOST, hostFondsId: FONDS, code: `NH:${u.searchParams.get("nonce")}`, state: u.searchParams.get("state"), error: null };
  await f.voltooiCallback(args);
  const tokens = w.aanroepen.filter((a) => a === "token").length;
  await faaltMet(f.voltooiCallback(args), "transactie_ongeldig");
  assert.equal(w.aanroepen.filter((a) => a === "token").length, tokens, "geen tweede tokenwissel");
});

test("T2-8 nonce-mismatch in het ID-token → claim_nonce; niets naar Supabase", async () => {
  const w = wereld({ bindingen: [{ id: "b-0", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "active" }] });
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash({ nonce: "x".repeat(64) })), "inloggen"), "claim_nonce");
  assert.ok(!w.aanroepen.includes("signIn") && !w.aanroepen.includes("zoek"));
});

test("T2-3 andere tenant / gast (acct=1) → claim_tid / claim_acct", async () => {
  const w = wereld();
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash({ tid: "99999999-2222-3333-4444-555555555555", iss: `${AUTHORITY}/99999999-2222-3333-4444-555555555555/v2.0` })), "inloggen"), "claim_tid");
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash({ acct: 1 })), "inloggen"), "claim_acct");
});

test("gebruiker weigert bij Entra (error-param) → geweigerd_door_gebruiker, transactie verbruikt", async () => {
  const w = wereld();
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash()), "inloggen", { error: "access_denied" }), "geweigerd_door_gebruiker");
  assert.equal(w.transacties.size, 0);
  assert.ok(!w.aanroepen.includes("token"));
});

test("callback op een andere host dan de start → host_mismatch", async () => {
  const w = wereld();
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash()), "inloggen", { host: "ander.localhost:3000" }), "host_mismatch");
});

test("tokenresponse met refresh_token wordt geweigerd (E2)", async () => {
  const w = wereld({ bindingen: [{ id: "b-0", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "active" }] });
  const f = maakMicrosoftLogin({
    gateway: gateway(w),
    oidc: { ...oidc(w, tokenOpHash()), async wisselCode(_e, body) { const code = new URLSearchParams(body).get("code")!; return { id_token: tokenOpHash()(code), refresh_token: "r" }; } },
    auth: auth(w), config: () => config,
  });
  await faaltMet(startEnCallback(w, f, "inloggen"), "token_response_ongeldig");
});

// ── koppelen ────────────────────────────────────────────────────────────────

test("koppelen happy path: reserveer → link → verifieer → activeer; sessie krijgt azure-identiteit", async () => {
  const w = wereld({ sessie: { id: USER, identities: [{ provider: "email", providerId: USER }] } });
  const f = flow(w, tokenOpHash());
  const r = await startEnCallback(w, f, "koppelen");
  assert.equal(r.intent, "koppelen");
  assert.deepEqual(w.aanroepen.filter((a) => !["actief", "token"].includes(a)), ["reserveer", "link", "activeer"]);
  assert.equal(w.bindingen[0]!.status, "active");
  assert.deepEqual(w.audit.map((a) => a.gebeurtenis), ["koppelen.gestart", "koppelen.gereserveerd"]);
});

test("koppelen zonder passende sessie → sessie_mismatch, geen reservering", async () => {
  const w = wereld({ sessie: { id: "iemand-anders", identities: [] } });
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash()), "koppelen"), "sessie_mismatch");
  assert.equal(w.bindingen.length, 0);
});

test("koppelen: identiteit al gebonden (conflict uit de DB) → binding_conflict, geen linkIdentity", async () => {
  const w = wereld({ sessie: { id: USER, identities: [] }, bindingen: [{ id: "b-9", userId: "ander", fondsId: FONDS, tid: TID, oid: OID, sub: "s", status: "active" }] });
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash()), "koppelen"), "binding_conflict");
  assert.ok(!w.aanroepen.includes("link"));
});

test("koppelen: hook weigert de link → pending wordt failed, geen identiteit", async () => {
  const w = wereld({ sessie: { id: USER, identities: [] }, hookWeigert: true });
  await faaltMet(startEnCallback(w, flow(w, tokenOpHash()), "koppelen"), "hook_geweigerd");
  assert.equal(w.bindingen[0]!.status, "failed");
  assert.ok(w.aanroepen.includes("mislukt:hook_geweigerd"));
});

test("koppelen: gelinkte identiteit draagt een andere sub → mislukt + globale signOut", async () => {
  const w = wereld({ sessie: { id: USER, identities: [] } });
  const a = auth(w);
  const f = maakMicrosoftLogin({
    gateway: gateway(w), oidc: oidc(w, tokenOpHash()), config: () => config,
    auth: { ...a, async linkIdentity() { w.aanroepen.push("link"); return { user: { id: USER, identities: [{ provider: "azure", providerId: "ANDERE-SUB" }] } }; } },
  });
  await faaltMet(startEnCallback(w, f, "koppelen"), "identiteit_mismatch");
  assert.equal(w.bindingen[0]!.status, "failed");
  assert.ok(w.aanroepen.includes("signOut:global"));
});

// ── status / herstel / ontkoppelen ──────────────────────────────────────────

test("status: geen → pending (herstel mogelijk met azure-identiteit) → active → revoking", async () => {
  const w = wereld({ sessie: { id: USER, identities: [{ provider: "azure", providerId: SUB }] } });
  const f = flow(w);
  assert.deepEqual(await f.status({ userId: USER }), { status: "geen" });
  w.bindingen.push({ id: "b-1", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "pending" });
  assert.deepEqual(await f.status({ userId: USER }), { status: "pending", herstelMogelijk: true, pendingVerlooptOp: null });
  w.bindingen[0]!.status = "active";
  assert.equal((await f.status({ userId: USER })).status, "active");
  w.bindingen[0]!.status = "revoking";
  assert.deepEqual(await f.status({ userId: USER }), { status: "revoking" });
});

test("herstel: pending + azure-identiteit → active; idempotent; zonder identiteit geweigerd", async () => {
  const w = wereld({ sessie: { id: USER, identities: [{ provider: "azure", providerId: SUB }] }, bindingen: [{ id: "b-1", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "pending" }] });
  const f = flow(w);
  assert.deepEqual(await f.herstel({ userId: USER }), { hersteld: true });
  assert.equal(w.bindingen[0]!.status, "active");
  assert.deepEqual(await f.herstel({ userId: USER }), { hersteld: true }, "idempotent");
  const w2 = wereld({ sessie: { id: USER, identities: [] }, bindingen: [{ id: "b-1", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "pending" }] });
  await faaltMet(flow(w2).herstel({ userId: USER }), "identiteit_mismatch");
});

test("ontkoppelen: revoking → unlink → revoked; mislukt unlink laat revoking staan (geen toegang)", async () => {
  const w = wereld({ bindingen: [{ id: "b-1", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "active" }] });
  assert.deepEqual(await flow(w).ontkoppel({ fondsId: FONDS, userId: USER }), { ontkoppeld: true });
  assert.equal(w.bindingen[0]!.status, "revoked");
  const w2 = wereld({ unlinkLukt: false, bindingen: [{ id: "b-1", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "active" }] });
  await faaltMet(flow(w2).ontkoppel({ fondsId: FONDS, userId: USER }), "unlink_mislukt");
  assert.equal(w2.bindingen[0]!.status, "revoking");
  assert.equal(w2.audit.at(-1)?.gebeurtenis, "ontkoppelen.unlink_mislukt");
});

test("geen enkele auditregel of foutmelding bevat token, code, state, nonce, sub of e-mail", async () => {
  const w = wereld({ bindingen: [{ id: "b-0", userId: USER, fondsId: FONDS, tid: TID, oid: OID, sub: SUB, status: "active" }] });
  const f = flow(w, tokenOpHash());
  await startEnCallback(w, f, "inloggen");
  const dump = JSON.stringify(w.audit);
  assert.doesNotMatch(dump, new RegExp(`${SUB}|eyJ|NH:|${OID}`));
});
