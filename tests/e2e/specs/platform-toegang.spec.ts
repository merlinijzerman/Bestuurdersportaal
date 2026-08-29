import { expect, test } from "@playwright/test";
import { platformAuthStateBestand } from "../fixtures/config.mjs";

const PLATFORM = process.env.E2E_PLATFORM_ORIGIN ?? "http://beheer.localhost:3000";
const FONDS_A = process.env.E2E_FONDS_A_ORIGIN ?? "http://fonds-a.localhost:3000";

test.describe("E2E-06 — platformidentiteit zonder AAL2", () => {
  test.use({ storageState: platformAuthStateBestand("zonderCapability", "aal1") });

  test("beveiligde platformpagina stopt bij de echte MFA-challenge", async ({ page }) => {
    await page.goto(`${PLATFORM}/platform`);
    await expect(page).toHaveURL(`${PLATFORM}/platform/login?mfa=1`);
    await expect(page.getByText("Voer de 6-cijferige code uit uw authenticator-app in.")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Welkom/ })).toHaveCount(0);
  });
});

test.describe("E2E-06 — AAL2 zonder capability", () => {
  test.use({ storageState: platformAuthStateBestand("zonderCapability", "aal2") });

  test("AAL2 opent platformhome maar monitoring blijft server-side geweigerd", async ({ page }) => {
    await page.goto(`${PLATFORM}/platform`);
    await expect(page.getByRole("heading", { name: /Welkom, Synthetisch platform zonder capability/ })).toBeVisible();

    await page.goto(`${PLATFORM}/platform/monitoring`);
    await expect(page.getByText(/geen recht om de monitoring in te zien/)).toBeVisible();
    await expect(page.getByText("platform.observability.read")).toBeVisible();
  });

  test("platformfixture krijgt op een fondshost geen tenantdashboard", async ({ page }) => {
    await page.goto(`${FONDS_A}/`);
    await expect(page).toHaveURL(`${FONDS_A}/login`);
    await expect(page.getByText(/U bent bestuurslid/)).toHaveCount(0);
  });
});

test.describe("E2E-06 — AAL2 met capability", () => {
  test.use({ storageState: platformAuthStateBestand("observability", "aal2") });

  test("geldige MFA-sessie voert precies de toegestane monitoring-read uit", async ({ page }) => {
    await page.goto(`${PLATFORM}/platform/monitoring`);
    await expect(page.getByRole("heading", { name: "Monitoring" })).toBeVisible();
    await expect(page.getByText(/geen recht om de monitoring/)).toHaveCount(0);
    await expect(page.getByText(/Operationele en technische signalen/)).toBeVisible();
  });
});
