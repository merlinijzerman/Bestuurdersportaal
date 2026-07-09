// ============================================================================
//  §15-matrix — platform-routing: beheerder op platform-host vs fonds-host (T9/T10).
// ----------------------------------------------------------------------------
//  Toetst de PURE surface-/routebeslissing (lib/platform-host.ts) — defense-in-
//  depth naast de auth-gate + capability-wrapper. Importeert de bestaande
//  functies (geen duplicatie van lib/platform-host.sanity.ts); hier expliciet
//  als benoemde §15-scenario's.
//
//   T9  — platformbeheerder op de platform-host → platform-surface bereikbaar.
//   T10 — platformbeheerder op een fonds-host → de platform-back-office is NIET
//         bereikbaar (huidig ontwerp: /platform/* op de app/fonds-surface → 404).
//         "Alleen indien expliciet ontworpen" = nu bewust niet ontworpen.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/platform-routing.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { bepaalSurface, bepaalRoute } from "../../lib/platform-host";

const PLATFORM_HOST = "platform.example";
const FONDS_HOST = "horizon.nl"; // een tenant/app-host

test("T9 — platformbeheerder op platform-host → platform-surface, /platform-pad toegestaan", () => {
  const surface = bepaalSurface({ host: PLATFORM_HOST, platformHost: PLATFORM_HOST });
  assert.equal(surface, "platform");
  // Intern platform-pad is het stabiele redirect-doel voor de auth-gate → door.
  assert.deepEqual(bepaalRoute({ surface, pathname: "/platform/dashboard" }), {
    type: "door",
  });
  // Een schoon extern pad wordt naar de platform-routegroep gerewrite.
  assert.deepEqual(bepaalRoute({ surface, pathname: "/" }), {
    type: "rewrite",
    naar: "/platform",
  });
});

test("T10 — platformbeheerder op fonds-host → platform-back-office niet bereikbaar (404)", () => {
  // Een fonds-host resolveert naar de app-surface, nooit naar platform.
  const surface = bepaalSurface({
    host: FONDS_HOST,
    appHost: FONDS_HOST,
    platformHost: PLATFORM_HOST,
  });
  assert.equal(surface, "app");
  // /platform/* bestaat op de app-surface niet → 404 (geen platform-lek op de
  // fonds-host). Zo is T10 "alleen indien expliciet ontworpen" = nu geblokkeerd.
  assert.deepEqual(bepaalRoute({ surface, pathname: "/platform" }), {
    type: "notFound",
  });
  assert.deepEqual(bepaalRoute({ surface, pathname: "/platform/dashboard" }), {
    type: "notFound",
  });
});

test("T10 — negatieve controle: platform is nooit de fail-safe default", () => {
  // Een onbekende/onconfigureerde host valt naar 'app' (achter de auth-gate),
  // NOOIT naar 'platform'. Verzwakt iemand dat, dan surfacet dit rood.
  const surface = bepaalSurface({ host: "onbekend.example", platformHost: PLATFORM_HOST });
  assert.notEqual(surface, "platform");
  assert.equal(surface, "app");
});
