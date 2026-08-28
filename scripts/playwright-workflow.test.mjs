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
  assert.doesNotMatch(workflow, /supabase\.co/);
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
