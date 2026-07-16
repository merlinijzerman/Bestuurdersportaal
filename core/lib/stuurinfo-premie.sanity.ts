// ============================================================
//  Sanity-tests voor de Premie- & compensatiebeleid-afleiding (T16, decisions/0077).
//
//  Borgt de tab 7-specifieke logica bovenop stuurinfo-ontwikkeling.ts:
//  de premiecomponententabel (totalen alleen bij complete sets), de
//  depot-ontwikkeling (uitputtend: negatieve mutaties) en de uitputtings-
//  signalering (ondergrens-bedrag, kruisjaar, vulgraad — zonder eigen
//  extrapolatie buiten de aangeleverde ALM-reeks).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/stuurinfo-premie.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  leidPremieTabelAf,
  leidCompDepotAf,
  compTotaalMutatie,
  leidUitputtingAf,
  COMP_MUTATIE_KEYS,
  PREMIE_COMPONENT_KEYS,
  type PrognosePunt,
} from "./stuurinfo-premie";
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

// Seedwaarden Horizon 2026Q2 (2026_07_18_t16b).
const eurQ2 = [
  bron("spaarpremie", 15.8),
  bron("risico_ppwzp", 1.1),
  bron("risico_aop", 0.1),
  bron("risico_pvi", 1.0),
  bron("opslag_uitvoeringskosten", 0.6),
  bron("opslag_toekomstige_kosten", 0.4),
];
const pctQ2 = [
  bron("spaarpremie", 26.31),
  bron("risico_ppwzp", 1.84),
  bron("risico_aop", 0.12),
  bron("risico_pvi", 1.68),
  bron("opslag_uitvoeringskosten", 0.97),
  bron("opslag_toekomstige_kosten", 0.71),
];
const eurQ1 = [
  bron("spaarpremie", 15.5),
  bron("risico_ppwzp", 1.1),
  bron("risico_aop", 0.1),
  bron("risico_pvi", 1.0),
  bron("opslag_uitvoeringskosten", 0.5),
  bron("opslag_toekomstige_kosten", 0.4),
];

console.log("stuurinfo-premie sanity-tests:");

// ── Premiecomponententabel (totalen afgeleid, kwartaalbasis — besluit Merlin) ─

test("horizon Q2-seed: totaal premie € 19,0 (huidig), € 18,6 (vorig), 31,63% grondslag", () => {
  const t = leidPremieTabelAf(eurQ2, pctQ2, eurQ1);
  assert.equal(t.regels.length, PREMIE_COMPONENT_KEYS.length);
  assert.ok(t.totaalHuidig !== null && Math.abs(t.totaalHuidig - 19.0) < 1e-9);
  assert.ok(t.totaalVorig !== null && Math.abs(t.totaalVorig - 18.6) < 1e-9);
  assert.ok(t.totaalPct !== null && Math.abs(t.totaalPct - 31.63) < 1e-9);
});

test("ontbrekende component → totaal null (geen halve som); regels blijven volledig", () => {
  const t = leidPremieTabelAf(eurQ2.slice(0, 5), pctQ2, eurQ1);
  assert.equal(t.totaalHuidig, null);
  assert.equal(t.regels.length, 6);
  assert.equal(t.regels[5].huidig, null);
});

test("zonder voorgaande periode blijft de vorig-kolom leeg (geen 0-schijnzekerheid)", () => {
  const t = leidPremieTabelAf(eurQ2, pctQ2, null);
  assert.equal(t.totaalVorig, null);
  assert.equal(t.regels[0].vorig, null);
});

// ── Depot-ontwikkeling (uitputtend — generieke module) ──────────────────────

const compQ2 = [
  bron("premie", 0.0),
  bron("beschermingsrendement", -0.1),
  bron("overrendement", 0.2),
  bron("onttrekkingen", -1.6),
  bron("verrekening_reserves", 0.0),
  bron("overig", 0.1),
];

test("horizon Q2-seed: totaal mutatie −1,4; primo 42,4 → ultimo 41,0; consistent", () => {
  const o = leidCompDepotAf(compQ2, 41.0, 42.4);
  assert.ok(o.totaalMutatie !== null && Math.abs(o.totaalMutatie - -1.4) < 1e-9);
  assert.ok(o.ultimo !== null && Math.abs(o.ultimo - 41.0) < 1e-9);
  assert.equal(o.consistent, true);
});

test("horizon Q1-seed (oudste periode): primo teruggerekend 43,8 (= 42,4 + 1,4)", () => {
  const o = leidCompDepotAf(compQ2, 42.4, null);
  assert.ok(o.primo !== null && Math.abs(o.primo - 43.8) < 1e-9);
});

test("compTotaalMutatie vereist alle zes bronnen (geen halve som)", () => {
  assert.equal(COMP_MUTATIE_KEYS.length, 6);
  assert.equal(compTotaalMutatie(compQ2.slice(0, 5)), null);
});

