// ============================================================================
//  Sanity-tests voor de hostname-routing (3 surfaces, variant B).
//  Platform: TO P0 §3.3 (tests 12/18a/18b). Marketing/app: TO publieke
//  voorkant §2.1/§2.5.
//
//  Uitvoeren: npx tsx lib/platform-host.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { isPlatformHost, bepaalSurface, bepaalRoute, PLATFORM_PREFIX } from "./platform-host";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("platform-host sanity-tests:");

// ── isPlatformHost (ongewijzigd, behouden) ─────────────────────────────────
test("isPlatformHost matcht exact (poort genegeerd, case-insensitive)", () => {
  assert.equal(isPlatformHost("beheer.fonds.nl", "beheer.fonds.nl"), true);
  assert.equal(isPlatformHost("BEHEER.fonds.nl:443", "beheer.fonds.nl"), true);
  assert.equal(isPlatformHost("app.fonds.nl", "beheer.fonds.nl"), false);
});

test("isPlatformHost faalt veilig bij ontbrekende config/host", () => {
  assert.equal(isPlatformHost(null, "beheer.fonds.nl"), false);
  assert.equal(isPlatformHost("beheer.fonds.nl", undefined), false);
  assert.equal(isPlatformHost(null, null), false);
});

// Concrete vastgelegde hosts (env-waarden, NIET hardcoded in code):
//   productie MARKETING_HOST = bestuurdersportaal.com (incl. www.)
//   productie APP_HOST       = app.bestuurdersportaal.com
//   productie PLATFORM_HOST  = beheer.bestuurdersportaal.com
const MARKETING = "bestuurdersportaal.com";
const APP = "app.bestuurdersportaal.com";
const PLATFORM = "beheer.bestuurdersportaal.com";
const env = { marketingHost: MARKETING, appHost: APP, platformHost: PLATFORM };

// ── bepaalSurface ──────────────────────────────────────────────────────────
test("surface: apex én www. → marketing", () => {
  assert.equal(bepaalSurface({ host: "bestuurdersportaal.com", ...env }), "marketing");
  assert.equal(bepaalSurface({ host: "www.bestuurdersportaal.com", ...env }), "marketing");
  assert.equal(bepaalSurface({ host: "WWW.Bestuurdersportaal.com:443", ...env }), "marketing");
});

test("surface: app-host → app, beheer-host → platform", () => {
  assert.equal(bepaalSurface({ host: "app.bestuurdersportaal.com", ...env }), "app");
  assert.equal(bepaalSurface({ host: "beheer.bestuurdersportaal.com", ...env }), "platform");
});

test("surface: onbekende host → fail-safe 'app' (preview/lokaal)", () => {
  assert.equal(bepaalSurface({ host: "iets-anders.vercel.app", ...env }), "app");
  assert.equal(bepaalSurface({ host: "localhost:3000", ...env }), "app");
  assert.equal(bepaalSurface({ host: null, ...env }), "app");
});

test("surface: ontbrekend env-contract → 'app' (geen marketing/platform-lek)", () => {
  // Zonder MARKETING_HOST blijft de apex 'app' (A1: cutover env-gedreven).
  assert.equal(
    bepaalSurface({ host: "bestuurdersportaal.com", appHost: APP, platformHost: PLATFORM }),
    "app"
  );
  // Volledig zonder config: alles 'app', platform fail-closed.
  assert.equal(bepaalSurface({ host: "bestuurdersportaal.com" }), "app");
  assert.equal(bepaalSurface({ host: "beheer.bestuurdersportaal.com" }), "app");
});

test("surface: platform fail-closed — lege PLATFORM_HOST opent platform nooit", () => {
  for (const ph of [undefined, "", null] as const) {
    assert.equal(
      bepaalSurface({ host: "beheer.bestuurdersportaal.com", marketingHost: MARKETING, appHost: APP, platformHost: ph }),
      "app"
    );
  }
});

