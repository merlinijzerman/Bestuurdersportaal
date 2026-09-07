// ============================================================================
//  E2E — Microsoft-login (#335 T2) tegen de lokale OIDC-stub (tests/e2e/fixtures/
//  oidc-stub.mjs). Fonds A heeft de flag AAN (seed), fonds B UIT.
//
//  Wat hier wél wordt bewezen: knop per fonds, exacte startparameters (scope
//  `openid profile`, PKCE S256, geen offline_access), neutrale weigeringen
//  (niet-gekoppeld, replay, kapotte state, gast, refresh-token), 404 zonder flag,
//  401 op de koppel-start zonder sessie, en de koppelflow tot en met de
//  reservering. De positieve sign-in/link tegen GoTrue vereist de ECHTE Microsoft-
//  JWKS en is door spike T0.5 en de Preview-smoke gedekt (zie oidc-stub.mjs).
// ============================================================================
import { expect, test, type Page } from "@playwright/test";
import { authStateBestand, E2E_OIDC } from "../fixtures/config.mjs";

/** Begin van de ene neutrale loginmelding (core/lib/microsoft-login-error-core.ts,
 *  LOGIN_MICROSOFT_MELDING); als tekst gepind omdat Playwright geen `@/`-alias laadt. */
const LOGIN_MICROSOFT_MELDING = /Inloggen is niet gelukt\. Log in met uw e-mailadres en wachtwoord/;

const ORIGINS = {
  fondsA: process.env.E2E_FONDS_A_ORIGIN ?? "http://fonds-a.localhost:3000",
  fondsB: process.env.E2E_FONDS_B_ORIGIN ?? "http://fonds-b.localhost:3000",
};
const STUB = process.env.MICROSOFT_LOGIN_E2E_OIDC_URL ?? `http://127.0.0.1:${E2E_OIDC.poort}`;

async function stubReset(page: Page, identiteit: Record<string, unknown> = {}) {
  await page.request.delete(`${STUB}/verzoeken`);
  await page.request.post(`${STUB}/stub/identiteit`, { data: identiteit });
}

async function stubVerzoeken(page: Page): Promise<Array<Record<string, unknown>>> {
  return (await page.request.get(`${STUB}/verzoeken`)).json();
}

/** Start de inlogflow via de knop en vang de callback-URL op (voor replay). */
async function loginViaKnop(page: Page): Promise<string> {
  let callbackUrl = "";
  page.on("request", (r) => {
    if (r.url().includes("/auth/microsoft-login/callback")) callbackUrl = r.url();
  });
  await page.goto(`${ORIGINS.fondsA}/login`);
  await page.getByRole("link", { name: "Inloggen met Microsoft" }).click();
  await page.waitForURL(/\/login\?/);
  return callbackUrl;
}

