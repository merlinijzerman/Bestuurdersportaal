import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  callbackUrlVoorHost,
  codeChallenge,
  maakFlowGeheimen,
  MICROSOFT_LOGIN_CALLBACK_PAD,
  nonceHash,
  origineVoorHost,
  parseTransactieGeheim,
  serialiseerTransactieGeheim,
  stateHash,
  TRANSACTIE_GELDIGHEID_MS,
} from "./microsoft-login-flow-core";
import { loginAad, ontsleutelLoginGeheim, parseLoginSleutel, versleutelLoginGeheim } from "./microsoft-login-crypto-core";

test("flowgeheimen: drie onafhankelijke base64url-waarden, state 32 bytes, verifier 64 bytes", () => {
  const g = maakFlowGeheimen();
  assert.match(g.state, /^[A-Za-z0-9_-]{43}$/);
  assert.match(g.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.match(g.verifier, /^[A-Za-z0-9_-]{86}$/);
  assert.notEqual(g.state, g.nonce);
  assert.notEqual(maakFlowGeheimen().state, g.state);
});

test("hashes: state en nonce sha256-hex; PKCE-challenge base64url(sha256(verifier))", () => {
  assert.equal(stateHash("s"), createHash("sha256").update("s").digest("hex"));
  assert.equal(nonceHash("n"), createHash("sha256").update("n").digest("hex"));
  assert.equal(codeChallenge("v"), createHash("sha256").update("v").digest("base64url"));
  assert.equal(TRANSACTIE_GELDIGHEID_MS, 600_000);
});

const geheim = {
  nonce: "n".repeat(43),
  verifier: "v".repeat(86),
  next: "/profiel",
  host: "pgb.preview.bestuurdersportaal.com",
  redirectUri: "https://pgb.preview.bestuurdersportaal.com/auth/microsoft-login/callback",
};

test("transactiegeheim: rondreis en strikte vormcontrole", () => {
  assert.deepEqual(parseTransactieGeheim(serialiseerTransactieGeheim(geheim)), geheim);
  for (const [naam, kapot] of [
    ["geen JSON", "{"],
    ["nonce te kort", JSON.stringify({ ...geheim, nonce: "kort" })],
    ["next protocol-relatief", JSON.stringify({ ...geheim, next: "//evil.example" })],
    ["next absoluut", JSON.stringify({ ...geheim, next: "https://evil.example" })],
    ["host met slash", JSON.stringify({ ...geheim, host: "a/b" })],
    ["host met @", JSON.stringify({ ...geheim, host: "x@evil.example" })],
    ["redirectUri met query", JSON.stringify({ ...geheim, redirectUri: `${geheim.redirectUri}?x=1` })],
    ["redirectUri met credentials", JSON.stringify({ ...geheim, redirectUri: "https://u:p@h/auth/microsoft-login/callback" })],
    ["array", "[]"],
  ] as const) {
    assert.equal(parseTransactieGeheim(kapot), null, naam);
  }
});

test("origin: uit de geverifieerde host; https, lokaal alleen http mét toestemming", () => {
  assert.equal(origineVoorHost("pgb.preview.bestuurdersportaal.com", { lokaalToegestaan: true }), "https://pgb.preview.bestuurdersportaal.com");
  assert.equal(origineVoorHost("fonds-a.localhost:3000", { lokaalToegestaan: true }), "http://fonds-a.localhost:3000");
  assert.equal(origineVoorHost("fonds-a.localhost:3000", { lokaalToegestaan: false }), "https://fonds-a.localhost:3000");
});

test("callback-URL: vast pad, https, lokaal alleen http mét toestemming", () => {
  assert.equal(MICROSOFT_LOGIN_CALLBACK_PAD, "/auth/microsoft-login/callback");
  assert.equal(callbackUrlVoorHost("pgb.preview.bestuurdersportaal.com", { lokaalToegestaan: false }), "https://pgb.preview.bestuurdersportaal.com/auth/microsoft-login/callback");
  assert.equal(callbackUrlVoorHost("fonds-a.localhost:3000", { lokaalToegestaan: true }), "http://fonds-a.localhost:3000/auth/microsoft-login/callback");
  assert.equal(callbackUrlVoorHost("fonds-a.localhost:3000", { lokaalToegestaan: false }), "https://fonds-a.localhost:3000/auth/microsoft-login/callback");
  assert.equal(callbackUrlVoorHost("pgb.preview.bestuurdersportaal.com", { lokaalToegestaan: true }), "https://pgb.preview.bestuurdersportaal.com/auth/microsoft-login/callback", "een echte host blijft https, ook lokaal");
});

// ── crypto ──────────────────────────────────────────────────────────────────
const sleutel = parseLoginSleutel(Buffer.alloc(32, 7).toString("base64"), "1");

test("sleutel: 32 bytes base64 + versie ≥ 1; anders gooien", () => {
  assert.equal(sleutel.versie, 1);
  assert.throws(() => parseLoginSleutel(undefined, "1"), /niet geconfigureerd/);
  assert.throws(() => parseLoginSleutel(Buffer.alloc(16).toString("base64"), "1"), /AES-256/);
  assert.throws(() => parseLoginSleutel(Buffer.alloc(32).toString("base64"), "0"), /niet geconfigureerd/);
});

test("AES-GCM: rondreis; AAD bindt fonds/user/intent; tamper en andere versie falen", () => {
  const aad = loginAad({ fondsId: "f", userId: "u", intent: "koppelen" });
  assert.equal(aad, "m365login:v1:f:u:koppelen");
  assert.equal(loginAad({ fondsId: "f", userId: null, intent: "inloggen" }), "m365login:v1:f:-:inloggen");
  const blob = versleutelLoginGeheim("geheim", aad, sleutel);
  assert.equal(ontsleutelLoginGeheim(blob, aad, sleutel), "geheim");
  assert.throws(() => ontsleutelLoginGeheim(blob, loginAad({ fondsId: "f", userId: "ander", intent: "koppelen" }), sleutel), /niet veilig/);
  assert.throws(() => ontsleutelLoginGeheim({ ...blob, ciphertext: Buffer.from("xx").toString("base64") }, aad, sleutel), /niet veilig/);
  assert.throws(() => ontsleutelLoginGeheim({ ...blob, sleutelVersie: 2 }, aad, sleutel), /sleutelversie/);
  assert.notEqual(versleutelLoginGeheim("geheim", aad, sleutel).iv, blob.iv, "verse IV per versleuteling");
});