test("balans-stand later gewijzigd → consistent false (achteraf-signaal)", () => {
  assert.equal(leidCompDepotAf(compQ2, 44.0, 42.4).consistent, false);
});

// ── Uitputtingssignalering (aangeleverde ALM-reeks; geen extrapolatie) ──────

const prognoseQ2: PrognosePunt[] = [
  { puntKey: "2026", volgorde: 2026, waarde: 41 },
  { puntKey: "2027", volgorde: 2027, waarde: 34.5 },
  { puntKey: "2028", volgorde: 2028, waarde: 28 },
  { puntKey: "2029", volgorde: 2029, waarde: 21.5 },
  { puntKey: "2030", volgorde: 2030, waarde: 15 },
  { puntKey: "2031", volgorde: 2031, waarde: 8.5 },
  { puntKey: "2032", volgorde: 2032, waarde: 2 },
];

test("horizon Q2-seed: ondergrens 40% × 60 = € 24; kruisjaar 2029 (21,5 < 24)", () => {
  const u = leidUitputtingAf(prognoseQ2, 41.0, 60, 40);
  assert.equal(u.ondergrensBedrag, 24);
  assert.equal(u.kruisjaarOndergrens, "2029");
  assert.equal(u.laatsteJaar, "2032");
  assert.equal(u.laatsteWaarde, 2);
});

test("vulgraad = stand ÷ startomvang × 100 (41/60 = 68,3%)", () => {
  const u = leidUitputtingAf(prognoseQ2, 41.0, 60, 40);
  assert.equal(u.gevuldPct, 68.3);
});

test("punten gesorteerd op volgorde; null-waarden vallen weg (geen gaten tekenen)", () => {
  const doorElkaar: PrognosePunt[] = [
    { puntKey: "2028", volgorde: 2028, waarde: 28 },
    { puntKey: "2026", volgorde: 2026, waarde: 41 },
    { puntKey: "2027", volgorde: 2027, waarde: null },
  ];
  const u = leidUitputtingAf(doorElkaar, 41.0, 60, 40);
  assert.deepEqual(u.punten.map((p) => p.jaar), ["2026", "2028"]);
});

test("zonder startomvang of ondergrens-% geen bedrag/kruisjaar/vulgraad (geen schijnzekerheid)", () => {
  const zonderStart = leidUitputtingAf(prognoseQ2, 41.0, null, 40);
  assert.equal(zonderStart.ondergrensBedrag, null);
  assert.equal(zonderStart.kruisjaarOndergrens, null);
  assert.equal(zonderStart.gevuldPct, null);
  const zonderPct = leidUitputtingAf(prognoseQ2, 41.0, 60, null);
  assert.equal(zonderPct.kruisjaarOndergrens, null);
  // startomvang 0 → geen deling door nul
  assert.equal(leidUitputtingAf(prognoseQ2, 41.0, 0, 40).gevuldPct, null);
});

test("prognose die de ondergrens nooit kruist → kruisjaar null (geen verzonnen jaar)", () => {
  const stabiel: PrognosePunt[] = [
    { puntKey: "2026", volgorde: 2026, waarde: 41 },
    { puntKey: "2027", volgorde: 2027, waarde: 40 },
  ];
  assert.equal(leidUitputtingAf(stabiel, 41.0, 60, 40).kruisjaarOndergrens, null);
});

// ── Meridiaan-seed rekent ook rond ──────────────────────────────────────────

test("meridiaan Q2-seed: 18,6 + (−0,6) = 18,0; kruisjaar 2029 (10,2 < 10,4)", () => {
  const compM = [
    bron("premie", 0.0),
    bron("beschermingsrendement", -0.1),
    bron("overrendement", 0.1),
    bron("onttrekkingen", -0.7),
    bron("verrekening_reserves", 0.0),
    bron("overig", 0.1),
  ];
  const o = leidCompDepotAf(compM, 18.0, 18.6);
  assert.ok(o.ultimo !== null && Math.abs(o.ultimo - 18.0) < 1e-9);
  assert.equal(o.consistent, true);

  const prognoseM: PrognosePunt[] = [
    { puntKey: "2026", volgorde: 2026, waarde: 18 },
    { puntKey: "2027", volgorde: 2027, waarde: 15.4 },
    { puntKey: "2028", volgorde: 2028, waarde: 12.8 },
    { puntKey: "2029", volgorde: 2029, waarde: 10.2 },
    { puntKey: "2030", volgorde: 2030, waarde: 7.6 },
    { puntKey: "2031", volgorde: 2031, waarde: 5.0 },
    { puntKey: "2032", volgorde: 2032, waarde: 2.4 },
  ];
  const u = leidUitputtingAf(prognoseM, 18.0, 26, 40);
  assert.equal(u.ondergrensBedrag, 10.4);
  assert.equal(u.kruisjaarOndergrens, "2029");
});

console.log(`\n${n} tests geslaagd.`);