test("surface: app-precedentie boven marketing voorkomt redirect-lus bij misconfig", () => {
  // Als APP_HOST == MARKETING_HOST (foutconfig), wint 'app' → /login rendert,
  // redirect niet → geen lus.
  assert.equal(
    bepaalSurface({ host: "bestuurdersportaal.com", marketingHost: MARKETING, appHost: MARKETING, platformHost: PLATFORM }),
    "app"
  );
});

// Lokale hosts (variant B): app op localhost, platform op beheer.localhost.
test("surface lokaal: localhost → app, beheer.localhost → platform", () => {
  const lokaal = { marketingHost: "marketing.localhost:3000", appHost: "localhost:3000", platformHost: "beheer.localhost:3000" };
  assert.equal(bepaalSurface({ host: "localhost:3000", ...lokaal }), "app");
  assert.equal(bepaalSurface({ host: "beheer.localhost:3000", ...lokaal }), "platform");
  assert.equal(bepaalSurface({ host: "marketing.localhost:3000", ...lokaal }), "marketing");
});

// ── bepaalRoute: marketing-surface ─────────────────────────────────────────
test("marketing: /login → redirectLogin (backward-compat, AC-10/11)", () => {
  assert.deepEqual(bepaalRoute({ surface: "marketing", pathname: "/login" }), {
    type: "redirectLogin",
  });
});

test("marketing: app-pad /dashboard → 404 (REQ-PV-050/051, geen lek)", () => {
  assert.deepEqual(bepaalRoute({ surface: "marketing", pathname: "/dashboard" }), {
    type: "notFound",
  });
});

test("marketing: platform-pad → 404", () => {
  assert.deepEqual(bepaalRoute({ surface: "marketing", pathname: "/platform" }), {
    type: "notFound",
  });
  assert.deepEqual(bepaalRoute({ surface: "marketing", pathname: "/platform/login" }), {
    type: "notFound",
  });
});

test("marketing: overige paden (W0, nog geen (public)) → 404, nooit homepage", () => {
  assert.deepEqual(bepaalRoute({ surface: "marketing", pathname: "/" }), { type: "notFound" });
  assert.deepEqual(bepaalRoute({ surface: "marketing", pathname: "/contact" }), { type: "notFound" });
});

// ── bepaalRoute: app-surface (bestaand tenant-gedrag, ongewijzigd) ──────────
test("app: tenant-routes gaan door", () => {
  assert.deepEqual(bepaalRoute({ surface: "app", pathname: "/" }), { type: "door" });
  assert.deepEqual(bepaalRoute({ surface: "app", pathname: "/dashboard" }), { type: "door" });
  assert.deepEqual(bepaalRoute({ surface: "app", pathname: "/login" }), { type: "door" });
});

test("app: /platform/* → 404 (platform onbereikbaar op app-host)", () => {
  assert.deepEqual(bepaalRoute({ surface: "app", pathname: "/platform" }), { type: "notFound" });
  assert.deepEqual(bepaalRoute({ surface: "app", pathname: "/platform/login" }), { type: "notFound" });
});

// ── bepaalRoute: platform-surface (TO P0, tests 12/18a/18b) ─────────────────
test("platform: wortel → rewrite /platform", () => {
  assert.deepEqual(bepaalRoute({ surface: "platform", pathname: "/" }), {
    type: "rewrite",
    naar: PLATFORM_PREFIX,
  });
});

test("platform: /login → rewrite /platform/login (test 12)", () => {
  assert.deepEqual(bepaalRoute({ surface: "platform", pathname: "/login" }), {
    type: "rewrite",
    naar: "/platform/login",
  });
});

test("platform: tenant-pad /dashboard → rewrite /platform/dashboard (bestaat niet → 404) (test 18b)", () => {
  assert.deepEqual(bepaalRoute({ surface: "platform", pathname: "/dashboard" }), {
    type: "rewrite",
    naar: "/platform/dashboard",
  });
});

test("platform: direct /platform/* toegestaan (stabiel redirect-doel)", () => {
  assert.deepEqual(bepaalRoute({ surface: "platform", pathname: "/platform" }), { type: "door" });
  assert.deepEqual(bepaalRoute({ surface: "platform", pathname: "/platform/login" }), { type: "door" });
});

console.log(`\n${n} sanity-tests geslaagd.`);
