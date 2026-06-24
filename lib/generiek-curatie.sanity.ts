// ============================================================
//  Sanity-tests voor lib/generiek-curatie.ts (Increment P1/B14).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/generiek-curatie.sanity.ts
//  Verifieert: defaults, veld-/bronhygiene-validatie, datum-ordening en de
//  RAG-zichtbaarheidsregel (§8.3 #6 — informatief/onbekend niet standaard).
// ============================================================

import assert from "node:assert/strict";
import {
  valideerCuratie,
  isStandaardZichtbaarInRag,
  GENERIEK_DEFAULTS,
} from "./generiek-curatie";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("generiek-curatie sanity-tests:");

// ── RAG-zichtbaarheid (criterium #6) ───────────────────────────────────────
check("zwak normgewicht (informatief/onbekend/null) → niet standaard in RAG", () => {
  assert.equal(isStandaardZichtbaarInRag("informatief"), false);
  assert.equal(isStandaardZichtbaarInRag("onbekend"), false);
  assert.equal(isStandaardZichtbaarInRag(null), false);
  assert.equal(isStandaardZichtbaarInRag(undefined), false);
  assert.equal(isStandaardZichtbaarInRag("rcommelje"), false); // ongeldig → onbekend
});

check("sterk normgewicht → wél standaard in RAG", () => {
  assert.equal(isStandaardZichtbaarInRag("bindend"), true);
  assert.equal(isStandaardZichtbaarInRag("toezichtverwachting"), true);
  assert.equal(isStandaardZichtbaarInRag("sector_guidance"), true);
});

// ── Defaults bij minimale invoer ────────────────────────────────────────────
check("minimale invoer (alleen titel) krijgt de generieke defaults", () => {
  const r = valideerCuratie({ titel: "  DNB Beleidsregel  " });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.waarde.titel, "DNB Beleidsregel"); // getrimd
    assert.equal(r.waarde.bibliotheek, "generiek");
    assert.equal(r.waarde.context, "algemeen");
    assert.equal(r.waarde.fonds_id, null);
    assert.equal(r.waarde.bron, GENERIEK_DEFAULTS.bron);
    assert.equal(r.waarde.status, "van_kracht");
    assert.equal(r.waarde.bronstatus, "actief");
    assert.equal(r.waarde.normgewicht, "onbekend");
    assert.equal(r.waarde.regelingstype, "algemeen");
    assert.equal(r.waarde.bronorganisatie, null);
  }
});

// ── Verplichte titel ────────────────────────────────────────────────────────
check("ontbrekende titel → fout", () => {
  const r = valideerCuratie({ titel: "   " });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.fouten.titel);
});

// ── Bronhygiene: extern_url ─────────────────────────────────────────────────
check("javascript:-URL wordt geweigerd (XSS-hygiene)", () => {
  const r = valideerCuratie({ titel: "x", extern_url: "javascript:alert(1)" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.fouten.extern_url);
});

check("geldige https-URL wordt geaccepteerd; lege URL → null", () => {
  const r = valideerCuratie({ titel: "x", extern_url: "https://dnb.nl/beleid" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.waarde.extern_url, "https://dnb.nl/beleid");
  const r2 = valideerCuratie({ titel: "x", extern_url: "  " });
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.waarde.extern_url, null);
});

// ── Enums ───────────────────────────────────────────────────────────────────
check("ongeldig normgewicht/regelingstype/status → fouten", () => {
  const r = valideerCuratie({
    titel: "x",
    normgewicht: "zwaarwegend",
    regelingstype: "DC",
    documentstatus: "concept",
    bronstatus: "zwevend",
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.fouten.normgewicht);
    assert.ok(r.fouten.regelingstype);
    assert.ok(r.fouten.documentstatus);
    assert.ok(r.fouten.bronstatus);
  }
});

// ── Datums ──────────────────────────────────────────────────────────────────
check("ongeldig datumformaat → fout", () => {
  const r = valideerCuratie({ titel: "x", geldig_vanaf: "01-01-2026" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.fouten.geldig_vanaf);
});

check("geldig_tot vóór geldig_vanaf → fout", () => {
  const r = valideerCuratie({
    titel: "x",
    geldig_vanaf: "2026-06-01",
    geldig_tot: "2026-01-01",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.fouten.geldig_tot);
});

check("geldige datumrange wordt geaccepteerd", () => {
  const r = valideerCuratie({
    titel: "x",
    documentdatum: "2026-06-24",
    geldig_vanaf: "2026-06-01",
    geldig_tot: "2026-12-31",
  });
  assert.equal(r.ok, true);
});

console.log(`\n${n} sanity-tests geslaagd.`);
