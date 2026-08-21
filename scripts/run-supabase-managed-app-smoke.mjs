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

function classifySmokeFailure(error) {
  if (error instanceof AppSmokeError) return error.category;
  const message = typeof error?.message === "string" ? error.message : "";
  if (/timeout/i.test(message)) return "playwright_timeout";
  if (/intercepts pointer events/i.test(message)) return "pointer_intercepted";
  if (/not attached/i.test(message)) return "element_detached";
  if (/not enabled/i.test(message)) return "element_not_enabled";
  if (/closed/i.test(message)) return "browser_closed";
  return "unknown";
}

const SAFE_SMOKE_PATHS = new Set(["/", "/login", "/bibliotheek"]);
const DIAGNOSTIC_FIELDS = [
  "pathname",
  "root_path",
  "login_error",
  "login_busy",
  "auth_cookie",
  "tenant_blocked",
  "shell_rendered",
];
const DIAGNOSTIC_PATH_FIELDS = new Set(["pathname", "root_path"]);

// Alleen een vaste, vooraf bekende routenaam mag in de logs belanden. Elke
// andere waarde (inclusief query, host en documentpaden) wordt geplet tot een
// categorie, zodat diagnose nooit tenant- of gebruikersgegevens lekt.
export function classifySmokePath(value) {
  try {
    const pathname = new URL(value).pathname;
    return SAFE_SMOKE_PATHS.has(pathname) ? pathname : "other";
  } catch {
    return "unknown";
  }
}

