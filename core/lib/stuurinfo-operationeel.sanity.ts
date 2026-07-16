// ============================================================
//  Sanity-tests voor de Operationeel beleid-afleidingslogica (T16, decisions/0077).
//
//  Borgt de tab 6-specifieke logica bovenop stuurinfo-ontwikkeling.ts:
//  buffer (stand − norm), % van norm, het hergebruikte stoplicht + de
//  gauge-posities in € mln, en het kostendetail (realisatie vs. begroot,
//  totalen alleen bij complete sets). De generieke primo/ultimo-logica
//  wordt in stuurinfo-ontwikkeling.sanity.ts getest.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/stuurinfo-operationeel.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  leidOperationeelAf,
  leidOperKostenAf,
  operTotaalMutatie,
  OPER_MUTATIE_KEYS,
  type OperPeriodeBron,
} from "./stuurinfo-operationeel";
import type { MutatieBron } from "./stuurinfo-ontwikkeling";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const bron = (puntKey: string, waarde: number | null): MutatieBron => ({
  puntKey,
  label: null,
  volgorde: 0,
  waarde,
});

// Seedwaarden Horizon 2026Q2 (2026_07_18_t16b): 8,0 + 1,0 = 9,0.
const mutatiesQ2 = [
  bron("premie_kostenopslag", 0.0),
  bron("beschermingsrendement", -0.1),
  bron("overrendement", 1.3),
  bron("gemist_rendement_twk", 0.1),
  bron("twk_invaar", 0.2),
  bron("verrekening_reserves", 0.2),
  bron("overig", 0.1),
  bron("kosten", -0.8),
];
const q2: OperPeriodeBron = {
  mutaties: mutatiesQ2,
  stand: 9.0,
  norm: 8.0,
  bandOnder: 6.0,
  bandBoven: 12.0,
};

console.log("stuurinfo-operationeel sanity-tests:");

// ── Ontwikkeling (seed rekent rond via de generieke module) ─────────────────

test("horizon Q2-seed: totaal mutatie +1,0; primo 8,0 → ultimo 9,0; consistent", () => {
  const o = leidOperationeelAf(q2, 8.0);
  assert.ok(o.totaalMutatie !== null && Math.abs(o.totaalMutatie - 1.0) < 1e-9);
  assert.equal(o.primo, 8.0);
  assert.ok(o.ultimo !== null && Math.abs(o.ultimo - 9.0) < 1e-9);
  assert.equal(o.consistent, true);
});

test("horizon Q1-seed (oudste periode): som +0,8; primo teruggerekend 7,2", () => {
  const q1: OperPeriodeBron = {
    mutaties: [
      bron("premie_kostenopslag", 0.0),
      bron("beschermingsrendement", -0.1),
      bron("overrendement", 1.1),
      bron("gemist_rendement_twk", 0.1),
      bron("twk_invaar", 0.2),
      bron("verrekening_reserves", 0.1),
      bron("overig", 0.1),
      bron("kosten", -0.7),
    ],
    stand: 8.0,
    norm: 8.0,
    bandOnder: 6.0,
    bandBoven: 12.0,
  };
  const o = leidOperationeelAf(q1, null);
  assert.ok(o.totaalMutatie !== null && Math.abs(o.totaalMutatie - 0.8) < 1e-9);
  assert.ok(o.primo !== null && Math.abs(o.primo - 7.2) < 1e-9);
  assert.equal(o.consistent, true);
});

test("operTotaalMutatie vereist alle acht bronnen (geen halve som)", () => {
  assert.equal(OPER_MUTATIE_KEYS.length, 8);
  assert.equal(operTotaalMutatie(mutatiesQ2.slice(0, 7)), null);
  const som = operTotaalMutatie(mutatiesQ2);
  assert.ok(som !== null && Math.abs(som - 1.0) < 1e-9);
});

// ── Norm, buffer en band (alles in € mln) ───────────────────────────────────

test("buffer = stand − norm (9 − 8 = +1,0); % van norm = 112,5", () => {
  const o = leidOperationeelAf(q2, 8.0);
  assert.ok(o.buffer !== null && Math.abs(o.buffer - 1.0) < 1e-9);
  assert.equal(o.pctVanNorm, 112.5);
});

