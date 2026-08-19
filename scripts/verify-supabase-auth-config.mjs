#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const BASE_AUTH_SETTINGS = new Set([
  "site_url",
  "uri_allow_list",
  "disable_signup",
  "external_email_enabled",
  "external_phone_enabled",
  "mailer_autoconfirm",
  "mailer_allow_unverified_email_sign_ins",
  "jwt_exp",
  "password_min_length",
  "password_required_characters",
  "security_captcha_enabled",
  "security_manual_linking_enabled",
  "security_update_password_require_reauthentication",
  "sessions_single_per_user",
  "sessions_timebox",
  "sessions_inactivity_timeout",
  "mfa_enabled",
  "mfa_max_enrolled_factors",
]);
const PROVIDER_SETTING = /^external_[a-z0-9_]+_(?:enabled|skip_nonce_check|allow_without_email)$/;

class AuthConfigError extends Error {
  constructor(category) {
    super("Auth-configuratiecontrole faalde");
    this.name = "AuthConfigError";
    this.category = category;
  }
}

function relevantSetting(key) {
  return BASE_AUTH_SETTINGS.has(key) || PROVIDER_SETTING.test(key);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return [...value].sort();
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  }
  return value ?? null;
}

export function extractSourceAuthConfig(inventory, expectedSourceProject) {
  if (!inventory || typeof inventory !== "object") throw new AuthConfigError("source_contract");
  if (inventory.status !== "complete" || inventory.source_project !== expectedSourceProject) {
    throw new AuthConfigError("source_contract");
  }
  if (inventory.coverage?.supabase_auth_config !== true) throw new AuthConfigError("source_coverage");
  const auth = inventory.supabase?.auth;
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) throw new AuthConfigError("source_auth_missing");
  return auth;
}

export function compareRelevantAuthConfig(source, target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new AuthConfigError("target_contract");
  }
  const keys = [...new Set([...Object.keys(source), ...Object.keys(target)])]
    .filter(relevantSetting)
    .sort();
  if (keys.length === 0) throw new AuthConfigError("no_relevant_settings");

  const mismatches = keys.filter((key) => (
    JSON.stringify(canonicalValue(source[key])) !== JSON.stringify(canonicalValue(target[key]))
  ));
  const providerKeys = keys.filter((key) => PROVIDER_SETTING.test(key));
  return {
    matched: mismatches.length === 0,
    settings_compared: keys.length,
    provider_settings_compared: providerKeys.length,
    mismatch_count: mismatches.length,
    // Alleen voor lokale unittests/diagnose in geheugen. De CLI schrijft deze
    // namen bewust nooit naar stdout, stderr of artifacts.
    mismatches,
  };
}

export async function fetchTargetAuthConfig({ projectRef, managementToken, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/auth`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${managementToken}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.arrayBuffer();
    throw new AuthConfigError(`target_http_${response.status}`);
  }
  return response.json();
}

async function main() {
  const [inventoryPath, outputPath] = process.argv.slice(2);
  const sourceProject = process.env.SOURCE_PROJECT_REF?.trim();
  const targetProject = process.env.TARGET_PROJECT_REF?.trim();
  const managementToken = process.env.SUPABASE_MANAGEMENT_API_TOKEN?.trim();
  if (!inventoryPath || !outputPath || !sourceProject || !targetProject || !managementToken) {
    throw new AuthConfigError("inputs");
  }
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const source = extractSourceAuthConfig(inventory, sourceProject);
  const target = await fetchTargetAuthConfig({ projectRef: targetProject, managementToken });
  const comparison = compareRelevantAuthConfig(source, target);
  if (!comparison.matched) throw new AuthConfigError("mismatch");

  const evidence = {
    schema_version: 1,
    status: "verified",
    settings_compared: comparison.settings_compared,
    provider_settings_compared: comparison.provider_settings_compared,
    mismatch_count: 0,
    secret_values_compared: false,
    secret_values_logged: false,
  };
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const category = error instanceof AuthConfigError ? error.category : "unknown";
    process.stderr.write(`AUTH_CONFIG_CHECK_FAILED:${category}\n`);
    process.exitCode = 1;
  });
}
