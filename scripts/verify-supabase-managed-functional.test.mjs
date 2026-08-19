import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFunctionalEvidence,
  chooseTenantFixtures,
  safeAuthErrorDetails,
  validateCanaryState,
} from "./verify-supabase-managed-functional.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const UA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

test("kiest twee actieve tenantfixtures met fondsgebonden privépaden", () => {
  const result = chooseTenantFixtures(
    [
      { host: "a.example.nl", fonds_id: A, actief: true },
      { host: "b.example.nl", fonds_id: B, actief: true },
    ],
    [
      { id: DA, fonds_id: A, opslag_pad: `${A}/a.pdf`, actief: true },
      { id: DB, fonds_id: B, opslag_pad: `${B}/b.pdf`, actief: true },
    ],
  );
  assert.equal(result.length, 2);
  assert.notEqual(result[0].fonds_id, result[1].fonds_id);
});

test("weigert generieke of niet aan het fonds gebonden opslagpaden", () => {
  assert.throws(() => chooseTenantFixtures(
    [
      { host: "a.example.nl", fonds_id: A, actief: true },
      { host: "b.example.nl", fonds_id: B, actief: true },
    ],
    [
      { id: DA, fonds_id: A, opslag_pad: "generiek/a.pdf", actief: true },
      { id: DB, fonds_id: B, opslag_pad: `${B}/b.pdf`, actief: true },
    ],
  ), /functionele controle/i);
});

test("canary-state bevat precies twee verschillende tenants", () => {
  const state = validateCanaryState({
    schema_version: 1,
    canaries: [
      { user_id: UA, fonds_id: A, document_id: DA, storage_path: `${A}/a.pdf`, host: "a.example.nl", email: "a@example.invalid", password: "Aa1!password" },
      { user_id: UB, fonds_id: B, document_id: DB, storage_path: `${B}/b.pdf`, host: "b.example.nl", email: "b@example.invalid", password: "Aa1!password" },
    ],
  });
  assert.equal(state.canaries.length, 2);
});

test("evidence is uitsluitend geaggregeerd", () => {
  const evidence = buildFunctionalEvidence({
    staleRemoved: 0,
    loginChecks: 2,
    rlsChecks: { positive: 4, negative: 4, crossTenant: 4 },
    storageChecks: { positive: 2, negative: 2 },
  });
  assert.equal(evidence.status, "verified");
  for (const forbidden of ["email", "password", "storage_path", "document_id", "fonds_id", "user_id"]) {
    assert.equal(Object.hasOwn(evidence, forbidden), false);
  }
});

test("Auth-foutdiagnose bevat uitsluitend veilige statusvelden", () => {
  const details = safeAuthErrorDetails({
    name: "AuthApiError",
    status: 422,
    code: "user_already_exists",
    message: "gevoelige@email.invalid",
  });
  assert.deepEqual(details, {
    name: "AuthApiError",
    status: 422,
    code: "user_already_exists",
  });
  assert.doesNotMatch(JSON.stringify(details), /gevoelige@email\.invalid/);
  assert.deepEqual(safeAuthErrorDetails({ message: "do not log" }), {});
});
