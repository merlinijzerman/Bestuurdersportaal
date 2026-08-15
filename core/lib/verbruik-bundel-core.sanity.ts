// ============================================================================
//  Sanity-tests voor core/lib/verbruik-bundel-core.ts (P5 — Verbruik & bundel).
//
//  Acceptatiecriterium 1/3 en de testset (§10) van de werkopdracht eisen dat de
//  server-berekening IDENTIEK is aan de mockup-logica bij dezelfde input, en dat
//  de statusdrempels exact op 90/100/110% omslaan. Dit bestand pint dat: het
//  reproduceert de vier fictieve fondsen uit
//  MOCKUP-monitoring-verbruik-bundel-v0.2.html en de grensgevallen.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/verbruik-bundel-core.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  berekenJaar,
  berekenMaand,
  startMaandIndex,
  type LicentieConfig,
  type MaandInvoer,
  type Status,
} from "./verbruik-bundel-core";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

/** Euro-vergelijking met tolerantie (afrondingsruis in de tienden). */
function bijna(a: number, b: number, tol = 0.01) {
  assert.ok(Math.abs(a - b) <= tol, `verwacht ~${b}, kreeg ${a}`);
}

// ── Mockup-constanten en -dataset (v0.2) ────────────────────────────────────
const T_IN = 5.32;
const T_UIT = 26.63;
const BUNDEL = 2400;
const PEIL_IDX = 4; // t/m mei (index 4), zoals de mockup

function cfg(contractStart: string): LicentieConfig {
  return {
    bundelEurJaar: BUNDEL,
    tariefInEurMln: T_IN,
    tariefUitEurMln: T_UIT,
    contractStart,
  };
}

type MockFonds = {
  naam: string;
  start: string;
  inMln: number;
  uitMln: number;
  maand: (number | null)[];
  verwachteStatus: Status;
};

const FONDSEN: MockFonds[] = [
  { naam: "Alpha", start: "2027-01-01", inMln: 175, uitMln: 3.3, maand: [150, 170, 190, 240, 269], verwachteStatus: "oranje" },
  { naam: "Beta", start: "2027-01-01", inMln: 95, uitMln: 2.0, maand: [95, 110, 120, 115, 119], verwachteStatus: "groen" },
  { naam: "Gamma", start: "2027-03-01", inMln: 11, uitMln: 0.25, maand: [null, null, 22, 20, 24], verwachteStatus: "groen" },
  { naam: "Delta", start: "2027-01-01", inMln: 300, uitMln: 36, maand: [300, 420, 520, 620, 715], verwachteStatus: "rood" },
];

/** Splitst een maandtotaal via de jaarratio, precies zoals de mockup deed. */
function maandInvoer(f: MockFonds, ratioIn: number): MaandInvoer[] {
  return f.maand.map((t) =>
    t === null ? { kostIn: null, kostUit: null } : { kostIn: t * ratioIn, kostUit: t * (1 - ratioIn) }
  );
}

// ── 1. startMaandIndex ──────────────────────────────────────────────────────
test("startMaandIndex leidt de maand uit de ISO-datum af", () => {
  assert.equal(startMaandIndex("2027-01-01"), 0);
  assert.equal(startMaandIndex("2027-03-01"), 2);
  assert.equal(startMaandIndex("2027-12-31"), 11);
});

// ── 2. Jaarberekening per fonds — exacte mockup-uitkomsten ──────────────────
test("Alpha — nadert bundel (prognose 101,9%, oranje)", () => {
  const b = berekenJaar({ inMln: 175, uitMln: 3.3 }, cfg("2027-01-01"), PEIL_IDX);
  bijna(b.kostIn, 931);
  bijna(b.kostUit, 87.879);
  bijna(b.ytd, 1018.879);
  bijna(b.bundel, 2400);
  assert.equal(b.actief, 12);
  assert.equal(b.verstreken, 5);
  bijna(b.prognose, 2445.3096);
  bijna(b.prognosePct, 1.018879, 0.0001);
  bijna(b.doorbelast, 0);
  assert.equal(b.status, "oranje");
});

