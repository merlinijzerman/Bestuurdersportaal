import { defineConfig, devices } from "@playwright/test";

const inCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e/specs",
  outputDir: "./test-results/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: inCi ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: inCi
    ? [
        ["line"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_FONDS_A_ORIGIN ?? "http://fonds-a.localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
