import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySupabaseKey,
  managedAdminHeaders,
  validateManagedKeyPair,
  verifyManagedKeyConnectivity,
} from "./verify-supabase-managed-keys.mjs";

const projectRef = "abcdefghijklmnopqrst";

function legacyKey(role, ref = projectRef) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, ref })}.signature`;
}

test("accepteert nieuwe secret/publishable keys met strikte taakscheiding", () => {
  assert.deepEqual(validateManagedKeyPair({
    adminKey: "sb_secret_abcdefghijklmnopqrstuv",
    clientKey: "sb_publishable_abcdefghijklmnop",
    projectRef,
  }), {
    admin_key_type: "secret",
    client_key_type: "publishable",
  });
  assert.throws(
    () => classifySupabaseKey("sb_publishable_abcdefghijklmnop", { purpose: "admin", projectRef }),
    /publishable key mag niet/,
  );
  assert.throws(
    () => classifySupabaseKey("sb_secret_abcdefghijklmnopqrstuv", { purpose: "client", projectRef }),
    /secret key mag niet/,
  );
});

test("accepteert legacy service_role/anon JWT's van exact het doelproject", () => {
  assert.equal(classifySupabaseKey(legacyKey("service_role"), { purpose: "admin", projectRef }), "legacy_service_role");
  assert.equal(classifySupabaseKey(legacyKey("anon"), { purpose: "client", projectRef }), "legacy_anon");
  assert.throws(
    () => classifySupabaseKey(legacyKey("service_role", "zyxwvutsrqponmlkjihg"), { purpose: "admin", projectRef }),
    /niet bij het doelproject/,
  );
  assert.throws(
    () => classifySupabaseKey(legacyKey("anon"), { purpose: "admin", projectRef }),
    /service-role-key vereist/,
  );
});

test("controleert admin en client via gescheiden endpoints en headers", async () => {
  const calls = [];
  await verifyManagedKeyConnectivity({
    baseUrl: `https://${projectRef}.supabase.co`,
    adminKey: "sb_secret_abcdefghijklmnopqrstuv",
    clientKey: "sb_publishable_abcdefghijklmnop",
    adminKeyType: "secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, headers: options.headers });
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/auth\/v1\/admin\/users/);
  assert.equal(calls[0].headers.apikey.startsWith("sb_secret_"), true);
  assert.equal("Authorization" in calls[0].headers, false);
  assert.match(calls[1].url, /\/auth\/v1\/settings$/);
  assert.equal(calls[1].headers.apikey.startsWith("sb_publishable_"), true);
  assert.equal("Authorization" in calls[1].headers, false);
});

test("stuurt alleen een legacy service-role-JWT als Bearer", () => {
  const secret = "sb_secret_abcdefghijklmnopqrstuv";
  assert.deepEqual(managedAdminHeaders(secret, "secret"), { apikey: secret });
  assert.deepEqual(managedAdminHeaders("legacy.jwt.value", "legacy_service_role"), {
    apikey: "legacy.jwt.value",
    Authorization: "Bearer legacy.jwt.value",
  });
});
