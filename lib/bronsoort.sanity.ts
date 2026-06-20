// ============================================================================
//  Sanity-tests voor lib/bronsoort.ts (Increment C+/B13).
//  Dekt: normgewicht-validatie/-label, isVervallen (peildatum-grens) en
//  bronkaartLabels (generiek-badge + "Vervallen per …").
//
//  Uitvoeren: npx tsx lib/bronsoort.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  isGeldigNormgewicht,
  normgewichtLabel,
  isVervallen,
  bronkaartLabels,
  isVeiligeUrl,
} from "./bronsoort";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("bronsoort sanity-tests:");

// ── normgewicht ─────────────────────────────────────────────
test("geldig normgewicht wordt herkend", () => {
  assert.equal(isGeldigNormgewicht("bindend"), true);
  assert.equal(isGeldigNormgewicht("sector_guidance"), true);
});

test("ongeldig/leeg normgewicht wordt geweigerd", () => {
  assert.equal(isGeldigNormgewicht("zwaarwegend"), false);
  assert.equal(isGeldigNormgewicht(""), false);
  assert.equal(isGeldigNormgewicht(null), false);
  assert.equal(isGeldigNormgewicht(undefined), false);
});

test("normgewichtLabel: NULL/onbekend → 'Onbekend'", () => {
  assert.equal(normgewichtLabel(null), "Onbekend");
  assert.equal(normgewichtLabel(undefined), "Onbekend");
  assert.equal(normgewichtLabel("onbekend"), "Onbekend");
  assert.equal(normgewichtLabel("bindend"), "Bindend");
});

// ── isVervallen ─────────────────────────────────────────────
test("geen geldig_tot ≡ niet vervallen", () => {
  assert.equal(isVervallen(null), false);
  assert.equal(isVervallen(undefined), false);
});

test("geldig_tot vóór peildatum → vervallen", () => {
  const peil = new Date("2026-06-20");
  assert.equal(isVervallen("2025-01-01", peil), true);
});

test("geldig_tot op of na peildatum → niet vervallen (inclusief)", () => {
  const peil = new Date("2026-06-20");
  assert.equal(isVervallen("2026-06-20", peil), false); // geldig_tot inclusief
  assert.equal(isVervallen("2027-01-01", peil), false);
});

test("ongeldige datumstring breekt niet (→ niet vervallen)", () => {
  assert.equal(isVervallen("geen-datum"), false);
});

// ── bronkaartLabels ─────────────────────────────────────────
test("generiek → bronsoort-badge 'Generiek / extern kader'", () => {
  const l = bronkaartLabels({ bibliotheek: "generiek" });
  assert.equal(l.isGeneriek, true);
  assert.equal(l.bronsoortLabel, "Generiek / extern kader");
});

test("fonds → geen bronsoort-badge", () => {
  const l = bronkaartLabels({ bibliotheek: "fonds" });
  assert.equal(l.isGeneriek, false);
  assert.equal(l.bronsoortLabel, null);
});

test("normgewicht NULL → label 'Onbekend' in bronkaart", () => {
  const l = bronkaartLabels({ bibliotheek: "generiek", normgewicht: null });
  assert.equal(l.normgewichtLabel, "Onbekend");
});

test("vervallen generiek doc → 'Vervallen per [datum]'", () => {
  const peil = new Date("2026-06-20");
  const l = bronkaartLabels(
    { bibliotheek: "generiek", geldig_tot: "2025-01-01", normgewicht: "bindend" },
    peil
  );
  assert.equal(l.vervallen, true);
  assert.equal(l.vervallenLabel, "Vervallen per 2025-01-01");
  assert.equal(l.normgewichtLabel, "Bindend");
});

test("nog geldig generiek doc → geen vervallen-label", () => {
  const peil = new Date("2026-06-20");
  const l = bronkaartLabels({ bibliotheek: "generiek", geldig_tot: "2027-01-01" }, peil);
  assert.equal(l.vervallen, false);
  assert.equal(l.vervallenLabel, null);
});

// ── isVeiligeUrl (XSS-hardening) ────────────────────────────
test("http(s)-URL's zijn veilig", () => {
  assert.equal(isVeiligeUrl("https://www.dnb.nl/leidraad"), true);
  assert.equal(isVeiligeUrl("http://example.org"), true);
});

test("javascript:/data:/leeg/non-URL worden geweigerd", () => {
  assert.equal(isVeiligeUrl("javascript:alert(1)"), false);
  assert.equal(isVeiligeUrl("data:text/html,<script>"), false);
  assert.equal(isVeiligeUrl(""), false);
  assert.equal(isVeiligeUrl("   "), false);
  assert.equal(isVeiligeUrl("geen url"), false);
  assert.equal(isVeiligeUrl(null), false);
});

console.log(`\n${n} bronsoort sanity-tests geslaagd.`);
