#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  compareRelevantAuthConfig,
  extractSourceAuthConfig,
  fetchTargetAuthConfig,
} from "./verify-supabase-auth-config.mjs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ontbreekt`);
  return value;
}

function mismatchCategory(key) {
  return /^external_[a-z0-9_]+_(?:enabled|skip_nonce_check|allow_without_email)$/.test(key)
    ? "provider_setting"
    : "auth_security_setting";
}

export function buildAuthConfigDiagnostic(source, target) {
  const comparison = compareRelevantAuthConfig(source, target);
  const mismatches = comparison.mismatches.map((key) => ({
    key,
    category: mismatchCategory(key),
    source_present: Object.prototype.hasOwnProperty.call(source, key),
    target_present: Object.prototype.hasOwnProperty.call(target, key),
  }));

  return {
    schema_version: 1,
    status: comparison.matched ? "matched" : "mismatch",
    settings_compared: comparison.settings_compared,
    provider_settings_compared: comparison.provider_settings_compared,
    mismatch_count: mismatches.length,
    mismatches,
    secret_values_compared: false,
    secret_values_logged: false,
  };
}

async function main() {
  const [inventoryPath, outputPath] = process.argv.slice(2);
  if (!inventoryPath || !outputPath) throw new Error("Diagnose-input ontbreekt");

  const sourceProject = requiredEnv("SOURCE_PROJECT_REF");
  const targetProject = requiredEnv("TARGET_PROJECT_REF");
  const managementToken = requiredEnv("SUPABASE_MANAGEMENT_API_TOKEN");
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const source = extractSourceAuthConfig(inventory, sourceProject);
  const target = await fetchTargetAuthConfig({ projectRef: targetProject, managementToken });
  const diagnostic = buildAuthConfigDiagnostic(source, target);

  await writeFile(outputPath, `${JSON.stringify(diagnostic, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
  if (diagnostic.status !== "matched") {
    process.stderr.write("AUTH_CONFIG_DIAGNOSIS:mismatch\n");
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const category = error?.category ?? "unknown";
    process.stderr.write(`AUTH_CONFIG_DIAGNOSIS_FAILED:${category}\n`);
    process.exitCode = 1;
  });
}
