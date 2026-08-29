import { expect, test } from "@playwright/test";
import {
  authStateBestand,
  E2E_WACHTWOORD,
  e2eEmail,
} from "../fixtures/config.mjs";

const ORIGINS = {
  fondsA: process.env.E2E_FONDS_A_ORIGIN ?? "http://fonds-a.localhost:3000",
  fondsB: process.env.E2E_FONDS_B_ORIGIN ?? "http://fonds-b.localhost:3000",
  onbekend: process.env.E2E_ONBEKENDE_ORIGIN ?? "http://onbekend.localhost:3000",
  platform: process.env.E2E_PLATFORM_ORIGIN ?? "http://beheer.localhost:3000",
};

test.describe("E2E-01 — anonieme tenantpoort", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("anonieme gebruiker wordt naar de tenantlogin geleid", async ({ page }) => {
    await page.goto(`${ORIGINS.fondsA}/`);
    await expect(page).toHaveURL(`${ORIGINS.fondsA}/login`);
    await expect(page.getByRole("heading", { name: "Log in op uw bestuurdersomgeving" })).toBeVisible();
  });

  test("echte login gevolgd door logout wist de sessie blijvend", async ({ page }) => {
    await page.goto(`${ORIGINS.fondsA}/login`);
    // Gebruik een apart account: Supabase logout trekt de refresh-token van
    // deze gebruiker in en mag de opgeslagen bestuurder-fixture niet raken.
    await page.getByLabel("E-mailadres").fill(e2eEmail("a", "bestuursbureau"));
    await page.getByLabel("Wachtwoord").fill(E2E_WACHTWOORD);
    await page.getByRole("button", { name: "Inloggen" }).click();
    await expect(page.getByRole("button", { name: "Uitloggen" })).toBeVisible();

    await page.getByRole("button", { name: "Uitloggen" }).click();
    await expect(page).toHaveURL(`${ORIGINS.fondsA}/login`);
    await page.goto(`${ORIGINS.fondsA}/`);
    await expect(page).toHaveURL(`${ORIGINS.fondsA}/login`);
  });
});

test.describe("E2E-01 — fonds A bestuurder", () => {
  test.use({ storageState: authStateBestand("a", "bestuurder") });

  test("fonds-A-sessie opent uitsluitend het eigen dashboard", async ({ page }) => {
    await page.goto(`${ORIGINS.fondsA}/`);
    await expect(page.getByText(/U bent bestuurslid van Synthetisch E2E Fonds A\./)).toBeVisible();

    await page.goto(`${ORIGINS.fondsB}/`);
    await expect(page.getByRole("heading", { name: "Geen toegang op dit adres" })).toBeVisible();
    await expect(page.getByText(/ander fonds dan uw account/)).toBeVisible();
  });

  test("onbekende host opent geen tenantroute", async ({ page }) => {
    await page.goto(`${ORIGINS.onbekend}/`);
    await expect(page.getByRole("heading", { name: "Geen toegang op dit adres" })).toBeVisible();
    await expect(page.getByText(/niet gekoppeld aan een bekend fonds/)).toBeVisible();
  });

  test("tenantaccount krijgt geen platformtoegang", async ({ page }) => {
    await page.goto(`${ORIGINS.platform}/`);
    await expect(page).toHaveURL(/\/platform\/login\?fout=geen_toegang$/);
    await expect(page.getByText(/Dit account heeft geen platformtoegang/)).toBeVisible();
  });
});

test.describe("E2E-01 — fonds B bestuurder", () => {
  test.use({ storageState: authStateBestand("b", "bestuurder") });

  test("fonds-B-sessie opent het eigen dashboard", async ({ page }) => {
    await page.goto(`${ORIGINS.fondsB}/`);
    await expect(page.getByText(/U bent bestuurslid van Synthetisch E2E Fonds B\./)).toBeVisible();
  });
});