test("Beta — binnen bundel (groen), doorbelasting 0", () => {
  const b = berekenJaar({ inMln: 95, uitMln: 2.0 }, cfg("2027-01-01"), PEIL_IDX);
  bijna(b.ytd, 558.66);
  bijna(b.prognose, 1340.784);
  bijna(b.aandeel, 0.232775, 0.0001);
  assert.equal(b.doorbelast, 0);
  assert.equal(b.status, "groen");
});

test("Gamma — later gestart (maart): pro-rata bundel 2000, groen", () => {
  const b = berekenJaar({ inMln: 11, uitMln: 0.25 }, cfg("2027-03-01"), PEIL_IDX);
  bijna(b.ytd, 65.1775);
  assert.equal(b.actief, 10); // 12 - 2
  assert.equal(b.verstreken, 3); // max(1, 4 - 2 + 1)
  bijna(b.bundel, 2000); // 2400 * 10 / 12
  bijna(b.prognose, 217.2583);
  assert.equal(b.doorbelast, 0);
  assert.equal(b.status, "groen");
});

test("Delta — output-zwaar, boven bundel (rood) + doorbelasting > 0", () => {
  const b = berekenJaar({ inMln: 300, uitMln: 36 }, cfg("2027-01-01"), PEIL_IDX);
  bijna(b.kostIn, 1596);
  bijna(b.kostUit, 958.68);
  bijna(b.ytd, 2554.68);
  bijna(b.aandeel, 1.06445, 0.0001);
  bijna(b.doorbelast, 154.68);
  assert.equal(b.status, "rood");
});

// ── 3. Tegel-aggregaten (renderTegels) ──────────────────────────────────────
test("Tegels — 2 van 4 binnen bundel, 2 nadert/boven, doorbelast = 154,68", () => {
  const bs = FONDSEN.map((f) => berekenJaar({ inMln: f.inMln, uitMln: f.uitMln }, cfg(f.start), PEIL_IDX));
  const binnen = bs.filter((b) => b.status === "groen").length;
  const nadertBoven = bs.filter((b) => b.status !== "groen").length;
  const doorbelast = bs.reduce((a, b) => a + b.doorbelast, 0);
  assert.equal(binnen, 2);
  assert.equal(nadertBoven, 2);
  bijna(doorbelast, 154.68);
  // Statussen matchen de mockup-verwachting per fonds.
  FONDSEN.forEach((f, i) => assert.equal(bs[i].status, f.verwachteStatus));
});

// ── 4. Maandweergave ────────────────────────────────────────────────────────
test("Gamma — jan/feb vóór ingangsdatum: n.v.t. (null)", () => {
  const jaar = berekenJaar({ inMln: 11, uitMln: 0.25 }, cfg("2027-03-01"), PEIL_IDX);
  const mi = maandInvoer(FONDSEN[2], jaar.kostIn / jaar.ytd);
  assert.equal(berekenMaand(mi, 0, cfg("2027-03-01"), jaar), null);
  assert.equal(berekenMaand(mi, 1, cfg("2027-03-01"), jaar), null);
  assert.notEqual(berekenMaand(mi, 2, cfg("2027-03-01"), jaar), null);
});

test("Delta mei — maandpace ruim boven (rood), maandbudget 200", () => {
  const jaar = berekenJaar({ inMln: 300, uitMln: 36 }, cfg("2027-01-01"), PEIL_IDX);
  const mi = maandInvoer(FONDSEN[3], jaar.kostIn / jaar.ytd);
  const mb = berekenMaand(mi, 4, cfg("2027-01-01"), jaar)!;
  bijna(mb.maandKost, 715);
  bijna(mb.aandeel, 715 / 200, 0.0001); // 3,575
  assert.equal(mb.status, "rood");
  // Cumulatief t/m mei = som van de maandtotalen.
  bijna(mb.cum, 300 + 420 + 520 + 620 + 715);
});

test("Alpha januari — op schema (groen), aandeel 0,75", () => {
  const jaar = berekenJaar({ inMln: 175, uitMln: 3.3 }, cfg("2027-01-01"), PEIL_IDX);
  const mi = maandInvoer(FONDSEN[0], jaar.kostIn / jaar.ytd);
  const mb = berekenMaand(mi, 0, cfg("2027-01-01"), jaar)!;
  bijna(mb.aandeel, 0.75, 0.0001);
  assert.equal(mb.status, "groen");
});

