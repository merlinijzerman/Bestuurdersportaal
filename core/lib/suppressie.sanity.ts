// ============================================================
//  Sanity-tests voor de kleine-populatie-suppressie (T11, besluit 0055).
//
//  De drempel (n<10) is een privacy-by-design-maatregel tegen indirecte
//  herleidbaarheid. Deze tests borgen de randgevallen rond de drempel en dat
//  een ontbrekende teller NIET onderdrukt (geen personen-populatie).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/suppressie.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  SUPPRESSIE_DREMPEL,
  SUPPRESSIE_MASKER,
  isOnderdrukt,
  maskeer,
  toonOfMasker,
} from "./suppressie";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("suppressie sanity-tests:");

test("drempel is 10 (besluit 0055)", () => {
  assert.equal(SUPPRESSIE_DREMPEL, 10);
});

test("n net onder de drempel wordt onderdrukt (n = drempel-1)", () => {
  assert.equal(isOnderdrukt(SUPPRESSIE_DREMPEL - 1), true);
});

test("n op de drempel wordt NIET onderdrukt (n = drempel)", () => {
  assert.equal(isOnderdrukt(SUPPRESSIE_DREMPEL), false);
});

test("n boven de drempel wordt niet onderdrukt", () => {
  assert.equal(isOnderdrukt(462180), false);
});

test("n = 0 wordt onderdrukt (leeg maar telbaar)", () => {
  assert.equal(isOnderdrukt(0), true);
});

test("ontbrekende teller (null/undefined) onderdrukt NIET (geen personen-populatie)", () => {
  assert.equal(isOnderdrukt(null), false);
  assert.equal(isOnderdrukt(undefined), false);
});

test("NaN/oneindig telt niet als geldige kleine populatie", () => {
  assert.equal(isOnderdrukt(Number.NaN), false);
  assert.equal(isOnderdrukt(Number.POSITIVE_INFINITY), false);
});

test("maskeer() geeft null bij kleine populatie, anders de waarde", () => {
  assert.equal(maskeer(1234, 4), null);
  assert.equal(maskeer(1234, 25), 1234);
  assert.equal(maskeer(1234, null), 1234);
});

test("toonOfMasker() toont het masker bij onderdrukking, anders de format-uitkomst", () => {
  assert.equal(toonOfMasker(4, () => "1.234"), SUPPRESSIE_MASKER);
  assert.equal(toonOfMasker(25, () => "1.234"), "1.234");
  // de format-callback mag niet nodig zijn bij onderdrukking (geen leak):
  assert.equal(
    toonOfMasker(3, () => {
      throw new Error("format zou niet aangeroepen mogen worden bij onderdrukking");
    }),
    SUPPRESSIE_MASKER
  );
});

console.log(`\n${n} sanity-tests geslaagd.`);
