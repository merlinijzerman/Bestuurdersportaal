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
import { magLosmaken, magKoppelen, redenGeenKoppelAffordance } from "./vereiste-affordance";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const beheerder = { kanBeheren: true, alleenLezen: false };
const bestuurslid = { magBewijsKoppelen: true, alleenLezen: false };

test("onder slot: LOSMAKEN is uit (deur a dicht)", () => {
  assert.equal(
    magLosmaken({ ...beheerder, slotAan: true, bronType: "risk" }),
    false,
    "losmaken mag niet onder een vaststellende besluitstatus"
  );
});

test("onder slot: KOPPELEN (first-bind) blijft toegestaan", () => {
  assert.equal(
    magKoppelen({ ...bestuurslid, slotAan: true, type: "risk" }),
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

test("field en de typen zonder vervullingspad krijgen geen koppel-affordance", () => {
  assert.equal(magKoppelen({ ...bestuurslid, slotAan: false, type: "field" }), false);
  // evaluation én ai_validation hebben vandaag geen aanmaakpad (besluit 0195).
  assert.equal(magKoppelen({ ...bestuurslid, slotAan: false, type: "evaluation" }), false);
  assert.equal(magKoppelen({ ...bestuurslid, slotAan: false, type: "ai_validation" }), false);
});

test("typen zonder vervullingspad tonen een reden i.p.v. niets (0195)", () => {
  // De reden voedt de uitgeschakelde affordance-tekst in StapPaneel: zichtbaar
  // uitgeschakeld mét reden, niet afwezig en niet een altijd-lege kiezer.
  assert.ok(redenGeenKoppelAffordance("evaluation"), "evaluation hoort een reden te geven");
  assert.ok(redenGeenKoppelAffordance("ai_validation"), "ai_validation hoort een reden te geven");
  // Een type met een aanmaakpad heeft géén reden (de knop is dan gewoon actief).
  assert.equal(redenGeenKoppelAffordance("risk"), null);
  // field toont sowieso geen koppelknop, maar krijgt geen 'geen-pad'-reden.
  assert.equal(redenGeenKoppelAffordance("field"), null);
});

test("bestuurslid mag bewijs koppelen, maar alleen lezen of geen procesrecht blokkeert", () => {
  assert.equal(magLosmaken({ kanBeheren: false, alleenLezen: false, slotAan: false, bronType: "risk" }), false);
  assert.equal(magKoppelen({ ...bestuurslid, slotAan: false, type: "document" }), true);
  assert.equal(magKoppelen({ ...bestuurslid, alleenLezen: true, slotAan: false, type: "risk" }), false);
  assert.equal(magKoppelen({ magBewijsKoppelen: false, alleenLezen: false, slotAan: false, type: "risk" }), false);
});

console.log(`\nvereiste-affordance.sanity: ${n} checks groen (I1-slot vastgelegd).`);
