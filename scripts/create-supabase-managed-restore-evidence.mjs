#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

class EvidenceError extends Error {
  constructor(category) {
    super("Managed evidence kon niet veilig worden opgebouwd");
    this.name = "EvidenceError";
    this.category = category;
  }
}

function fail(category) {
  throw new EvidenceError(category);
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(label);
  return value;
}

function verified(value, label) {
  if (!value || value.status !== "verified") fail(label);
  return value;
}

export function buildManagedRestoreEvidence({ technical, finalTechnical, keys, auth, functional, app, cleanup, mode }) {
  if (technical?.ok !== true || finalTechnical?.ok !== true) fail("technical");
  for (const field of ["auth_users", "auth_identities", "storage_buckets", "storage_objects"] ) {
    if (integer(technical[field], `technical_${field}`) !== integer(finalTechnical[field], `final_${field}`)) {
      fail(`final_${field}_drift`);
    }
  }
  if (technical.content_hashes_verified !== true || finalTechnical.content_hashes_verified !== true) {
    fail("content_hashes");
  }
  const keyEvidence = verified(keys, "keys");
  const authEvidence = verified(auth, "auth");
  const functionalEvidence = verified(functional, "functional");
  const appEvidence = verified(app, "app");
  const cleanupEvidence = verified(cleanup, "cleanup");
  if (!mode || !new Set(["fresh", "resume"]).has(mode.mode)) fail("mode");
  if (
    !new Set(["secret", "legacy_service_role"]).has(keyEvidence.admin_key_type) ||
    !new Set(["publishable", "legacy_anon"]).has(keyEvidence.client_key_type) ||
    keyEvidence.target_binding_verified !== true ||
    keyEvidence.publishable_key_used_for_admin !== false
  ) {
    fail("key_separation");
  }
  if (
    authEvidence.mismatch_count !== 0 ||
    authEvidence.secret_values_logged !== false ||
    authEvidence.secret_values_compared !== false
  ) {
    fail("auth_safety");
  }
  if (
    functionalEvidence.real_password_logins !== 2 ||
    functionalEvidence.user_jwts_verified !== 2 ||
    functionalEvidence.rls_positive_checks !== 4 ||
    functionalEvidence.rls_negative_checks !== 4 ||
    functionalEvidence.cross_tenant_denials !== 4 ||
    functionalEvidence.private_storage_positive_checks !== 2 ||
    functionalEvidence.private_storage_cross_tenant_denials !== 2 ||
    functionalEvidence.distinct_tenants_tested !== 2
  ) {
    fail("functional_incomplete");
  }
  if (
    appEvidence.real_browser_login !== true ||
    appEvidence.dashboard_rendered !== true ||
    appEvidence.document_list_rendered !== true ||
    appEvidence.document_list_api_authorized !== true ||
    appEvidence.private_download_authorized !== true ||
    appEvidence.private_download_headers_safe !== true ||
    appEvidence.cross_tenant_download_denied !== true
  ) {
    fail("app_incomplete");
  }
  if (cleanupEvidence.canary_users_removed !== 2 || cleanupEvidence.canary_profiles_remaining !== 0) {
    fail("cleanup_incomplete");
  }

  const criticalCounts = technical.critical_public_counts;
  if (!criticalCounts || typeof criticalCounts !== "object" || Array.isArray(criticalCounts)) fail("critical_counts");
  const criticalRows = Object.values(criticalCounts).reduce(
    (sum, value) => sum + integer(value, "critical_count"),
    0,
  );
  if (!Array.isArray(technical.source_extensions)) fail("extensions");

  return {
    schema_version: 1,
    status: "verified",
    restore_mode: mode.mode,
    resumed_from_prior_phase: mode.mode === "resume",
    encrypted_workspace: true,
    database: {
      postgres_major: integer(technical.postgres_major, "postgres_major"),
      content_hashes_verified: true,
      policy_count: integer(technical.policy_count, "policies"),
      trigger_count: integer(technical.trigger_count, "triggers"),
      critical_tables_verified: Object.keys(criticalCounts).length,
      critical_rows_verified: criticalRows,
      extension_count: technical.source_extensions.length,
    },
    auth_data: {
      user_count: integer(technical.auth_users, "auth_users"),
      identity_count: integer(technical.auth_identities, "auth_identities"),
    },
    storage: {
      bucket_count: integer(technical.storage_buckets, "storage_buckets"),
      object_count: integer(technical.storage_objects, "storage_objects"),
      total_bytes: integer(technical.storage_total_bytes, "storage_total_bytes"),
    },
    key_separation: {
      admin_key_type: keyEvidence.admin_key_type,
      client_key_type: keyEvidence.client_key_type,
      target_binding_verified: keyEvidence.target_binding_verified === true,
      publishable_key_used_for_admin: keyEvidence.publishable_key_used_for_admin === true,
    },
    auth_configuration: {
      settings_compared: integer(authEvidence.settings_compared, "auth_settings"),
      provider_settings_compared: integer(authEvidence.provider_settings_compared, "provider_settings"),
      mismatch_count: integer(authEvidence.mismatch_count, "auth_mismatches"),
      secret_values_compared: false,
      secret_values_logged: authEvidence.secret_values_logged === true,
    },
    functional: {
      real_password_logins: integer(functionalEvidence.real_password_logins, "logins"),
      user_jwts_verified: integer(functionalEvidence.user_jwts_verified, "jwts"),
      rls_positive_checks: integer(functionalEvidence.rls_positive_checks, "rls_positive"),
      rls_negative_checks: integer(functionalEvidence.rls_negative_checks, "rls_negative"),
      cross_tenant_denials: integer(functionalEvidence.cross_tenant_denials, "cross_tenant"),
      private_storage_positive_checks: integer(functionalEvidence.private_storage_positive_checks, "storage_positive"),
      private_storage_cross_tenant_denials: integer(functionalEvidence.private_storage_cross_tenant_denials, "storage_negative"),
      distinct_tenants_tested: integer(functionalEvidence.distinct_tenants_tested, "tenant_count"),
    },
    application: {
      browser_sessions: integer(appEvidence.browser_sessions, "browser_sessions"),
      app_routes_verified: integer(appEvidence.app_routes_verified, "app_routes"),
      real_browser_login: appEvidence.real_browser_login === true,
      dashboard_rendered: appEvidence.dashboard_rendered === true,
      document_list_rendered: appEvidence.document_list_rendered === true,
      document_list_api_authorized: appEvidence.document_list_api_authorized === true,
      private_download_authorized: appEvidence.private_download_authorized === true,
      private_download_headers_safe: appEvidence.private_download_headers_safe === true,
      cross_tenant_download_denied: appEvidence.cross_tenant_download_denied === true,
    },
    cleanup: {
      canary_users_removed: integer(cleanupEvidence.canary_users_removed, "canary_cleanup"),
      canary_profiles_remaining: integer(cleanupEvidence.canary_profiles_remaining, "profile_cleanup"),
      final_exact_validation: true,
    },
  };
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || !argv[index + 1]) fail("arguments");
    args.set(argv[index].slice(2), argv[index + 1]);
  }
  return args;
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail(label);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = buildManagedRestoreEvidence({
    technical: await readJson(args.get("technical"), "technical_read"),
    finalTechnical: await readJson(args.get("final-technical"), "final_technical_read"),
    keys: await readJson(args.get("keys"), "keys_read"),
    auth: await readJson(args.get("auth"), "auth_read"),
    functional: await readJson(args.get("functional"), "functional_read"),
    app: await readJson(args.get("app"), "app_read"),
    cleanup: await readJson(args.get("cleanup"), "cleanup_read"),
    mode: await readJson(args.get("mode"), "mode_read"),
  });
  const output = args.get("output");
  if (!output) fail("output");
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const category = error instanceof EvidenceError ? error.category : "unknown";
    process.stderr.write(`MANAGED_EVIDENCE_FAILED:${category}\n`);
    process.exitCode = 1;
  });
}
