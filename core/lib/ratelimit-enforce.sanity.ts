// ============================================================================
//  Sanity-tests voor de pure rate-limit-beoordeling (W10, EPIC W, deploy 3).
//
//  Alles hier is server-loos: `ratelimit-enforce.ts` importeert UITSLUITEND
//  types uit rate-limit.ts, dus deze suite draait onder tsx zonder de
//  server-only-keten (`logAppFout`) mee te trekken. De DB-teller zelf wordt
//  hier niet geraakt — die is geïnjecteerd in de wrapper en wordt daar getest.
//
//  Vier dingen worden gemeten:
//    1. de env-schakelaar — kale opt-in, en de tegenproef dat hij NIET op de
//       omgeving leunt (zoals capability-enforce);
//    2. `wrapperTeltVoor` — de gedeelde-resource-regel: alleen een LimietNaam
//       laat de wrapper de teller raken; "geen"/"route-eigen" niet;
//    3. `beoordeelRateLimitUitkomst` — door/observe/weiger, vlag-bewust;
//    4. de fail-closed set — exact de vijf H-12-endpoints, niet meer, niet minder.
//
//  Uitvoeren: npx tsx core/lib/ratelimit-enforce.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  beoordeelRateLimitUitkomst,
  FAIL_CLOSED_LIMIETEN,
  isFailClosed,
  ratelimitEnforceVoorOmgeving,
  wrapperTeltVoor,
} from "./ratelimit-enforce";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("ratelimit-enforce sanity-tests:");

// ── 1. De env-schakelaar ─────────────────────────────────────────────────────

test("alleen ENFORCE_RATELIMIT=on zet de poort aan", () => {
  assert.equal(ratelimitEnforceVoorOmgeving({ enforceRateLimit: "on" }), true);
  assert.equal(ratelimitEnforceVoorOmgeving({ enforceRateLimit: " ON " }), true);
  assert.equal(ratelimitEnforceVoorOmgeving({ enforceRateLimit: "off" }), false);
  assert.equal(ratelimitEnforceVoorOmgeving({ enforceRateLimit: "" }), false);
  assert.equal(ratelimitEnforceVoorOmgeving({ enforceRateLimit: null }), false);
  assert.equal(ratelimitEnforceVoorOmgeving({}), false);
});

test("de schakelaar leunt NIET op de omgeving — kale opt-in", () => {
  // Tegenproef op de verleiding om productie/preview automatisch aan te zetten.
  // Een variabele (geen object-literal) zodat de excess-property-check passeert
  // en de assertie het RUNTIME-gedrag toetst: de functie kijkt naar geen van
  // deze velden.
  const omgevingsInvoer = {
    enforceRateLimit: undefined,
    vercelEnv: "production",
    vercelTargetEnv: "preview",
    deployTarget: "staging",
  };
  assert.equal(
    ratelimitEnforceVoorOmgeving(omgevingsInvoer),
    false,
    "een beschermde omgeving mag de poort in W10 niet stil aanzetten"
  );
});

// ── 2. De gedeelde-resource-regel (besluit 0190) ─────────────────────────────

test("wrapperTeltVoor: alleen een LimietNaam laat de wrapper tellen", () => {
  assert.equal(wrapperTeltVoor("chat"), true);
  assert.equal(wrapperTeltVoor("zoeken"), true);
  // "geen" en "route-eigen" → wrapper doet niets, en telt dus ook niet: zo tikt
  // een zelf-limiterende route zijn gedeelde teller niet dubbel op.
  assert.equal(wrapperTeltVoor("geen"), false);
  assert.equal(wrapperTeltVoor("route-eigen"), false);
});

// ── 3. De vlag-bewuste uitkomst ──────────────────────────────────────────────

test("toegestaan → altijd door, ongeacht de vlag", () => {
  const b = { toegestaan: true, resterend: 5, resetAt: null };
  assert.deepEqual(beoordeelRateLimitUitkomst({ beslissing: b, handhaven: false }), { actie: "door" });
  assert.deepEqual(beoordeelRateLimitUitkomst({ beslissing: b, handhaven: true }), { actie: "door" });
});

test("geweigerd + vlag UIT → observe (loggen, niet weigeren)", () => {
  const reset = new Date("2026-01-01T00:00:00Z");
  const u = beoordeelRateLimitUitkomst({
    beslissing: { toegestaan: false, resterend: 0, resetAt: reset },
    handhaven: false,
  });
  assert.deepEqual(u, { actie: "observe", resetAt: reset });
});

test("geweigerd + vlag AAN → weiger (429), met resetAt", () => {
  const reset = new Date("2026-01-01T00:00:00Z");
  const u = beoordeelRateLimitUitkomst({
    beslissing: { toegestaan: false, resterend: 0, resetAt: reset },
    handhaven: true,
  });
  assert.deepEqual(u, { actie: "weiger", resetAt: reset });
});

// ── 4. De fail-closed set (H-12) ─────────────────────────────────────────────

test("fail-closed = exact de vijf H-12-endpoints", () => {
  assert.deepEqual(
    [...FAIL_CLOSED_LIMIETEN].sort(),
    ["backfill", "chat", "her_extract", "segmenteer", "zoeken"],
    "de fail-closed set moet exact chat/zoeken/her_extract/backfill/segmenteer zijn"
  );
  assert.equal(FAIL_CLOSED_LIMIETEN.size, 5);
});

test("isFailClosed: waar voor de vijf, onwaar voor een kostenvrije route", () => {
  for (const naam of ["chat", "zoeken", "her_extract", "backfill", "segmenteer"] as const) {
    assert.equal(isFailClosed(naam), true, `${naam} hoort fail-closed te zijn`);
  }
  assert.equal(isFailClosed("upload"), false);
  assert.equal(isFailClosed("voorbereiding"), false);
});

console.log(`\n${n} sanity-tests geslaagd.`);
