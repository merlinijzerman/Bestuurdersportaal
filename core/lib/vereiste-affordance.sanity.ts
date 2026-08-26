// ============================================================
//  Gedragstoets I1 op UI-niveau (#192). Legt de slot-semantiek vast zodat een
//  latere refactor het I1-slot niet stil kan omzeilen: onder een vaststellende
//  besluitstatus mag KOPPELEN (first-bind) nog, maar LOSMAKEN niet.
//
//  Deze functies worden echt door StapPaneel.tsx gebruikt (magLosmaken/
//  magKoppelen); dit is dus geen parallelle kopie maar het gedrag zelf.
//
//  Uitvoeren: npx tsx core/lib/vereiste-affordance.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { magLosmaken, magKoppelen } from "./vereiste-affordance";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const beheerder = { kanBeheren: true, alleenLezen: false };

test("onder slot: LOSMAKEN is uit (deur a dicht)", () => {
  assert.equal(
    magLosmaken({ ...beheerder, slotAan: true, bronType: "risk" }),
    false,
    "losmaken mag niet onder een vaststellende besluitstatus"
  );
});

test("onder slot: KOPPELEN (first-bind) blijft toegestaan", () => {
  assert.equal(
    magKoppelen({ ...beheerder, slotAan: true, type: "risk" }),
    true,
    "een eerste binding voegt een vervulling toe en valt niet onder I1"
  );
});

test("zonder slot: losmaken mag (echte gebonden bron)", () => {
  assert.equal(magLosmaken({ ...beheerder, slotAan: false, bronType: "risk" }), true);
});

test("field/classificatie (governance_event) is nooit losmaakbaar", () => {
  assert.equal(
    magLosmaken({ ...beheerder, slotAan: false, bronType: "governance_event" }),
    false
  );
});

test("field en evaluation krijgen geen koppel-affordance", () => {
  assert.equal(magKoppelen({ ...beheerder, slotAan: false, type: "field" }), false);
  assert.equal(magKoppelen({ ...beheerder, slotAan: false, type: "evaluation" }), false);
});

test("alleen-lezen of geen beheerrecht: geen enkele actie", () => {
  assert.equal(magLosmaken({ kanBeheren: false, alleenLezen: false, slotAan: false, bronType: "risk" }), false);
  assert.equal(magKoppelen({ kanBeheren: true, alleenLezen: true, slotAan: false, type: "risk" }), false);
});

console.log(`\nvereiste-affordance.sanity: ${n} checks groen (I1-slot vastgelegd).`);
