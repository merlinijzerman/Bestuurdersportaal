// ============================================================================
//  Sanity-tests voor de hostname-routing (TO §3.3, tests 12/18a/18b).
//
//  Uitvoeren: npx tsx lib/platform-host.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { isPlatformHost, bepaalRoute, PLATFORM_PREFIX } from "./platform-host";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("platform-host sanity-tests:");

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
//   productie PLATFORM_HOST = beheer.bestuurdersportaal.com
//   lokaal    PLATFORM_HOST = beheer.localhost:3000
const PROD_PLATFORM = "beheer.bestuurdersportaal.com";
const PROD_APEX = "bestuurdersportaal.com";
const LOKAAL_PLATFORM = "beheer.localhost:3000";

test("concrete hosts: beheer matcht, apex niet (prod én lokaal)", () => {
  assert.equal(isPlatformHost(PROD_PLATFORM, PROD_PLATFORM), true);
  assert.equal(isPlatformHost(PROD_APEX, PROD_PLATFORM), false);
  // Lokaal: poort wordt genegeerd, dus beheer.localhost matcht ongeacht :3000.
  assert.equal(isPlatformHost("beheer.localhost", LOKAAL_PLATFORM), true);
  assert.equal(isPlatformHost("localhost:3000", LOKAAL_PLATFORM), false);
});

// Negatieve test (#4): lege/ontbrekende PLATFORM_HOST mag NOOIT platform-routes
// openzetten. Zonder env is elke host een tenant-host → /platform → 404.
test("fail-closed: lege/ontbrekende PLATFORM_HOST → /platform overal 404", () => {
  for (const env of [undefined, "", null] as const) {
    const platformHost = isPlatformHost(PROD_PLATFORM, env);
    assert.equal(platformHost, false);
    assert.deepEqual(bepaalRoute({ platformHost, pathname: "/platform" }), {
      type: "notFound",
    });
    assert.deepEqual(bepaalRoute({ platformHost, pathname: "/platform/login" }), {
      type: "notFound",
    });
  }
});

// Test 18a: platform-pad op de APEX-host (tenant) → 404, ook met env gezet.
test("18a: platform-pad op apex-host (bestuurdersportaal.com) → 404", () => {
  const platformHost = isPlatformHost(PROD_APEX, PROD_PLATFORM); // false
  assert.equal(platformHost, false);
  assert.deepEqual(bepaalRoute({ platformHost, pathname: "/platform" }), {
    type: "notFound",
  });
});

// Test 18b: tenant-pad op de BEHEER-host → bestaat niet onder /platform → 404.
test("18b: tenant-pad op beheer-host → rewrite /platform/dashboard (bestaat niet → 404)", () => {
  const platformHost = isPlatformHost(PROD_PLATFORM, PROD_PLATFORM); // true
  assert.equal(platformHost, true);
  assert.deepEqual(bepaalRoute({ platformHost, pathname: "/dashboard" }), {
    type: "rewrite",
    naar: "/platform/dashboard",
  });
});

// Test 12: schoon extern login-pad op de beheer-host → rewrite naar de
// platform-login (waar de gate een sessieloze bezoeker afhandelt).
test("12: /login op beheer-host → rewrite /platform/login (gate-redirectdoel)", () => {
  const platformHost = isPlatformHost(PROD_PLATFORM, PROD_PLATFORM); // true
  assert.deepEqual(bepaalRoute({ platformHost, pathname: "/login" }), {
    type: "rewrite",
    naar: "/platform/login",
  });
});

// ── Platform-host: rewrite naar /platform, tenant-paden bestaan daar niet ──
test("platform-host: wortel → rewrite /platform", () => {
  const b = bepaalRoute({ platformHost: true, pathname: "/" });
  assert.deepEqual(b, { type: "rewrite", naar: PLATFORM_PREFIX });
});

test("platform-host: /login → rewrite /platform/login", () => {
  const b = bepaalRoute({ platformHost: true, pathname: "/login" });
  assert.deepEqual(b, { type: "rewrite", naar: "/platform/login" });
});

test("platform-host: tenant-pad /dashboard → rewrite /platform/dashboard (bestaat niet → 404)", () => {
  const b = bepaalRoute({ platformHost: true, pathname: "/dashboard" });
  assert.deepEqual(b, { type: "rewrite", naar: "/platform/dashboard" });
});

test("platform-host: direct /platform/* toegestaan (stabiel redirect-doel)", () => {
  assert.deepEqual(bepaalRoute({ platformHost: true, pathname: "/platform" }), {
    type: "door",
  });
  assert.deepEqual(
    bepaalRoute({ platformHost: true, pathname: "/platform/login" }),
    { type: "door" }
  );
});

// ── Tenant-host: platform onbereikbaar, tenant ongemoeid ───────────────────
test("18b/12: /platform op tenant-host → 404", () => {
  assert.deepEqual(bepaalRoute({ platformHost: false, pathname: "/platform" }), {
    type: "notFound",
  });
  assert.deepEqual(
    bepaalRoute({ platformHost: false, pathname: "/platform/login" }),
    { type: "notFound" }
  );
});

test("tenant-host: tenant-routes gaan ongemoeid door", () => {
  assert.deepEqual(bepaalRoute({ platformHost: false, pathname: "/" }), {
    type: "door",
  });
  assert.deepEqual(bepaalRoute({ platformHost: false, pathname: "/dashboard" }), {
    type: "door",
  });
});

console.log(`\n${n} sanity-tests geslaagd.`);