test.describe("MS-LOGIN — anoniem", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("knop bestaat alleen op het fonds met de flag; wachtwoordformulier blijft", async ({ page }) => {
    await page.goto(`${ORIGINS.fondsA}/login`);
    await expect(page.getByRole("link", { name: "Inloggen met Microsoft" })).toHaveAttribute("href", "/auth/microsoft-login/start");
    await expect(page.getByRole("button", { name: "Inloggen" })).toBeVisible();
    await page.goto(`${ORIGINS.fondsB}/login`);
    await expect(page.getByRole("link", { name: "Inloggen met Microsoft" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Inloggen" })).toBeVisible();
  });

  test("start zonder flag → 404 neutraal; start op fonds A → 302 met exact openid profile + PKCE", async ({ page }) => {
    const b = await page.request.get(`${ORIGINS.fondsB}/auth/microsoft-login/start`, { maxRedirects: 0 });
    expect(b.status()).toBe(404);
    expect(await b.json()).toEqual({ error: "Deze inlogmethode is niet beschikbaar." });

    const a = await page.request.get(`${ORIGINS.fondsA}/auth/microsoft-login/start`, { maxRedirects: 0 });
    expect(a.status()).toBe(307);
    const naar = new URL(a.headers()["location"]!);
    expect(naar.origin).toBe(STUB);
    expect(naar.searchParams.get("scope")).toBe("openid profile");
    expect(naar.searchParams.get("code_challenge_method")).toBe("S256");
    expect(naar.searchParams.get("redirect_uri")).toBe(`${ORIGINS.fondsA}/auth/microsoft-login/callback`);
    expect(naar.search).not.toMatch(/offline_access|email|login_hint|prompt/);
    expect(a.headers()["cache-control"]).toBe("no-store");
  });

  test("niet-gekoppelde identiteit → één neutrale melding met supportcode, geen sessie; replay wordt geweigerd zonder tweede tokenwissel", async ({ page }) => {
    await stubReset(page);
    const callbackUrl = await loginViaKnop(page);
    await expect(page).toHaveURL(/\/login\?fout=microsoft&sc=[A-Z0-9]{8}$/);
    // Alleen het meldingsblok van het formulier (<div role="alert">); Next injecteert
    // na een navigatie ook een <p role="alert"> als route-announcer.
    const alert = page.locator('div[role="alert"]');
    await expect(alert).toContainText(LOGIN_MICROSOFT_MELDING);
    await expect(alert).toContainText(/Supportcode: [A-Z0-9]{8}/);
    await expect(alert).not.toContainText(/tenant|gast|onbekend account|@/i);
    // Geen sessie ontstaan.
    await page.goto(`${ORIGINS.fondsA}/`);
    await expect(page).toHaveURL(`${ORIGINS.fondsA}/login`);
    // De stub zag precies één authorize en één tokenwissel met de juiste vorm.
    const v1 = await stubVerzoeken(page);
    expect(v1.filter((v) => v.soort === "token")).toHaveLength(1);
    expect(v1.find((v) => v.soort === "authorize")).toMatchObject({ scope: "openid profile", code_challenge_method: "S256", client_id_ok: true });

    // Replay van exact dezelfde callback: transactie is verbruikt → neutraal, geen nieuwe tokenwissel.
    expect(callbackUrl).toMatch(/code=/);
    await page.goto(callbackUrl);
    await expect(page).toHaveURL(/\/login\?fout=microsoft/);
    expect((await stubVerzoeken(page)).filter((v) => v.soort === "token")).toHaveLength(1);
  });

  test("kapotte of verlopen state → neutrale melding zonder tokenwissel", async ({ page }) => {
    await stubReset(page);
    await page.goto(`${ORIGINS.fondsA}/auth/microsoft-login/callback?code=abc&state=bestaat-niet`);
    await expect(page).toHaveURL(/\/login\?fout=microsoft/);
    await expect(page.locator('div[role="alert"]')).toContainText(LOGIN_MICROSOFT_MELDING);
    expect((await stubVerzoeken(page)).filter((v) => v.soort === "token")).toHaveLength(0);
  });

  test("gastaccount (acct=1) en een tokenresponse met refresh_token worden geweigerd", async ({ page }) => {
    await stubReset(page, { acct: 1 });
    await loginViaKnop(page);
    await expect(page).toHaveURL(/\/login\?fout=microsoft/);
    await stubReset(page, { metRefreshToken: true });
    await loginViaKnop(page);
    await expect(page).toHaveURL(/\/login\?fout=microsoft/);
    await page.goto(`${ORIGINS.fondsA}/`);
    await expect(page).toHaveURL(`${ORIGINS.fondsA}/login`);
  });

  test("gebruiker weigert bij de provider → neutrale melding", async ({ page }) => {
    const a = await page.request.get(`${ORIGINS.fondsA}/auth/microsoft-login/start`, { maxRedirects: 0 });
    const naar = new URL(a.headers()["location"]!);
    naar.searchParams.set("e2e_error", "access_denied");
    await page.goto(naar.toString());
    await expect(page).toHaveURL(/\/login\?fout=microsoft/);
  });

  test("koppel-start en koppelstatus eisen een sessie (401, exact het bestaande contract)", async ({ page }) => {
    for (const pad of ["/api/microsoft-login/koppelen/start", "/api/microsoft-login/koppeling"]) {
      const r = await page.request.get(`${ORIGINS.fondsA}${pad}`, { maxRedirects: 0 });
      expect(r.status()).toBe(401);
      expect(await r.json()).toEqual({ error: "Niet ingelogd" });
    }
  });
});

test.describe("MS-LOGIN — fonds A bestuurder (wachtwoordsessie)", () => {
  test.use({ storageState: authStateBestand("a", "bestuurder") });

  test("profielkaart zichtbaar op A, status 'geen'; op B is de koppeling niet beschikbaar", async ({ page }) => {
    const a = await page.request.get(`${ORIGINS.fondsA}/api/microsoft-login/koppeling`);
    expect(a.status()).toBe(200);
    expect(await a.json()).toMatchObject({ beschikbaar: true, status: "geen" });
    await page.goto(`${ORIGINS.fondsA}/profiel`);
    await expect(page.getByRole("heading", { name: "Inloggen met Microsoft" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Koppel Microsoft-account" })).toHaveAttribute("href", "/api/microsoft-login/koppelen/start");
  });

  test("koppel-start → 302 naar de stub; koppelflow reserveert en faalt neutraal op de lokale GoTrue (geen azure-provider); wachtwoordsessie blijft", async ({ page }) => {
    await stubReset(page);
    const start = await page.request.get(`${ORIGINS.fondsA}/api/microsoft-login/koppelen/start`, { maxRedirects: 0 });
    expect(start.status()).toBe(307);
    const naar = new URL(start.headers()["location"]!);
    expect(naar.origin).toBe(STUB);
    expect(naar.searchParams.get("scope")).toBe("openid profile");

    await page.goto(naar.toString());
    await expect(page).toHaveURL(/\/profiel\?microsoft_login=fout&c=koppelen&sc=[A-Z0-9]{8}$/);
    await expect(page.getByRole("status")).toContainText(/Koppelen is niet gelukt/);
    // Reservering is failed of afwezig — nooit pending/active: de kaart biedt opnieuw koppelen aan.
    await expect(page.getByRole("link", { name: "Koppel Microsoft-account" })).toBeVisible();
    // De wachtwoordsessie is intact (guard L3 raakt wachtwoordsessies niet).
    await page.goto(`${ORIGINS.fondsA}/`);
    await expect(page.getByText(/U bent bestuurslid van Synthetisch E2E Fonds A\./)).toBeVisible();
  });
});
