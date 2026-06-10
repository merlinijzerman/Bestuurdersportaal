// ============================================================
//  Sanity-tests voor lib/vraagtype.ts (increment 2).
//
//  Verifieert de risicovolle, pure logica: vraagtype-detectie (breed vs.
//  specifiek), strategiekeuze t.o.v. de drempel, en de batch-splitsing incl.
//  de harde bovengrens (afkap-signaal).
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/vraagtype.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  bepaalVraagtype,
  schatTokens,
  kiesStrategie,
  maakBatches,
} from "./vraagtype";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("vraagtype sanity-tests:");

// ── Vraagtype-detectie: breed ──
const breed = [
  "Vat dit document samen",
  "Kun je een samenvatting geven?",
  "Welke risico's noemt dit stuk?",
  "Welke besluiten worden gevraagd?",
  "Beoordeel dit voorstel",
  "Waar gaat dit document over?",
  "Geef een overzicht van de hoofdpunten",
  "Welke kritische vragen moet ik stellen?",
  "Wat is de rode draad in dit stuk?",
  "Evalueer de onderbouwing",
];
for (const v of breed) {
  test(`breed: "${v}"`, () => assert.equal(bepaalVraagtype(v), "breed"));
}

// ── Vraagtype-detectie: specifiek ──
const specifiek = [
  "Wat is de deadline in artikel 3?",
  "Welk percentage dekkingsgraad wordt genoemd?",
  "Staat er iets over de premie?",
  "Wie is de verantwoordelijke bestuurder?",
  "Op welke datum is het vastgesteld?",
];
for (const v of specifiek) {
  test(`specifiek: "${v}"`, () => assert.equal(bepaalVraagtype(v), "specifiek"));
}

// ── Diacritics/casing robuust ──
test("hoofdletters en accenten storen detectie niet", () => {
  assert.equal(bepaalVraagtype("VAT DIT SAMEN"), "breed");
  assert.equal(bepaalVraagtype("Welke risico's"), "breed");
});

// ── schatTokens ──
test("schatTokens ≈ tekens/4", () => {
  assert.equal(schatTokens(""), 0);
  assert.equal(schatTokens("abcd"), 1);
  assert.equal(schatTokens("a".repeat(401)), 101);
});

// ── kiesStrategie ──
test("specifiek → targeted (ongeacht grootte)", () => {
  assert.equal(kiesStrategie("specifiek", 999999, 48000), "targeted");
});
test("breed onder drempel → full_document", () => {
  assert.equal(kiesStrategie("breed", 1000, 48000), "full_document");
  assert.equal(kiesStrategie("breed", 48000, 48000), "full_document"); // grens inclusief
});
test("breed boven drempel → map_reduce", () => {
  assert.equal(kiesStrategie("breed", 48001, 48000), "map_reduce");
});

// ── maakBatches ──
function chunk(tokens: number) {
  return { tekst: "x".repeat(tokens * 4) }; // ≈ `tokens` tokens
}

test("alles past in één batch", () => {
  const r = maakBatches([chunk(10), chunk(10), chunk(10)], 100, 10);
  assert.equal(r.batches.length, 1);
  assert.equal(r.afgekapt, false);
});

test("splitst zodra het tokenbudget wordt overschreden", () => {
  // 3× 40 tokens, budget 100 → batch1: 40+40=80, batch2: 40.
  const r = maakBatches([chunk(40), chunk(40), chunk(40)], 100, 10);
  assert.equal(r.batches.length, 2);
  assert.deepEqual(r.batches.map((b) => b.length), [2, 1]);
  assert.equal(r.afgekapt, false);
});

test("harde bovengrens kapt af en signaleert dat", () => {
  // 4 chunks van elk 60 tokens, budget 50 → elke chunk eigen batch; max 2 batches.
  const r = maakBatches([chunk(60), chunk(60), chunk(60), chunk(60)], 50, 2);
  assert.equal(r.batches.length, 2);
  assert.equal(r.afgekapt, true);
});

test("lege invoer → geen batches, niet afgekapt", () => {
  const r = maakBatches([], 100, 10);
  assert.equal(r.batches.length, 0);
  assert.equal(r.afgekapt, false);
});

console.log(`\n${n} sanity-tests geslaagd.`);
