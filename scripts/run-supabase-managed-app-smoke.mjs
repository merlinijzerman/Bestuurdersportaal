#!/usr/bin/env node

import { access, chmod, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
let smokeStage = "initialization";

class AppSmokeError extends Error {
  constructor(category) {
    super("Managed applicatiesmoke faalde");
    this.name = "AppSmokeError";
    this.category = category;
  }
}

function fail(category) {
  throw new AppSmokeError(category);
}

function securePath(candidate, secureRoot, label) {
  if (!candidate || !secureRoot || !isAbsolute(candidate) || !isAbsolute(secureRoot)) {
    fail(`${label}_path`);
  }
  const rel = relative(resolve(secureRoot), resolve(candidate));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail(`${label}_outside_encrypted_root`);
  }
  return resolve(candidate);
}

export function validateAppCanaryState(state) {
  if (!state || state.schema_version !== 1 || !Array.isArray(state.canaries) || state.canaries.length !== 2) {
    fail("canary_state_contract");
  }
  for (const entry of state.canaries) {
    if (
      !UUID_PATTERN.test(entry?.user_id ?? "") ||
      !UUID_PATTERN.test(entry?.document_id ?? "") ||
      !HOST_PATTERN.test(entry?.host ?? "") ||
      typeof entry?.email !== "string" ||
      typeof entry?.password !== "string"
    ) {
      fail("canary_state_entry");
    }
  }
  return state;
}

export function buildAppSmokeEvidence(checks) {
  const expected = [
    "real_browser_login",
    "dashboard_rendered",
    "document_list_rendered",
    "document_list_api_authorized",
    "private_download_authorized",
    "private_download_headers_safe",
    "cross_tenant_download_denied",
  ];
  if (!checks || expected.some((key) => checks[key] !== true)) fail("app_evidence_incomplete");
  return {
    schema_version: 1,
    status: "verified",
    browser_sessions: 1,
    app_routes_verified: 3,
    ...Object.fromEntries(expected.map((key) => [key, true])),
  };
}

async function findBrowserExecutable(explicit) {
  const candidates = [
    explicit,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Probeer de volgende bekende runnerlocatie.
    }
  }
  fail("browser_executable");
}

async function main() {
  smokeStage = "arguments";
  const stateArg = process.argv.indexOf("--state");
  const evidenceArg = process.argv.indexOf("--evidence");
  const secureRoot = process.env.MANAGED_RESTORE_ROOT;
  const statePath = securePath(process.argv[stateArg + 1], secureRoot, "state");
  const evidencePath = securePath(process.argv[evidenceArg + 1], secureRoot, "evidence");
  const state = validateAppCanaryState(JSON.parse(await readFile(statePath, "utf8")));
  const own = state.canaries[0];
  const foreign = state.canaries[1];
  const port = process.env.APP_SMOKE_PORT ?? "3000";
  if (!/^\d{2,5}$/.test(port)) fail("app_port");
  const origin = `http://${own.host}:${port}`;
  smokeStage = "browser_executable";
  const executablePath = await findBrowserExecutable(process.env.PLAYWRIGHT_CHROME_PATH);
  const { chromium } = await import("@playwright/test");
  const profilePath = securePath(resolve(secureRoot, "browser-profile"), secureRoot, "profile");
  const downloadsPath = securePath(resolve(secureRoot, "browser-downloads"), secureRoot, "downloads");
  smokeStage = "browser_launch";
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath,
    headless: true,
    acceptDownloads: false,
    downloadsPath,
    args: [
      `--host-resolver-rules=MAP ${own.host} 127.0.0.1,EXCLUDE localhost`,
      "--no-proxy-server",
      "--disable-dev-shm-usage",
    ],
  });
  try {
    smokeStage = "login_page";
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    smokeStage = "login_form";
    await page.getByLabel("E-mailadres").fill(own.email);
    await page.getByLabel("Wachtwoord").fill(own.password);
    smokeStage = "login_submit_button";
    await page.getByRole("button", { name: "Inloggen" }).click();
    smokeStage = "login_redirect";
    await page.waitForURL((url) => url.pathname === "/", { timeout: 45_000 });
    smokeStage = "dashboard";
    await page.getByRole("link", { name: "Home", exact: true }).waitFor({ timeout: 45_000 });

    smokeStage = "document_list_api";
    const listResult = await page.evaluate(async (expectedId) => {
      const response = await fetch("/api/documents/upload", { credentials: "same-origin" });
      if (!response.ok) return { ok: false, found: false };
      const body = await response.json();
      return {
        ok: true,
        found: Array.isArray(body?.documenten) && body.documenten.some((row) => row?.id === expectedId),
      };
    }, own.document_id);
    if (!listResult.ok || !listResult.found) fail("document_list_api");

    smokeStage = "document_library";
    await page.goto(`${origin}/bibliotheek`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByRole("heading", { name: "Documentbibliotheek" }).waitFor({ timeout: 45_000 });

    smokeStage = "private_download";
    const downloadResult = await page.evaluate(async ({ ownId, foreignId }) => {
      async function inspect(id) {
        const response = await fetch(`/api/documents/${id}/bestand`, { credentials: "same-origin" });
        const bytes = response.ok ? (await response.arrayBuffer()).byteLength : 0;
        return {
          status: response.status,
          bytes,
          disposition: response.headers.get("content-disposition") ?? "",
          cacheControl: response.headers.get("cache-control") ?? "",
          nosniff: response.headers.get("x-content-type-options") ?? "",
        };
      }
      return { own: await inspect(ownId), foreign: await inspect(foreignId) };
    }, { ownId: own.document_id, foreignId: foreign.document_id });
    if (downloadResult.own.status !== 200 || downloadResult.own.bytes <= 0) fail("private_download");
    if (
      !downloadResult.own.disposition.toLowerCase().startsWith("attachment;") ||
      !downloadResult.own.cacheControl.toLowerCase().includes("private") ||
      !downloadResult.own.cacheControl.toLowerCase().includes("no-store") ||
      downloadResult.own.nosniff.toLowerCase() !== "nosniff"
    ) {
      fail("private_download_headers");
    }
    if (downloadResult.foreign.status !== 404 || downloadResult.foreign.bytes !== 0) {
      fail("cross_tenant_download");
    }

    smokeStage = "evidence";
    const evidence = buildAppSmokeEvidence({
      real_browser_login: true,
      dashboard_rendered: true,
      document_list_rendered: true,
      document_list_api_authorized: true,
      private_download_authorized: true,
      private_download_headers_safe: true,
      cross_tenant_download_denied: true,
    });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    await chmod(evidencePath, 0o600);
  } finally {
    await context.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const category = error instanceof AppSmokeError ? error.category : "unknown";
    process.stderr.write(`MANAGED_APP_SMOKE_FAILED:${category}:${smokeStage}\n`);
    process.exitCode = 1;
  });
}
