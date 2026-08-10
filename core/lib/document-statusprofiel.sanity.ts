// ============================================================
//  Sanity-tests voor het statusprofiel per documenttype (werkopdracht 1.3).
//
//  Wat hier bevroren wordt:
//   • `van_kracht` is ALLEEN voor de normatieve cluster; alle andere types niet.
//   • Onbekend type blokkeert niet (guardrail "geen schijnzekerheid").
//   • De filter raakt uitsluitend `van_kracht` — geen andere status verdwijnt
//     of verschijnt (additief; de enum-krimp is fase 2).
//   • Het `vastgesteld`-token wordt "Definitief" gelabeld voor de informatief/
//     vaststaande cluster, "Vastgesteld" voor normatief.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/document-statusprofiel.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { DOCUMENTTYPEN, type Documenttype } from "./document-metadata";
import {
  magVanKracht,
  toegestaneStatussenVoorType,
  statusLabelVoorType,
  NORMATIEVE_DOCUMENTTYPEN,
} from "./document-statusprofiel";
import type { DocumentStatus } from "./document-status-transities";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("document-statusprofiel sanity-tests:");

test("de normatieve cluster mag van_kracht", () => {
  for (const t of NORMATIEVE_DOCUMENTTYPEN) {
    assert.equal(magVanKracht(t), true);
  }
});

test("niet-normatieve types mogen GEEN van_kracht", () => {
  const nietNormatief = DOCUMENTTYPEN.filter(
    (t) => !NORMATIEVE_DOCUMENTTYPEN.includes(t)
  );
  // rapportage, notulen, advies, memo, analyse, bijlage, overig, bestuursvoorstel
  assert.ok(nietNormatief.length > 0);
  for (const t of nietNormatief) {
    assert.equal(magVanKracht(t), false, `${t} zou geen van_kracht mogen`);
  }
});

test("onbekend type (null) blokkeert niet — geen schijnzekerheid", () => {
  assert.equal(magVanKracht(null), true);
  assert.equal(magVanKracht(undefined), true);
});

test("filter haalt van_kracht weg voor een niet-normatief type", () => {
  const basis: DocumentStatus[] = ["concept", "vastgesteld", "van_kracht"];
  const uit = toegestaneStatussenVoorType(basis, "rapportage");
  assert.deepEqual(uit, ["concept", "vastgesteld"]);
});

test("filter laat van_kracht staan voor een normatief type", () => {
  const basis: DocumentStatus[] = ["vastgesteld", "van_kracht"];
  const uit = toegestaneStatussenVoorType(basis, "beleid");
  assert.deepEqual(uit, ["vastgesteld", "van_kracht"]);
});

test("filter raakt UITSLUITEND van_kracht — alle overige statussen blijven", () => {
  // De 5-waarden-set (0154); alleen van_kracht wordt door het profiel geweerd.
  const basis: DocumentStatus[] = [
    "concept",
    "vastgesteld",
    "historisch",
    "gearchiveerd",
  ];
  assert.deepEqual(toegestaneStatussenVoorType(basis, "memo"), basis);
});

test("vastgesteld-token → 'Definitief' voor de informatief/vaststaande cluster", () => {
  for (const t of ["notulen", "memo", "analyse", "rapportage"] as Documenttype[]) {
    assert.equal(statusLabelVoorType("vastgesteld", t), "Definitief");
  }
});

test("vastgesteld-token → 'Vastgesteld' voor normatief", () => {
  assert.equal(statusLabelVoorType("vastgesteld", "besluit"), "Vastgesteld");
  assert.equal(statusLabelVoorType("vastgesteld", "beleid"), "Vastgesteld");
});

test("andere statussen houden hun neutrale label, ongeacht type", () => {
  assert.equal(statusLabelVoorType("van_kracht", "beleid"), "Van kracht");
  assert.equal(statusLabelVoorType("concept", "rapportage"), "Concept");
  assert.equal(statusLabelVoorType("gearchiveerd", "memo"), "Gearchiveerd");
});

console.log(`\n${n} sanity-tests geslaagd.\n`);