test("norm ≤ 0 of ontbrekend → buffer/% van norm null (geen deling door nul)", () => {
  assert.equal(leidOperationeelAf({ ...q2, norm: null }, 8.0).buffer, null);
  assert.equal(leidOperationeelAf({ ...q2, norm: null }, 8.0).pctVanNorm, null);
  assert.equal(leidOperationeelAf({ ...q2, norm: 0 }, 8.0).pctVanNorm, null);
});

test("status via de éne stoplichtdefinitie (9,0 in band 6–12 → ok)", () => {
  assert.equal(leidOperationeelAf(q2, 8.0).status, "ok");
  assert.equal(leidOperationeelAf({ ...q2, stand: 5.0 }, 8.0).status, "onder");
  assert.equal(leidOperationeelAf({ ...q2, stand: 13.0 }, 8.0).status, "boven");
  assert.equal(
    leidOperationeelAf({ ...q2, bandOnder: null, bandBoven: null }, 8.0).status,
    "monitoring"
  );
});

test("gauge: stand (9−6)/(12−6) = 0,5; norm (8−6)/6 ≈ 0,333; clamp buiten de band", () => {
  const o = leidOperationeelAf(q2, 8.0);
  assert.equal(o.gaugePositie, 0.5);
  assert.ok(o.normPositie !== null && Math.abs(o.normPositie - 1 / 3) < 1e-9);
  assert.equal(leidOperationeelAf({ ...q2, stand: 15.0 }, 8.0).gaugePositie, 1);
  assert.equal(leidOperationeelAf({ ...q2, stand: 1.0 }, 8.0).gaugePositie, 0);
});

test("gauge zonder band of stand → null (geen marker uit het niets)", () => {
  assert.equal(leidOperationeelAf({ ...q2, bandOnder: null }, 8.0).gaugePositie, null);
  assert.equal(leidOperationeelAf({ ...q2, stand: null }, 8.0).gaugePositie, null);
  // gedegenereerde band (onder = boven) → null, geen deling door nul
  assert.equal(
    leidOperationeelAf({ ...q2, bandOnder: 8.0, bandBoven: 8.0 }, 8.0).gaugePositie,
    null
  );
});

// ── Kostendetail (realisatie YTD vs. begroot — aangeleverd) ─────────────────

const realisatieQ2 = [
  bron("uitvoeringskosten", 1.9),
  bron("vermogensbeheer", 0.9),
  bron("bestuur_overig", 0.3),
];
const begrootQ2 = [
  bron("uitvoeringskosten", 2.1),
  bron("vermogensbeheer", 1.0),
  bron("bestuur_overig", 0.2),
];

test("kostendetail: totalen 3,1 vs. 3,3 → binnen budget", () => {
  const k = leidOperKostenAf(realisatieQ2, begrootQ2);
  assert.equal(k.regels.length, 3);
  assert.ok(k.totaalRealisatie !== null && Math.abs(k.totaalRealisatie - 3.1) < 1e-9);
  assert.ok(k.totaalBegroot !== null && Math.abs(k.totaalBegroot - 3.3) < 1e-9);
  assert.equal(k.binnenBudget, true);
});

test("realisatie boven begroting → binnenBudget false", () => {
  const duur = realisatieQ2.map((r) =>
    r.puntKey === "uitvoeringskosten" ? { ...r, waarde: 2.5 } : r
  );
  assert.equal(leidOperKostenAf(duur, begrootQ2).binnenBudget, false);
});

test("ontbrekende kostensoort → totaal en budget-oordeel null (geen halve som)", () => {
  const k = leidOperKostenAf(realisatieQ2.slice(0, 2), begrootQ2);
  assert.equal(k.totaalRealisatie, null);
  assert.equal(k.binnenBudget, null);
  // regels blijven volledig in vaste volgorde, met null-gaten zichtbaar
  assert.equal(k.regels.length, 3);
  assert.equal(k.regels[2].realisatie, null);
});

console.log(`\n${n} tests geslaagd.`);
