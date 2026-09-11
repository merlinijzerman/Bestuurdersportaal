import assert from "node:assert/strict";
import test from "node:test";
import { MSA_TENANT_ID, valideerIdToken } from "./microsoft-login-identity-core";

const tenantId = "11111111-2222-3333-4444-555555555555";
const clientId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const nonceHash = "b".repeat(64);
const nu = 1_800_000_000;
const verwacht = { tenantId, clientId, nonceHash, nuSeconden: nu };

const geldig: Record<string, unknown> = {
  iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
  aud: clientId,
  exp: nu + 300,
  ver: "2.0",
  nonce: nonceHash,
  tid: tenantId,
  oid: "0f0f0f0f-1111-2222-3333-444444444444",
  sub: "pairwise-sub-waarde",
  acct: 0,
};

test("ID-token: volledig contract → ok met rauwe tid/oid/sub", () => {
  const r = valideerIdToken(geldig, verwacht);
  assert.deepEqual(r, { ok: true, identiteit: { tid: tenantId, oid: geldig.oid, sub: geldig.sub } });
});

test("ID-token: acct als string '0' en idp gelijk aan iss zijn toegestaan", () => {
  assert.equal(valideerIdToken({ ...geldig, acct: "0", idp: geldig.iss }, verwacht).ok, true);
});

for (const [naam, claims, categorie] of [
  ["andere tenant", { ...geldig, tid: "99999999-2222-3333-4444-555555555555" }, "claim_tid"],
  ["MSA-tenant", { ...geldig, tid: MSA_TENANT_ID, iss: `https://login.microsoftonline.com/${MSA_TENANT_ID}/v2.0` }, "claim_tid"],
  ["issuer common", { ...geldig, iss: "https://login.microsoftonline.com/common/v2.0" }, "claim_iss"],
  ["issuer v1", { ...geldig, iss: `https://sts.windows.net/${tenantId}/` }, "claim_iss"],
  ["andere audience", { ...geldig, aud: "andere-client" }, "claim_aud"],
  ["verlopen", { ...geldig, exp: nu - 1 }, "claim_exp"],
  ["exp ontbreekt", { ...geldig, exp: undefined }, "claim_exp"],
  ["ver 1.0", { ...geldig, ver: "1.0" }, "claim_ver"],
  ["nonce afwijkend", { ...geldig, nonce: "c".repeat(64) }, "claim_nonce"],
  ["nonce ruw i.p.v. hash", { ...geldig, nonce: "ruwe-nonce" }, "claim_nonce"],
  ["idp afwijkend (gast/federatie)", { ...geldig, idp: "https://login.microsoftonline.com/andere/v2.0" }, "claim_idp"],
  ["acct ontbreekt", { ...geldig, acct: undefined }, "claim_acct"],
  ["acct = 1 (gast)", { ...geldig, acct: 1 }, "claim_acct"],
  ["oid leeg", { ...geldig, oid: "" }, "claim_oid_sub"],
  ["oid geen GUID", { ...geldig, oid: "niet-een-guid" }, "claim_oid_sub"],
  ["sub leeg", { ...geldig, sub: "" }, "claim_oid_sub"],
] as const) {
  test(`ID-token weigert ${naam} → ${categorie}`, () => {
    const r = valideerIdToken(claims as Record<string, unknown>, verwacht);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.categorie, categorie);
  });
}

test("ID-token: MSA-tenant als geconfigureerde tenant wordt altijd geweigerd (claim_msa)", () => {
  const r = valideerIdToken(
    { ...geldig, tid: MSA_TENANT_ID, iss: `https://login.microsoftonline.com/${MSA_TENANT_ID}/v2.0` },
    { ...verwacht, tenantId: MSA_TENANT_ID },
  );
  assert.deepEqual(r, { ok: false, categorie: "claim_msa" });
});

test("ID-token: expliciete issuer (lokale E2E-stub) wordt exact getoetst", () => {
  const issuer = `http://127.0.0.1:8791/${tenantId}/v2.0`;
  assert.equal(valideerIdToken({ ...geldig, iss: issuer }, { ...verwacht, issuer }).ok, true);
  assert.equal(valideerIdToken(geldig, { ...verwacht, issuer }).ok, false);
});

test("ID-token: e-mail/preferred_username/name worden niet gelezen en niet teruggegeven", () => {
  const r = valideerIdToken({ ...geldig, email: "x@y.z", preferred_username: "x@y.z", name: "X" }, verwacht);
  assert.equal(r.ok, true);
  assert.doesNotMatch(JSON.stringify(r), /x@y\.z|"name"/);
});
