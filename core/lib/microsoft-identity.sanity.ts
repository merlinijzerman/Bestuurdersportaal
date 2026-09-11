import assert from "node:assert/strict";
import test from "node:test";
import { microsoftIdentiteitGeldig } from "./microsoft-identity-core";

const verwacht = {
  tenantId: "11111111-2222-3333-4444-555555555555",
  clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  nonce: "verwachte-nonce",
  homeAccountId: "home-account",
};
const geldig = {
  tid: verwacht.tenantId,
  aud: verwacht.clientId,
  nonce: verwacht.nonce,
  iss: `https://login.microsoftonline.com/${verwacht.tenantId}/v2.0`,
};

test("Microsoft-identiteit accepteert alleen het volledige verwachte claimcontract", () => {
  assert.equal(microsoftIdentiteitGeldig(geldig, verwacht), true);
});

for (const [naam, claims] of [
  ["andere tenant", { ...geldig, tid: "99999999-2222-3333-4444-555555555555" }],
  ["andere audience", { ...geldig, aud: "andere-client" }],
  ["andere nonce", { ...geldig, nonce: "andere-nonce" }],
  ["andere issuer", { ...geldig, iss: "https://login.microsoftonline.com/common/v2.0" }],
] as const) {
  test(`Microsoft-identiteit weigert ${naam}`, () => {
    assert.equal(microsoftIdentiteitGeldig(claims, verwacht), false);
  });
}

test("Microsoft-identiteit vereist een MSAL-accountbinding", () => {
  assert.equal(microsoftIdentiteitGeldig(geldig, { ...verwacht, homeAccountId: undefined }), false);
});
