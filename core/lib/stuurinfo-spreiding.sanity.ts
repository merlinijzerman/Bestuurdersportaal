// ============================================================
//  Sanity-tests voor de Spreidingsbeleid-afleidingslogica (T15, decisions/0076).
//
//  Borgt de risicovolle rekenlogica: spreidingsvermogen (beschikbaar −
//  voorziening), financieringsgraad uitkeringsfase (beschikbaar ÷ voorziening,
//  1 decimaal, guard op voorziening ≤ 0), de tabelopbouw met afgeleide rijen
//  en richting, en de maandreeks-normalisatie.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/stuurinfo-spreiding.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  leidSpreidingAf,
  bouwSpreidingTabel,
  bouwFgMaandreeks,
  SPREIDING_KPI_DEFINITIES,
  SPREIDING_KPI_KEYS,
  type SpreidingKerncijfers,
} from "./stuurinfo-spreiding";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// Seedwaarden Horizon 2026Q2 / 2026Q1 (2026_07_17_t15b, prototypebedragen).
const q2: SpreidingKerncijfers = {
  beschikbaar: 880, voorziening: 864, aanpassingsfactor: 0.62, bandOnder: 85, bandBoven: 115,
};
const q1: SpreidingKerncijfers = {
  beschikbaar: 809, voorziening: 788, aanpassingsfactor: 0.9, bandOnder: 85, bandBoven: 115,
};

console.log("stuurinfo-spreiding sanity-tests:");

// ── Afleiding kerncijfers ────────────────────────────────────────────────────

test("spreidingsvermogen = beschikbaar − voorziening (Q2: 880−864=16; Q1: 809−788=21)", () => {
  assert.equal(leidSpreidingAf(q2).spreidingsvermogen, 16);
  assert.equal(leidSpreidingAf(q1).spreidingsvermogen, 21);
});

test("financieringsgraad = beschikbaar ÷ voorziening, 1 decimaal (Q2: 101,9; Q1: 102,7)", () => {
  assert.equal(leidSpreidingAf(q2).financieringsgraad, 101.9);
  assert.equal(leidSpreidingAf(q1).financieringsgraad, 102.7);
});

test("meridiaan-seed rekent ook rond (378/372 → 101,6; 348/339 → 102,7)", () => {
  assert.equal(leidSpreidingAf({ ...q2, beschikbaar: 378, voorziening: 372 }).financieringsgraad, 101.6);
  assert.equal(leidSpreidingAf({ ...q1, beschikbaar: 348, voorziening: 339 }).financieringsgraad, 102.7);
});

test("negatief spreidingsvermogen (inloop) blijft gewoon zichtbaar", () => {
  const a = leidSpreidingAf({ ...q2, beschikbaar: 850, voorziening: 864 });
  assert.equal(a.spreidingsvermogen, -14);
  assert.ok(a.financieringsgraad !== null && a.financieringsgraad < 100);
});

test("voorziening ≤ 0 → geen FG (geen deling door nul, geen schijnzekerheid)", () => {
  assert.equal(leidSpreidingAf({ ...q2, voorziening: 0 }).financieringsgraad, null);
  assert.equal(leidSpreidingAf({ ...q2, voorziening: -5 }).financieringsgraad, null);
  // spreidingsvermogen blijft wél berekenbaar (verschil is betekenisvol)
  assert.equal(leidSpreidingAf({ ...q2, voorziening: 0 }).spreidingsvermogen, 880);
});

test("ontbrekende invoer → null-afleiding (lege staat, geen 0-schijnzekerheid)", () => {
  const leeg = leidSpreidingAf({ beschikbaar: null, voorziening: 864, aanpassingsfactor: null, bandOnder: null, bandBoven: null });
  assert.equal(leeg.spreidingsvermogen, null);
  assert.equal(leeg.financieringsgraad, null);
});

// ── Tabelopbouw ─────────────────────────────────────────────────────────────

test("tabel in prototypevolgorde; spreidingsvermogen en FG zijn afgeleide rijen", () => {
  const t = bouwSpreidingTabel(q2, q1);
  assert.deepEqual(
    t.map((r) => [r.key, r.afgeleid]),
    [
      ["beschikbaar", false], ["voorziening", false],
      ["spreidingsvermogen", true], ["financieringsgraad", true],
      ["aanpassingsfactor", false],
    ]
  );
});

test("richting per rij uit beide periodes (beschikbaar ↑, spreidingsvermogen ↓, FG ↓, factor ↓)", () => {
  const t = bouwSpreidingTabel(q2, q1);
  const per = (k: string) => t.find((r) => r.key === k)?.richting;
  assert.equal(per("beschikbaar"), "op");         // 809 → 880
  assert.equal(per("spreidingsvermogen"), "neer"); // 21 → 16
  assert.equal(per("financieringsgraad"), "neer"); // 102,7 → 101,9
  assert.equal(per("aanpassingsfactor"), "neer");  // +0,90 → +0,62
});

test("zonder vergelijkingsperiode: vorig en richting null", () => {
  for (const r of bouwSpreidingTabel(q2, null)) {
    assert.equal(r.vorig, null);
    assert.equal(r.richting, null);
  }
});

// ── Maandreeks ──────────────────────────────────────────────────────────────

test("maandreeks sorteert op volgorde en laat punten zonder waarde weg", () => {
  const reeks = bouwFgMaandreeks([
    { puntKey: "02", label: "sep-25", volgorde: 2, waarde: 100.9 },
    { puntKey: "00", label: "jul-25", volgorde: 0, waarde: 100.2 },
    { puntKey: "01", label: "aug-25", volgorde: 1, waarde: null },
  ]);
  assert.deepEqual(reeks, [
    { label: "jul-25", waarde: 100.2 },
    { label: "sep-25", waarde: 100.9 },
  ]);
});

test("lege reeks blijft leeg (grafiek toont lege staat, geen crash)", () => {
  assert.deepEqual(bouwFgMaandreeks([]), []);
});

// ── Definities (contract met validator/seed) ────────────────────────────────

test("definities dragen exact de vijf uitkeringsfase-keys (contract met seed en validator)", () => {
  assert.deepEqual(SPREIDING_KPI_KEYS, [
    "uitkeringsfase_beschikbaar", "uitkeringsfase_voorziening",
    "uitkeringsfase_aanpassingsfactor", "uitkeringsfase_band_onder",
    "uitkeringsfase_band_boven",
  ]);
  // volgorde 10–14: gereserveerde nummering per tab (zie decisions/0076)
  assert.deepEqual(SPREIDING_KPI_DEFINITIES.map((d) => d.volgorde), [10, 11, 12, 13, 14]);
});

console.log(`\n${n} tests geslaagd.`);
