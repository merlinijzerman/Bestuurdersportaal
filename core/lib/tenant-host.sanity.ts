// ============================================================================
//  Sanity-tests voor de tenant-resolver (host→fonds, besluit 0040 B4).
//  Fail-closed gedrag + host-normalisatie identiek aan platform-host.
//
//  Uitvoeren: npx tsx lib/tenant-host.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { bepaalFondsContext, type TenantDomain } from "./tenant-host";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("tenant-host sanity-tests:");

// Genormaliseerde mapping (zoals opgeslagen in public.tenant_domains): twee
// hosts naar verschillende fondsen + één bewust inactieve host.
const FONDS_A = "11111111-1111-1111-1111-111111111111";
const FONDS_B = "22222222-2222-2222-2222-222222222222";
const FONDS_INACTIEF = "33333333-3333-3333-3333-333333333333";
const domains: ReadonlyArray<TenantDomain> = [
  { host: "horizon.nl", fondsId: FONDS_A, actief: true },
  { host: "fonds-b.nl", fondsId: FONDS_B, actief: true },
  { host: "fonds-b.preview.bestuurdersportaal.com", fondsId: FONDS_B, actief: true },
  { host: "oud.nl", fondsId: FONDS_INACTIEF, actief: false },
];

// ── Exacte match ────────────────────────────────────────────────────────────
test("exacte match → juiste fondsId", () => {
  assert.deepEqual(bepaalFondsContext({ host: "horizon.nl", domains }), {
    type: "gevonden",
    fondsId: FONDS_A,
  });
});

test("fondsgerichte previewhost met genest subdomein resolveert exact", () => {
  assert.deepEqual(
    bepaalFondsContext({
      host: "fonds-b.preview.bestuurdersportaal.com",
      domains,
    }),
    { type: "gevonden", fondsId: FONDS_B }
  );
  assert.deepEqual(
    bepaalFondsContext({
      host: "onbekend.preview.bestuurdersportaal.com",
      domains,
    }),
    { type: "onbekend" }
  );
});

// ── Host-normalisatie: www., hoofdletters, poort → zelfde match als kaal ─────
test("www.-prefix → zelfde match als kaal", () => {
  assert.deepEqual(bepaalFondsContext({ host: "www.horizon.nl", domains }), {
    type: "gevonden",
    fondsId: FONDS_A,
  });
});

test("hoofdletters → zelfde match (case-insensitive)", () => {
  assert.deepEqual(bepaalFondsContext({ host: "Horizon.NL", domains }), {
    type: "gevonden",
    fondsId: FONDS_A,
  });
});

test("poort (Host.NL:3000) → zelfde match, poort genegeerd", () => {
  assert.deepEqual(bepaalFondsContext({ host: "Horizon.NL:3000", domains }), {
    type: "gevonden",
    fondsId: FONDS_A,
  });
  // Combinatie www. + hoofdletters + poort.
  assert.deepEqual(bepaalFondsContext({ host: "WWW.Horizon.NL:443", domains }), {
    type: "gevonden",
    fondsId: FONDS_A,
  });
});

// ── Fail-closed ─────────────────────────────────────────────────────────────
test("onbekende host → onbekend (geen fallback, geen 'eerste fonds')", () => {
  assert.deepEqual(bepaalFondsContext({ host: "onbekend.nl", domains }), {
    type: "onbekend",
  });
});

test("null/lege/whitespace host → onbekend", () => {
  assert.deepEqual(bepaalFondsContext({ host: null, domains }), { type: "onbekend" });
  assert.deepEqual(bepaalFondsContext({ host: undefined, domains }), { type: "onbekend" });
  assert.deepEqual(bepaalFondsContext({ host: "", domains }), { type: "onbekend" });
  assert.deepEqual(bepaalFondsContext({ host: "   ", domains }), { type: "onbekend" });
});

test("host staat in tabel maar actief=false → onbekend (fail-closed)", () => {
  assert.deepEqual(bepaalFondsContext({ host: "oud.nl", domains }), { type: "onbekend" });
  assert.deepEqual(bepaalFondsContext({ host: "www.OUD.nl:3000", domains }), { type: "onbekend" });
});

test("lege mapping → altijd onbekend (nooit een default-fonds)", () => {
  assert.deepEqual(bepaalFondsContext({ host: "horizon.nl", domains: [] }), { type: "onbekend" });
});

// ── Geen kruisbesmetting ────────────────────────────────────────────────────
test("twee hosts → elk het juiste fonds (geen kruisbesmetting, geen 'eerste')", () => {
  assert.deepEqual(bepaalFondsContext({ host: "horizon.nl", domains }), {
    type: "gevonden",
    fondsId: FONDS_A,
  });
  assert.deepEqual(bepaalFondsContext({ host: "fonds-b.nl", domains }), {
    type: "gevonden",
    fondsId: FONDS_B,
  });
});

console.log(`\n${n} sanity-tests geslaagd.`);
