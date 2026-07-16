// ============================================================
//  Sanity-tests voor de generieke ontwikkelings-afleiding (T16, decisions/0077).
//
//  Borgt de gedeelde rekenlogica van tab 6 (operationele reserve) en tab 7
//  (compensatiedepot): totaal mutatie (som van de bronnen, geen halve som),
//  primo (vorige stand of teruggerekend), ultimo (primo + totaal) en de
//  consistent-vlag tegen de balans-stand (tolerantie 0.005).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/stuurinfo-ontwikkeling.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  leidOntwikkelingAf,
  somMutaties,
  ONTWIKKELING_TOLERANTIE,
  type MutatieBron,
  type MutatieDefinitie,
} from "./stuurinfo-ontwikkeling";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const DEFS: MutatieDefinitie[] = [
  { key: "a", label: "Bron A", volgorde: 1 },
  { key: "b", label: "Bron B", volgorde: 2 },
  { key: "c", label: "Bron C", volgorde: 3 },
];

const bron = (puntKey: string, waarde: number | null, label: string | null = null): MutatieBron => ({
  puntKey,
  label,
  volgorde: 0,
  waarde,
});

// Basisset: +1,3 − 0,1 − 0,2 = +1,0 (vergelijkbaar met de oper-seed Q2).
const drieBronnen = [bron("a", 1.3), bron("b", -0.1), bron("c", -0.2)];

console.log("stuurinfo-ontwikkeling sanity-tests:");

// ── Som van de mutaties ─────────────────────────────────────────────────────

test("totaal mutatie = som van alle gedefinieerde bronnen, ± (1,3 − 0,1 − 0,2 = 1,0)", () => {
  const som = somMutaties(DEFS, drieBronnen);
  assert.ok(som !== null && Math.abs(som - 1.0) < 1e-9);
});

test("ontbrekende of lege bron → som null (geen halve som als schijnzekerheid)", () => {
  assert.equal(somMutaties(DEFS, drieBronnen.slice(0, 2)), null);
  assert.equal(somMutaties(DEFS, [...drieBronnen.slice(0, 2), bron("c", null)]), null);
});

test("onbekende extra punt_keys tellen niet mee (vaste taxonomie)", () => {
  const som = somMutaties(DEFS, [...drieBronnen, bron("rommel", 999)]);
  assert.ok(som !== null && Math.abs(som - 1.0) < 1e-9);
});

// ── Primo en ultimo ─────────────────────────────────────────────────────────

test("met voorgaande periode: primo = vorige stand; ultimo = primo + totaal (8 + 1 = 9)", () => {
  const o = leidOntwikkelingAf(DEFS, drieBronnen, 9.0, 8.0);
  assert.equal(o.primo, 8.0);
  assert.ok(o.ultimo !== null && Math.abs(o.ultimo - 9.0) < 1e-9);
  assert.equal(o.consistent, true);
});

test("oudste periode (geen vorige): primo teruggerekend = stand − totaal (9 − 1 = 8)", () => {
  const o = leidOntwikkelingAf(DEFS, drieBronnen, 9.0, null);
  assert.ok(o.primo !== null && Math.abs(o.primo - 8.0) < 1e-9);
  assert.equal(o.consistent, true); // teruggerekend = tautologisch consistent
});

test("onvolledige invoer → totaal, primo en ultimo null (geen schijnzekerheid)", () => {
  const o = leidOntwikkelingAf(DEFS, drieBronnen.slice(0, 2), 9.0, null);
  assert.equal(o.totaalMutatie, null);
  assert.equal(o.primo, null);
  assert.equal(o.ultimo, null);
});

test("zonder vorige én zonder stand blijft alles behalve de som leeg", () => {
  const o = leidOntwikkelingAf(DEFS, drieBronnen, null, null);
  assert.ok(o.totaalMutatie !== null);
  assert.equal(o.primo, null);
  assert.equal(o.ultimo, null);
  assert.equal(o.consistent, true); // niets om tegen af te wijken
});

// ── Consistent-vlag (afgeleide ultimo vs. balans-stand) ─────────────────────

test("afwijking tussen afgeleide ultimo en balans-stand → consistent false", () => {
  // Balans-save heeft de stand later gewijzigd (bv. 11): 8 + 1 = 9 ≠ 11.
  const o = leidOntwikkelingAf(DEFS, drieBronnen, 11.0, 8.0);
  assert.equal(o.consistent, false);
});

test("kleine numerieke ruis binnen tolerantie 0.005 blijft consistent", () => {
  const o = leidOntwikkelingAf(DEFS, drieBronnen, 9.0000001, 8.0);
  assert.equal(o.consistent, true);
  assert.ok(ONTWIKKELING_TOLERANTIE === 0.005);
});

test("negatieve ontwikkeling (uitputtend depot): 42,4 − 1,4 = 41,0", () => {
  // Comp-seed Q2 (horizon): mutaties sommeren op −1,4.
  const comp = [bron("a", -0.1), bron("b", -1.6), bron("c", 0.3)];
  const o = leidOntwikkelingAf(DEFS, comp, 41.0, 42.4);
  assert.ok(o.totaalMutatie !== null && Math.abs(o.totaalMutatie - -1.4) < 1e-9);
  assert.ok(o.ultimo !== null && Math.abs(o.ultimo - 41.0) < 1e-9);
  assert.equal(o.consistent, true);
});

// ── Bronregels (vaste volgorde, labels uit data met fallback) ───────────────

test("bronnen in vaste definitievolgorde; datalabel wint, definitie-label als fallback", () => {
  const metLabel = [bron("a", 1.3, "Bron A (aangepast)"), bron("b", -0.1), bron("c", -0.2)];
  const o = leidOntwikkelingAf(DEFS, metLabel, 9.0, 8.0);
  assert.deepEqual(o.bronnen.map((b) => b.key), ["a", "b", "c"]);
  assert.equal(o.bronnen[0].label, "Bron A (aangepast)");
  assert.equal(o.bronnen[1].label, "Bron B");
});

console.log(`\n${n} tests geslaagd.`);