// ── 5. Grensomslag maand — exact op 90 / 100 / 110% ─────────────────────────
test("Maandstatus slaat exact om op 90% (oranje) en 110% (rood)", () => {
  const c = cfg("2027-01-01");
  const jaar = berekenJaar({ inMln: 0, uitMln: 0 }, c, PEIL_IDX); // alleen voor cumPct-noemer
  const bij = (totaal: number): Status => {
    const mi: MaandInvoer[] = [{ kostIn: totaal, kostUit: 0 }];
    return berekenMaand(mi, 0, c, jaar)!.status;
  };
  // maandbudget = 2400 / 12 = 200
  assert.equal(bij(179.9), "groen"); // 0,8995
  assert.equal(bij(180), "oranje"); // 0,90 exact
  assert.equal(bij(200), "oranje"); // 1,00
  assert.equal(bij(220), "oranje"); // 1,10 exact (niet > 1,10)
  assert.equal(bij(221), "rood"); // 1,105
});

// ── 6. Grensomslag jaar — aandeel ≥ 100% of prognose > 110% = rood ──────────
test("Jaarstatus — prognose > 110% zonder aandeel ≥ 1 = rood (peil januari)", () => {
  const c = cfg("2027-01-01");
  // peilIdx 0 → verstreken 1 → prognose = ytd * 12; prognosePct = ytd / 200.
  const status = (ytdEuro: number): Status =>
    berekenJaar({ inMln: ytdEuro / T_IN, uitMln: 0 }, c, 0).status;
  assert.equal(status(179), "groen"); // prognosePct 0,895
  assert.equal(status(180), "oranje"); // 0,90 exact
  assert.equal(status(220), "oranje"); // 1,10 exact (niet > 1,10)
  assert.equal(status(221), "rood"); // 1,105 > 1,10
});

test("Jaarstatus — aandeel ≥ 100% = rood, ook bij vlakke prognose (peil december)", () => {
  const c = cfg("2027-01-01");
  // peilIdx 11 → verstreken 12 → prognose = ytd → aandeel == prognosePct.
  const status = (ytdEuro: number): Status =>
    berekenJaar({ inMln: ytdEuro / T_IN, uitMln: 0 }, c, 11).status;
  assert.equal(status(2159), "groen"); // 0,8996
  assert.equal(status(2160), "oranje"); // 0,90 exact
  assert.equal(status(2400), "rood"); // aandeel 1,00 → rood
});

// ── 7. Contractjaar — pro rata alleen in het eerste contractjaar ────────────
test("Contract uit een eerder jaar krijgt in het peiljaar de volledige jaarbundel", () => {
  const c = cfg("2025-03-01");
  const ber = berekenJaar({ inMln: 10, uitMln: 1 }, c, 7, 2026);
  assert.equal(startMaandIndex(c.contractStart, 2026), 0);
  assert.equal(ber.actief, 12);
  assert.equal(ber.verstreken, 8);
  bijna(ber.bundel, 2400);
});

test("Contract later dan het peiljaar heeft nog geen actieve contractmaanden", () => {
  const c = cfg("2027-03-01");
  const ber = berekenJaar({ inMln: 0, uitMln: 0 }, c, 7, 2026);
  assert.equal(startMaandIndex(c.contractStart, 2026), 12);
  assert.equal(ber.actief, 0);
  assert.equal(ber.verstreken, 0);
  assert.equal(ber.bundel, 0);
  assert.equal(ber.prognose, 0);
});

test("Contract later in hetzelfde jaar deelt niet door nul vóór de start", () => {
  const c = cfg("2027-03-01");
  const ber = berekenJaar({ inMln: 0, uitMln: 0 }, c, 0, 2027);
  assert.equal(ber.actief, 10);
  assert.equal(ber.verstreken, 0);
  assert.equal(ber.prognose, 0);
});

console.log(`\n${n} verbruik-bundel sanity-tests geslaagd.`);
