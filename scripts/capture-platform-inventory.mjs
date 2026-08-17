#!/usr/bin/env node

/**
 * Capture a non-secret recovery inventory for Supabase and Vercel.
 *
 * This script deliberately does not call secret-value endpoints. It also
 * removes sensitive-looking fields from every response before writing JSON.
 * A partial inventory exits non-zero so the caller cannot publish it as a
 * complete recovery record.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_REQUEST_ATTEMPTS = 3;
const SENSITIVE_KEY = /(secret|password|token|credential|private[_-]?key|api[_-]?key|access[_-]?key|connection[_-]?string|client[_-]?secret|jwt[_-]?secret|refresh[_-]?token|value)$/i;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ontbreekt`);
  return value;
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Onbekend argument: ${argument}`);
    const [key, inlineValue] = argument.slice(2).split("=", 2);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Waarde ontbreekt voor --${key}`);
    args.set(key, value);
  }
  return args;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function sanitizeForInventory(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((entry) => sanitizeForInventory(entry)).filter((entry) => entry !== undefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([childKey, childValue]) => [childKey, sanitizeForInventory(childValue, childKey)])
        .filter(([, childValue]) => childValue !== undefined),
    );
  }
  return value;
}

export function summarizeInventoryFailures(failures) {
  return failures.map((failure) => {
    const statusMatch = String(failure.error ?? "").match(/\bHTTP (\d{3})\b/);
    return {
      component: failure.component,
      http_status: statusMatch ? Number(statusMatch[1]) : null,
    };
  });
}

export function extractVercelEnvironmentNames(body) {
  const entries = Array.isArray(body?.envs) ? body.envs : [];
  return entries.map((entry) => ({
    id: entry.id ?? null,
    key: entry.key ?? null,
    target: entry.target ?? null,
    type: entry.type ?? null,
    gitBranch: entry.gitBranch ?? null,
    customEnvironmentIds: entry.customEnvironmentIds ?? null,
    comment: entry.comment ?? null,
    createdAt: entry.createdAt ?? null,
    updatedAt: entry.updatedAt ?? null,
  }));
}

async function fetchJson(url, headers, description) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const error = new Error(`${description} gaf HTTP ${response.status}`);
        error.status = response.status;
        if (response.status >= 400 && response.status < 500 && response.status !== 429) throw error;
        lastError = error;
      } else {
        return await response.json();
      }
    } catch (error) {
      if (error?.status >= 400 && error.status < 500 && error.status !== 429) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < MAX_REQUEST_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
  }
  throw new Error(`${description} mislukt na ${MAX_REQUEST_ATTEMPTS} pogingen: ${lastError?.message}`);
}

function supabaseUrl(projectRef, pathname) {
  return `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}${pathname}`;
}

async function captureSupabase(projectRef, token) {
  const headers = { Authorization: `Bearer ${token}` };
  const endpoints = {
    project: "/",
    auth: "/config/auth",
    storage: "/config/storage",
    realtime: "/config/realtime",
    postgrest: "/config/postgrest",
    postgres: "/config/database/postgres",
    pooler: "/config/database/pooler",
    ssl_enforcement: "/config/ssl-enforcement",
    functions: "/functions",
  };
  const result = {};
  const failures = [];
  for (const [name, endpoint] of Object.entries(endpoints)) {
    try {
      result[name] = sanitizeForInventory(await fetchJson(supabaseUrl(projectRef, endpoint), headers, `Supabase ${name}`));
    } catch (error) {
      failures.push({ component: `supabase.${name}`, error: error.message });
    }
  }
  return { result, failures };
}

function vercelUrl(projectId, pathname, teamId) {
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  return `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}${pathname}${query}`;
}

async function captureVercel(projectId, teamId, token) {
  const headers = { Authorization: `Bearer ${token}` };
  const failures = [];
  let project = null;
  let env = null;
  try {
    project = sanitizeForInventory(await fetchJson(vercelUrl(projectId, "", teamId), headers, "Vercel-project"));
  } catch (error) {
    failures.push({ component: "vercel.project", error: error.message });
  }
  try {
    const body = await fetchJson(vercelUrl(projectId, "/env", teamId), headers, "Vercel-environmentvariabelen");
    env = { names: extractVercelEnvironmentNames(body), values_captured: false };
  } catch (error) {
    failures.push({ component: "vercel.environment_names", error: error.message });
  }
  return { result: { project, environment_variables: env }, failures };
}

function validateProjectIds(projectIds) {
  if (!Array.isArray(projectIds) || projectIds.length === 0) throw new Error("VERCEL_PROJECT_IDS is leeg");
  const normalized = projectIds.map((projectId) => projectId.trim()).filter(Boolean);
  if (normalized.length === 0 || new Set(normalized).size !== normalized.length) {
    throw new Error("VERCEL_PROJECT_IDS bevat geen unieke project-ID's");
  }
  return normalized;
}

export async function captureInventory({
  projectRef,
  supabaseManagementToken,
  vercelProjectIds,
  vercelTeamId = "",
  vercelToken,
  capturedUtc = new Date().toISOString(),
}) {
  const projectIds = validateProjectIds(vercelProjectIds);
  const [supabase, vercelResults] = await Promise.all([
    captureSupabase(projectRef, supabaseManagementToken),
    Promise.all(projectIds.map(async (projectId) => ({
      projectId,
      ...(await captureVercel(projectId, vercelTeamId, vercelToken)),
    }))),
  ]);
  const vercelFailures = vercelResults.flatMap((entry) =>
    entry.failures.map((failure) => ({ ...failure, component: `${entry.projectId}.${failure.component}` })),
  );
  const failures = [...supabase.failures, ...vercelFailures];
  const vercel = {
    projects: Object.fromEntries(vercelResults.map((entry) => [entry.projectId, entry.result])),
    failures: vercelFailures,
  };
  return {
    schema_version: 1,
    status: failures.length === 0 ? "complete" : "partial",
    captured_utc: capturedUtc,
    source_project: projectRef,
    redaction: {
      version: 1,
      secret_values_captured: false,
      secret_value_endpoints_called: false,
    },
    coverage: {
      supabase_project_config: !supabase.failures.some((failure) => failure.component === "supabase.project"),
      supabase_auth_config: !supabase.failures.some((failure) => failure.component === "supabase.auth"),
      supabase_storage_config: !supabase.failures.some((failure) => failure.component === "supabase.storage"),
      supabase_realtime_config: !supabase.failures.some((failure) => failure.component === "supabase.realtime"),
      supabase_postgrest_config: !supabase.failures.some((failure) => failure.component === "supabase.postgrest"),
      supabase_database_config: !supabase.failures.some((failure) =>
        ["supabase.postgres", "supabase.pooler", "supabase.ssl_enforcement"].includes(failure.component),
      ),
      supabase_edge_functions_inventory: !supabase.failures.some((failure) => failure.component === "supabase.functions"),
      vercel_project_config: !vercel.failures.some((failure) => failure.component.endsWith(".vercel.project")),
      vercel_environment_variable_names: !vercel.failures.some((failure) => failure.component.endsWith(".vercel.environment_names")),
      dns_external: false,
      secret_values: false,
    },
    failures,
    supabase: supabase.result,
    vercel: vercel.result,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = args.get("output");
  if (!outputPath) throw new Error("--output ontbreekt");
  const inventory = await captureInventory({
    projectRef: requiredEnv("SUPABASE_PROJECT_REF"),
    supabaseManagementToken: requiredEnv("SUPABASE_MANAGEMENT_API_TOKEN"),
    vercelProjectIds: requiredEnv("VERCEL_PROJECT_IDS").split(","),
    vercelTeamId: process.env.VERCEL_TEAM_ID?.trim() ?? "",
    vercelToken: requiredEnv("VERCEL_TOKEN"),
    capturedUtc: new Date().toISOString(),
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ status: inventory.status, failure_count: inventory.failures.length, failures: summarizeInventoryFailures(inventory.failures) })}\n`);
  if (inventory.status !== "complete") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Platform-inventaris mislukt: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
