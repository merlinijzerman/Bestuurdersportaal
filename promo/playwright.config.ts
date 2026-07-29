import { defineConfig } from "@playwright/test";

/**
 * Aparte config voor de promo-opname — bewust los van eventuele test-configs,
 * zodat een opname nooit meelift in CI en andersom.
 *
 *   npx playwright test --config=promo/playwright.config.ts
 */
export default defineConfig({
  testDir: __dirname,
  testMatch: /opname\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PROMO_BASE_URL ?? "http://localhost:3000",
    trace: "off",
    screenshot: "off",
    // Zonder deze timeouts wacht Playwright oneindig op een selector die niet
    // matcht — dan hangt de opname zonder enige output. Liever snel falen: de
    // scène wordt overgeslagen en gelogd, de rest loopt door.
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
});