// Uitsluitend booleans en geclassificeerde routenamen. Onbekende sleutels en
// niet-primitieve waarden worden weggelaten in plaats van doorgegeven.
export function formatSmokeDiagnostic(fields) {
  const parts = [];
  for (const key of DIAGNOSTIC_FIELDS) {
    const value = fields?.[key];
    if (typeof value === "boolean") {
      parts.push(`${key}=${value}`);
    } else if (
      DIAGNOSTIC_PATH_FIELDS.has(key) &&
      typeof value === "string" &&
      (SAFE_SMOKE_PATHS.has(value) || value === "other" || value === "unknown")
    ) {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join(";");
}

// Diagnose mag de oorspronkelijke fout nooit verdringen: elke stap is
// afzonderlijk best-effort en valt terug op een neutrale waarde.
async function collectLoginDiagnostics(page) {
  const fields = {};
  try {
    fields.pathname = classifySmokePath(page.url());
  } catch {
    fields.pathname = "unknown";
  }
  try {
    fields.login_error = await page.locator("form div.bg-err-tint").isVisible({ timeout: 2_000 });
  } catch {
    fields.login_error = false;
  }
  try {
    fields.login_busy = await page.locator('form button[type="submit"]').isDisabled({ timeout: 2_000 });
  } catch {
    fields.login_busy = false;
  }
  try {
    const cookies = await page.context().cookies();
    fields.auth_cookie = cookies.some((cookie) => typeof cookie?.name === "string" && cookie.name.startsWith("sb-"));
  } catch {
    fields.auth_cookie = false;
  }
  try {
    const finalUrl = await page.evaluate(async () => {
      const response = await fetch("/", { credentials: "same-origin" });
      return response.url;
    });
    fields.root_path = classifySmokePath(finalUrl);
  } catch {
    fields.root_path = "unknown";
  }
  try {
    // Vaste UI-tekst uit de fail-closed tenantgate in de dashboardlayout.
    fields.tenant_blocked = await page
      .getByRole("heading", { name: "Geen toegang op dit adres" })
      .isVisible({ timeout: 2_000 });
  } catch {
    fields.tenant_blocked = false;
  }
  try {
    // De profiellink hoort bij de shell zelf en staat los van het
    // modulemanifest; hij onderscheidt "shell rendert" van "nav is leeg".
    fields.shell_rendered = await page.locator('a[href="/profiel"]').isVisible({ timeout: 2_000 });
  } catch {
    fields.shell_rendered = false;
  }
  return formatSmokeDiagnostic(fields);
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
  // De oefening draait achter een wegwerp-TLS-terminator, omdat de app in
  // productie HSTS en een CSP met upgrade-insecure-requests meestuurt. Over
  // plain http upgradet Chrome dan alle subresources en hydrateert React nooit.
  const scheme = process.env.APP_SMOKE_SCHEME ?? "https";
  if (scheme !== "https" && scheme !== "http") fail("app_scheme");
  const origin = `${scheme}://${own.host}:${port}`;
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
    // Het certificaat is een wegwerpexemplaar dat alleen binnen deze run en
    // binnen het versleutelde volume bestaat; een echte CA is hier zinloos.
    ignoreHTTPSErrors: true,
    args: [
      `--host-resolver-rules=MAP ${own.host} 127.0.0.1,EXCLUDE localhost`,
      "--no-proxy-server",
      "--disable-dev-shm-usage",
    ],
  });
  let loginDiagnostic = "";
  try {
    smokeStage = "login_page";
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // domcontentloaded vuurt voordat React hydrateert. Vullen en klikken vóór
    // hydratie levert een native formulierverzending op: de velden hebben geen
    // name-attribuut, dus dat is een kale GET /login en de browser blijft op de
    // loginpagina staan. React zet bij hydratie __reactProps$-sleutels op de
    // DOM-node; dat is het exacte signaal dat onSubmit is aangekoppeld.
    smokeStage = "login_hydration";
    await page.waitForFunction(
      () => {
        const veld = document.getElementById("login-email");
        return !!veld && Object.keys(veld).some((sleutel) => sleutel.startsWith("__reactProps$"));
      },
      undefined,
      { timeout: 45_000 }
    );
    smokeStage = "login_form";
    await page.getByLabel("E-mailadres").fill(own.email);
    await page.getByLabel("Wachtwoord").fill(own.password);
    const loginButton = page.locator('form button[type="submit"]');
    smokeStage = "login_submit_button_visible";
    await loginButton.waitFor({ state: "visible", timeout: 45_000 });
    smokeStage = "login_submit_button_enabled";
    if (!(await loginButton.isEnabled())) fail("login_button_disabled");
    smokeStage = "login_submit_button_dom_click";
    await loginButton.evaluate((button) => button.click());
    smokeStage = "login_redirect_check";
    if (new URL(page.url()).pathname !== "/") {
      smokeStage = "login_redirect";
      await page.waitForURL((url) => url.pathname === "/", { timeout: 45_000 });
    }
    smokeStage = "dashboard";
    // Bewust de profiellink en niet een nav-item: welke modules in de nav staan
    // hangt af van het fondsmanifest (beschikbareModules), en dat mag de
    // hersteloefening niet impliciet meetesten. De profiellink hoort bij de
    // shell zelf en bewijst dus dat de dashboardlayout voor deze gebruiker is
    // gerenderd — inclusief de auth-gate en de fail-closed tenantcontrole
    // erboven, die beide een pagina zonder shell zouden opleveren.
    await page.locator('a[href="/profiel"]').waitFor({ timeout: 45_000 });

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
  } catch (error) {
    // Diagnose draait nog binnen de open browsercontext, maar mag de
    // oorspronkelijke fout nooit vervangen of vertragen tot een crash.
    try {
      const page = context.pages()[0];
      if (page) loginDiagnostic = await collectLoginDiagnostics(page);
      if (error && typeof error === "object") error.smokeDiagnostic = loginDiagnostic;
    } catch {
      // Diagnose is optioneel; de categorie en fase blijven altijd beschikbaar.
    }
    throw error;
  } finally {
    await context.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const category = classifySmokeFailure(error);
    process.stderr.write(`MANAGED_APP_SMOKE_FAILED:${category}:${smokeStage}\n`);
    if (typeof error?.smokeDiagnostic === "string" && error.smokeDiagnostic) {
      process.stderr.write(`MANAGED_APP_SMOKE_DIAGNOSTIC:${error.smokeDiagnostic}\n`);
    }
    process.exitCode = 1;
  });
}
