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
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
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
    // Alleen het meldingsblok van het formulier; Next injecteert na een navigatie
    // óók een role="alert" (route-announcer), dus niet op rol selecteren.
    const alert = page.locator("#login-melding");
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
    await expect(page.locator("#login-melding")).toContainText(LOGIN_MICROSOFT_MELDING);
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

// ── #344 PR-B — beheer-UI en de herstelflow via uitnodigingslink ────────────
// Het token staat uitsluitend in het URL-FRAGMENT van /koppelen en wordt alleen
// via de body van een POST naar /auth/microsoft-login/uitnodiging verzilverd.
// Let op de gedeelde V9-startlimiet (20 per 10 min per IP+host): deze suite
// verbruikt er zes; de #335-tests hierboven circa zeven.
const HERKOPPEL_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UITNODIGING_ONGELDIG = { error: "Deze uitnodiging is niet (meer) geldig. Vraag uw beheerder om een nieuwe." };
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test.describe("MS-LOGIN — #344 beheer en herstel via uitnodiging", () => {
  // Anonieme browser; het beheer loopt via een aparte request-context met de beheerderssessie.
  test.use({ storageState: { cookies: [], origins: [] } });

  async function beheerContext(): Promise<APIRequestContext> {
    return request.newContext({ storageState: authStateBestand("a", "beheerder") });
  }

  /** Geeft als beheerder een uitnodiging uit voor de bestuurder van fonds A en retourneert het token uit het fragment. */
  async function uitnodigingVoorBestuurder(beheer: APIRequestContext): Promise<{ token: string; link: string; doelUserId: string }> {
    const beleid = await (await beheer.get(`${ORIGINS.fondsA}/api/microsoft-login/beheer/beleid`)).json();
    const doel = (beleid.dekking as Array<{ userId: string; rol: string | null }>).find((d) => d.rol === "bestuurder");
    expect(doel, "bestuurder ontbreekt in het dekkingsrapport").toBeTruthy();
    const r = await beheer.post(`${ORIGINS.fondsA}/api/microsoft-login/beheer/uitnodiging`, { data: { doelUserId: doel!.userId } });
    expect(r.status()).toBe(200);
    const body = await r.json();
    const u = new URL(body.link);
    expect(u.origin).toBe(ORIGINS.fondsA);
    expect(u.pathname).toBe("/koppelen");
    expect(u.search).toBe("");
    const token = u.hash.slice(1);
    expect(token).toMatch(HERKOPPEL_TOKEN_RE);
    return { token, link: body.link, doelUserId: doel!.userId };
  }

  test("GET beleid: beheerder krijgt modus + tenantGeconfigureerd, nooit de tenant-id; bestuurder krijgt 403; anoniem 401", async ({ page }) => {
    const beheer = await beheerContext();
    const r = await beheer.get(`${ORIGINS.fondsA}/api/microsoft-login/beheer/beleid`);
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toBe("no-store");
    const body = await r.json();
    expect(body).toMatchObject({ beschikbaar: true, modus: "optioneel", tenantGeconfigureerd: true });
    expect(body).not.toHaveProperty("entraTenantId");
    expect(JSON.stringify(body)).not.toContain(E2E_OIDC.tenantId);
    expect(body.dekking.map((d: { rol: string }) => d.rol)).toContain("bestuurder");
    await beheer.dispose();

    const bestuurder = await request.newContext({ storageState: authStateBestand("a", "bestuurder") });
    const b = await bestuurder.get(`${ORIGINS.fondsA}/api/microsoft-login/beheer/beleid`);
    expect(b.status()).toBe(403);
    await bestuurder.dispose();

    const anoniem = await page.request.get(`${ORIGINS.fondsA}/api/microsoft-login/beheer/beleid`);
    expect(anoniem.status()).toBe(401);
  });

  test("beheerpagina: zichtbaar voor de beheerder zonder tenant-id; de bestuurder krijgt een 404", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authStateBestand("a", "beheerder") });
    const page = await ctx.newPage();
    await page.goto(`${ORIGINS.fondsA}/beheer/microsoft-login`);
    await expect(page.getByRole("heading", { name: "Microsoft-login" })).toBeVisible();
    await expect(page.getByText(/Microsoft-tenant: geconfigureerd/)).toBeVisible();
    await expect(page.getByRole("radio", { name: /Optioneel/ })).toBeChecked();
    expect(await page.content()).not.toContain(E2E_OIDC.tenantId);
    // Afronden is een aparte, nadrukkelijke actie — geen checkbox naast de standaardintrekking.
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await ctx.close();

    const ctx2 = await browser.newContext({ storageState: authStateBestand("a", "bestuurder") });
    const page2 = await ctx2.newPage();
    await page2.goto(`${ORIGINS.fondsA}/beheer/microsoft-login`);
    // Bestaand beheerpatroon: `vereisModuleToegang` geeft een 404 (geen orakel over het bestaan van de pagina).
    await expect(page2.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page2.getByRole("heading", { name: "Microsoft-login" })).toHaveCount(0);
    expect(await page2.content()).not.toContain(E2E_OIDC.tenantId);
    await ctx2.close();
  });

  test("uitnodigingslink: token alleen in het fragment; GET /koppelen (linkpreview) verbruikt niets; POST activeert precies eenmaal; replay = dezelfde neutrale fout", async ({ page }) => {
    const beheer = await beheerContext();
    const { token, link } = await uitnodigingVoorBestuurder(beheer);

    // Een "linkpreview": kale GET van de pagina (het fragment gaat nooit mee naar de server).
    const preview = await page.request.get(`${ORIGINS.fondsA}/koppelen`);
    expect(preview.status()).toBe(200);
    expect(preview.headers()["cache-control"]).toContain("no-store");
    expect(preview.headers()["referrer-policy"]).toBe("no-referrer");
    const html = await preview.text();
    expect(html).not.toContain(token);
    expect(html).not.toMatch(/vercel\/analytics|_vercel\/insights/);

    // De browser: fragment wordt direct gewist, het token staat nergens in de DOM, en niets is verbruikt zonder klik.
    const verzoeken: string[] = [];
    page.on("request", (r) => verzoeken.push(`${r.method()} ${r.url()}`));
    await page.goto(link);
    await expect(page.getByRole("button", { name: "Herstel starten" })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
    expect(await page.content()).not.toContain(token);
    expect(verzoeken.some((v) => v.includes(token))).toBe(false);
    expect(verzoeken.some((v) => v.startsWith("POST"))).toBe(false);

    // Activering via de knop: één POST met het token in de body — en dat slaagt, dus de GET's verbruikten niets.
    const [post] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/auth/microsoft-login/uitnodiging") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Herstel starten" }).click(),
    ]);
    expect(post.status()).toBe(200);
    expect(post.request().postDataJSON()).toEqual({ token });
    expect(post.request().url()).not.toContain(token);
    expect(post.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.getByRole("link", { name: "Naar inloggen" })).toHaveAttribute("href", "/login");
    expect(await page.content()).not.toContain(token);

    // Replay van hetzelfde token: dezelfde neutrale fout als een willekeurig ongeldig token.
    const replay = await page.request.post(`${ORIGINS.fondsA}/auth/microsoft-login/uitnodiging`, { data: { token } });
    expect(replay.status()).toBe(403);
    expect(await replay.json()).toEqual(UITNODIGING_ONGELDIG);
    await beheer.dispose();
  });

  test("gelijktijdige activering: exact één van twee parallelle POSTs slaagt", async ({ page }) => {
    const beheer = await beheerContext();
    const { token } = await uitnodigingVoorBestuurder(beheer);
    const [a, b] = await Promise.all([
      page.request.post(`${ORIGINS.fondsA}/auth/microsoft-login/uitnodiging`, { data: { token } }),
      page.request.post(`${ORIGINS.fondsA}/auth/microsoft-login/uitnodiging`, { data: { token } }),
    ]);
    const statussen = [a.status(), b.status()].sort();
    expect(statussen).toEqual([200, 403]);
    const geweigerd = a.status() === 403 ? a : b;
    expect(await geweigerd.json()).toEqual(UITNODIGING_ONGELDIG);
    await beheer.dispose();
  });

  test("ongeldig token, lege body, fonds zonder flag en GET geven niets prijs; token staat niet in het pad", async ({ page }) => {
    const vals = await page.request.post(`${ORIGINS.fondsA}/auth/microsoft-login/uitnodiging`, { data: { token: "x".repeat(43) } });
    expect(vals.status()).toBe(403);
    expect(await vals.json()).toEqual(UITNODIGING_ONGELDIG);
    expect(vals.headers()["cache-control"]).toBe("no-store");
    expect(vals.headers()["referrer-policy"]).toBe("no-referrer");

    const leeg = await page.request.post(`${ORIGINS.fondsA}/auth/microsoft-login/uitnodiging`, { data: {} });
    expect(leeg.status()).toBe(403);
    expect(await leeg.json()).toEqual(UITNODIGING_ONGELDIG);

    const zonderFlag = await page.request.post(`${ORIGINS.fondsB}/auth/microsoft-login/uitnodiging`, { data: { token: "x".repeat(43) } });
    expect(zonderFlag.status()).toBe(404);

    const get = await page.request.get(`${ORIGINS.fondsA}/auth/microsoft-login/uitnodiging`, { maxRedirects: 0 });
    expect(get.status()).toBe(405);

    const pad = await page.request.get(`${ORIGINS.fondsA}/koppelen/${"x".repeat(43)}`, { maxRedirects: 0 });
    expect(pad.status()).toBe(404);
  });

  test("beheerintrekking: standaard zonder afronden; uitnodiging intrekken; onbekend doel → 409 zonder details", async () => {
    const beheer = await beheerContext();
    const { doelUserId } = await uitnodigingVoorBestuurder(beheer);
    const intrekken = await beheer.delete(`${ORIGINS.fondsA}/api/microsoft-login/beheer/uitnodiging`, { data: { doelUserId } });
    expect(intrekken.status()).toBe(200);
    const nogmaals = await beheer.delete(`${ORIGINS.fondsA}/api/microsoft-login/beheer/uitnodiging`, { data: { doelUserId } });
    expect(nogmaals.status()).toBe(409);
    // Geen actieve binding voor de bestuurder in E2E: intrekking wordt geweigerd met een categorie, zonder tenant- of identiteitsgegevens.
    const r = await beheer.post(`${ORIGINS.fondsA}/api/microsoft-login/beheer/intrekking`, { data: { doelUserId } });
    expect([200, 409]).toContain(r.status());
    expect(JSON.stringify(await r.json())).not.toMatch(UUID_RE);
    await beheer.dispose();
  });
});
