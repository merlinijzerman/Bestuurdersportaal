// ============================================================
//  Sanity-tests voor requirement-zwaarte (P1a, #165).
//
//  Borgt de migratieregel verplicht/blokkerend -> zwaarte (ontwerp §5.1):
//  blokkerend wint van verplicht, verplicht-zonder-blokkerend = vereist, de
//  rest optioneel. Deze afleiding is het swap-punt voor #168; een stille wijziging
//  hier verschuift de kritiek/vereist-signalen op het procesoverzicht.
//
//  Geen testframework; standalone. Uitvoeren: npx tsx core/lib/requirement-zwaarte.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  zwaarteVanVereiste,
  ZWAARTE_LABEL,
  ZWAARTE_RANG,
} from "./requirement-zwaarte";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

test("blokkerend => kritiek (ook als verplicht toevallig false is)", () => {
  assert.equal(zwaarteVanVereiste({ verplicht: true, blokkerend: true }), "kritiek");
  assert.equal(zwaarteVanVereiste({ verplicht: false, blokkerend: true }), "kritiek");
});

test("verplicht zonder blokkerend => vereist", () => {
  assert.equal(zwaarteVanVereiste({ verplicht: true, blokkerend: false }), "vereist");
});

test("niet verplicht en niet blokkerend => optioneel", () => {
  assert.equal(zwaarteVanVereiste({ verplicht: false, blokkerend: false }), "optioneel");
});

test("labels bestaan voor elke zwaarte", () => {
  assert.equal(ZWAARTE_LABEL.kritiek, "Kritiek");
  assert.equal(ZWAARTE_LABEL.vereist, "Vereist");
  assert.equal(ZWAARTE_LABEL.optioneel, "Optioneel");
});

test("rangorde loopt kritiek < vereist < optioneel", () => {
  assert.ok(ZWAARTE_RANG.kritiek < ZWAARTE_RANG.vereist);
  assert.ok(ZWAARTE_RANG.vereist < ZWAARTE_RANG.optioneel);
});

console.log(`\nrequirement-zwaarte: ${n} sanity-checks groen.`);
