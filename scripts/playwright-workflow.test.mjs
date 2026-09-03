import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = await readFile("playwright.config.ts", "utf8");
const workflow = await readFile(".github/workflows/e2e-security.yml", "utf8");
const nextConfig = await readFile("next.config.ts", "utf8");

test("product-Playwright blijft gescheiden van promo en gebruikt alleen Chromium", () => {
  assert.match(config, /testDir:\s*["']\.\/tests\/e2e\/specs["']/);
  assert.match(config, /name:\s*["']chromium["']/);
  assert.doesNotMatch(config, /promo\/playwright\.config/);
});

test("CI bouwt één app op één ephemere stack en draait de lokale doelgrendel", () => {
  assert.match(workflow, /scripts\/start-ephemeral-supabase\.sh/);
  assert.equal((workflow.match(/npm run build/g) ?? []).length, 1);
  assert.match(workflow, /SEED_DOELOMGEVING:\s*["']local["']/);
  assert.match(workflow, /npm run test:e2e:guard/);
  assert.match(workflow, /npm run test:e2e -- --project=chromium/);
  assert.match(workflow, /tests\/e2e\/fixtures\/scanner-stub\.mjs/);
  assert.match(workflow, /WP3_E2E_SCANNER:\s*["']local["']/);
  assert.match(workflow, /WP3_E2E_STOP_NA_SCAN:\s*["']true["']/);
  assert.match(workflow, /tests\/e2e\/fixtures\/ai-provider-stub\.mjs/);
  assert.match(workflow, /WP4_E2E_AI_PROVIDER:\s*["']local["']/);
  assert.match(workflow, /WP4_E2E_AI_PROVIDER_URL:\s*["']http:\/\/127\.0\.0\.1:8790["']/);
  assert.doesNotMatch(workflow, /supabase\.co/);
});

test("lokale AI-providerseam is dubbel gegrendeld en kan niet extern routeren", async () => {
  const endpoint = await readFile("core/lib/ai-provider-endpoint.mjs", "utf8");
  const poort = await readFile("core/lib/ai-poort.ts", "utf8");
  assert.match(endpoint, /SEED_DOELOMGEVING !== ["']local["']/);
  assert.match(endpoint, /NEXT_PUBLIC_SUPABASE_URL !== LOKALE_SUPABASE_URL/);
  assert.match(endpoint, /\["127\.0\.0\.1", "localhost"\]/);
  assert.match(poort, /resolveAnthropicBaseUrl/);
  assert.doesNotMatch(workflow, /api\.anthropic\.com/);
});

test("alleen de expliciete lokale seedmodus verruimt CSP voor lokale Supabase", () => {
  assert.match(nextConfig, /SEED_DOELOMGEVING === ["']local["']/);
  assert.match(nextConfig, /http:\/\/127\.0\.0\.1:54321/);
  assert.doesNotMatch(nextConfig, /lokaleE2eConnectSrc[\s\S]*NEXT_PUBLIC_SUPABASE_URL/);
});

test("CI publiceert foutartifacts zonder authstate en zonder promo-opnames", () => {
  assert.match(workflow, /if:\s*failure\(\)/);
  assert.match(workflow, /sanitize-e2e-log\.mjs/);
  assert.match(workflow, /sanitize-e2e-artifacts\.mjs test-results\/e2e playwright-report/);
  assert.match(workflow, /test-results\/e2e/);
  assert.match(workflow, /playwright-report/);
  assert.doesNotMatch(workflow, /tests\/e2e\/\.auth/);
  assert.doesNotMatch(workflow, /promo\/opnames/);
});

test("lokale scannerseam is dubbel gegrendeld en accepteert één vaste loopback-URL", async () => {
  const scannerClient = await readFile("platform/lib/malware-scan-client.ts", "utf8");
  const orchestrator = await readFile("platform/lib/ingest-orchestrator.ts", "utf8");
  assert.match(scannerClient, /SEED_DOELOMGEVING === ["']local["']/);
  assert.match(scannerClient, /WP3_E2E_SCANNER === ["']local["']/);
  assert.match(scannerClient, /NEXT_PUBLIC_SUPABASE_URL === ["']http:\/\/127\.0\.0\.1:54321["']/);
  assert.match(scannerClient, /http:\/\/127\.0\.0\.1:8787\//);
  assert.match(orchestrator, /SEED_DOELOMGEVING === ["']local["']/);
  assert.match(orchestrator, /WP3_E2E_STOP_NA_SCAN === ["']true["']/);
  assert.match(orchestrator, /NEXT_PUBLIC_SUPABASE_URL === ["']http:\/\/127\.0\.0\.1:54321["']/);
});

test("E2E-seed herstelt de rate-limit-beginstaat alleen voor synthetische accounts", async () => {
  const seed = await readFile("tests/e2e/fixtures/seed.mjs", "utf8");
  assert.match(seed, /rate_limit_events/);
  assert.match(seed, /\.in\(["']gebruiker_id["'], tenantUserIds\)/);
  assert.doesNotMatch(seed, /from\(["']rate_limit_events["']\)\s*\.delete\(\)\s*;/);
});
