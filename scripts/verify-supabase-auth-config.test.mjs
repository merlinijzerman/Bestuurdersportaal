import assert from "node:assert/strict";
import test from "node:test";

import {
  compareRelevantAuthConfig,
  extractSourceAuthConfig,
  fetchTargetAuthConfig,
} from "./verify-supabase-auth-config.mjs";

const sourceProject = "aebwiufuegsiwhwpdrfb";

test("haalt uitsluitend een complete, gedekte Auth-inventaris op", () => {
  const auth = { site_url: "https://app.example", external_email_enabled: true };
  assert.equal(extractSourceAuthConfig({
    status: "complete",
    source_project: sourceProject,
    coverage: { supabase_auth_config: true },
    supabase: { auth },
  }, sourceProject), auth);
  assert.throws(() => extractSourceAuthConfig({
    status: "partial",
    source_project: sourceProject,
    coverage: { supabase_auth_config: false },
  }, sourceProject));
});

test("vergelijkt providerflags en beveiligingsinstellingen zonder credentialvelden", () => {
  const shared = {
    site_url: "https://app.example",
    external_email_enabled: true,
    external_google_enabled: false,
    external_google_skip_nonce_check: false,
    password_min_length: 12,
    external_google_client_secret: "bron-geheim",
    smtp_pass: "smtp-geheim",
  };
  const result = compareRelevantAuthConfig(shared, {
    ...shared,
    external_google_client_secret: "ander-geheim",
    smtp_pass: "ander-smtp-geheim",
  });
  assert.equal(result.matched, true);
  assert.equal(result.mismatch_count, 0);
  assert.ok(result.provider_settings_compared >= 2);
});

test("rapporteert alleen aantallen bij een mismatch", () => {
  const result = compareRelevantAuthConfig(
    { site_url: "https://bron.example", external_google_enabled: true },
    { site_url: "https://doel.example", external_google_enabled: false },
  );
  assert.equal(result.matched, false);
  assert.equal(result.mismatch_count, 2);
  assert.equal(JSON.stringify({
    matched: result.matched,
    mismatch_count: result.mismatch_count,
  }).includes("example"), false);
});

test("Management API-token gaat alleen in Authorization en responsdetails lekken niet", async () => {
  const calls = [];
  const body = { site_url: "https://target.example" };
  const result = await fetchTargetAuthConfig({
    projectRef: "abcdefghijklmnopqrst",
    managementToken: "management-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json(body);
    },
  });
  assert.deepEqual(result, body);
  assert.equal(calls[0].options.headers.Authorization, "Bearer management-secret");
  assert.equal(calls[0].url.includes("management-secret"), false);
});
