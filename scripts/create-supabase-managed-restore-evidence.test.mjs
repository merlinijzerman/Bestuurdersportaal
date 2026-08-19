import assert from "node:assert/strict";
import test from "node:test";

import { buildManagedRestoreEvidence } from "./create-supabase-managed-restore-evidence.mjs";

const technical = {
  ok: true,
  postgres_major: 17,
  auth_users: 16,
  auth_identities: 16,
  storage_buckets: 4,
  storage_objects: 34,
  storage_total_bytes: 12345,
  content_hashes_verified: true,
  policy_count: 160,
  trigger_count: 83,
  critical_public_counts: { documenten: 34, document_chunks: 6845 },
  source_extensions: ["pgcrypto", "vector"],
};

const input = {
  technical,
  finalTechnical: structuredClone(technical),
  keys: { status: "verified", admin_key_type: "secret", client_key_type: "publishable", target_binding_verified: true, publishable_key_used_for_admin: false },
  auth: { status: "verified", settings_compared: 12, provider_settings_compared: 3, mismatch_count: 0, secret_values_compared: false, secret_values_logged: false },
  functional: { status: "verified", real_password_logins: 2, user_jwts_verified: 2, rls_positive_checks: 4, rls_negative_checks: 4, cross_tenant_denials: 4, private_storage_positive_checks: 2, private_storage_cross_tenant_denials: 2, distinct_tenants_tested: 2 },
  app: { status: "verified", browser_sessions: 1, app_routes_verified: 3, real_browser_login: true, dashboard_rendered: true, document_list_rendered: true, document_list_api_authorized: true, private_download_authorized: true, private_download_headers_safe: true, cross_tenant_download_denied: true },
  cleanup: { status: "verified", canary_users_removed: 2, canary_profiles_remaining: 0 },
  mode: { mode: "fresh", prior_phase: null },
};

test("publiceert uitsluitend geaggregeerd restorebewijs", () => {
  const evidence = buildManagedRestoreEvidence(input);
  assert.equal(evidence.status, "verified");
  assert.equal(evidence.database.critical_tables_verified, 2);
  assert.equal(evidence.database.critical_rows_verified, 6879);
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /document_chunks|pgcrypto|a{64}|a@example\.invalid|storage_path|\.pdf/);
});

test("weigert residudrift na canary-cleanup", () => {
  const changed = structuredClone(input);
  changed.finalTechnical.auth_users += 1;
  assert.throws(() => buildManagedRestoreEvidence(changed));
});

test("registreert resume alleen als geaggregeerde modus", () => {
  const resumed = structuredClone(input);
  resumed.mode = { mode: "resume", prior_phase: "database_restored" };
  const evidence = buildManagedRestoreEvidence(resumed);
  assert.equal(evidence.restore_mode, "resume");
  assert.equal(evidence.resumed_from_prior_phase, true);
  assert.equal(Object.hasOwn(evidence, "prior_phase"), false);
});
