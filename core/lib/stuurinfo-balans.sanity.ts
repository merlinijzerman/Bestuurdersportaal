// ============================================================
//  Sanity-tests voor de Balans-tab-afleidingslogica (T13, decisions/0074).
//
//  Borgt de risicovolle rekenlogica: subtotaal-afleiding (toetsvermogen /
//  eigen vermogen / totalen), het balansevenwicht (afgeleide validatie),
//  de éne stoplichtdefinitie voor reserves (band → ok/onder/boven; geen
//  band → monitoring), de richting-afleiding en de periode-fallback.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/stuurinfo-balans.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  leidBalansAf,
  leidReserveStatusAf,
  kiesPeriode,
  formatteerPeriode,
  formatteerPeildatum,
  mutatiePct,
  mutatiePt,
  type BalansBronRij,
} from "./stuurinfo-balans";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const rij = (puntKey: string, waarde: number, volgorde = 0): BalansBronRij => ({
  puntKey,
  label: puntKey,
  volgorde,
  waarde,
});

// Prototypebedragen Horizon 2026Q2 / 2026Q1 (seed 2026_07_16_t13).
const activaQ2 = [rij("belegd", 2400, 1), rij("overig", 80, 2)];
const activaQ1 = [rij("belegd", 2360, 1), rij("overig", 72, 2)];
const passivaQ2 = [
  rij("ev_toets_mvev", 10, 1), rij("ev_toets_oper", 9, 2), rij("ev_toets_overig", 2, 3),
  rij("ev_soli", 78, 4), rij("ev_comp", 41, 5),
  rij("tv", 2328, 6), rij("vuk", 8, 7), rij("overig", 4, 8),
];
const passivaQ1 = [
  rij("ev_toets_mvev", 10, 1), rij("ev_toets_oper", 8, 2), rij("ev_toets_overig", 2, 3),
  rij("ev_soli", 68, 4), rij("ev_comp", 40, 5),
  rij("tv", 2290, 6), rij("vuk", 9, 7), rij("overig", 5, 8),
];

console.log("stuurinfo-balans sanity-tests:");

// ── Subtotaal-afleiding ──────────────────────────────────────────────────────

test("toetsvermogen = mvev + operationeel + overig (21 = 10+9+2)", () => {
  const b = leidBalansAf(activaQ2, passivaQ2, activaQ1, passivaQ1);
  const toets = b.passiva.find((r) => r.key === "toetsvermogen");
  assert.equal(toets?.huidig, 21);
  assert.equal(toets?.vorig, 20);
  assert.equal(toets?.subtotaal, true);
});

test("eigen vermogen = toetsvermogen + solidariteitsreserve + compensatiedepot (140 = 21+78+41)", () => {
  const b = leidBalansAf(activaQ2, passivaQ2, activaQ1, passivaQ1);
  const ev = b.passiva.find((r) => r.key === "eigen_vermogen");
  assert.equal(ev?.huidig, 140);
  assert.equal(ev?.vorig, 128);
});

test("totalen zijn afgeleid: activa 2480, passiva 2480 (Q2) en 2432/2432 (Q1)", () => {
  const b = leidBalansAf(activaQ2, passivaQ2, activaQ1, passivaQ1);
  assert.equal(b.activa.at(-1)?.huidig, 2480);
  assert.equal(b.passiva.at(-1)?.huidig, 2480);
  assert.equal(b.activa.at(-1)?.vorig, 2432);
  assert.equal(b.passiva.at(-1)?.vorig, 2432);
});

test("passiva-hiërarchie in prototypevolgorde met inspringniveaus", () => {
  const b = leidBalansAf(activaQ2, passivaQ2, activaQ1, passivaQ1);
  assert.deepEqual(
    b.passiva.map((r) => [r.key, r.niveau]),
    [
      ["eigen_vermogen", 0], ["toetsvermogen", 1],
      ["ev_toets_mvev", 2], ["ev_toets_oper", 2], ["ev_toets_overig", 2],
      ["ev_soli", 1], ["ev_comp", 1],
      ["tv", 0], ["vuk", 0], ["overig", 0],
      ["totaal_passiva", 0],
    ]
  );
});

// ── Balansevenwicht ─────────────────────────────────────────────────────────

test("balansevenwicht sluit voor beide geseede periodes", () => {
  const b = leidBalansAf(activaQ2, passivaQ2, activaQ1, passivaQ1);
  assert.equal(b.evenwicht.sluit, true);
  assert.equal(b.evenwicht.verschil, 0);
  assert.equal(b.evenwichtVorig?.sluit, true);
});

test("balansevenwicht signaleert een niet-sluitende balans expliciet", () => {
  const b = leidBalansAf([rij("belegd", 2400)], passivaQ2, null, null);
  assert.equal(b.evenwicht.sluit, false);
  assert.equal(b.evenwicht.verschil, 2400 - 2480);
});

test("onbekende punt_keys tellen mee in het totaal en verdwijnen niet stilletjes", () => {
  const b = leidBalansAf(activaQ2, [...passivaQ2, rij("nieuw_potje", 5)], null, null);
  assert.equal(b.passiva.at(-1)?.huidig, 2485);
  assert.ok(b.passiva.some((r) => r.key === "nieuw_potje"));
  assert.equal(b.evenwicht.sluit, false); // en het evenwicht signaleert het gat
});

// ── Richting-afleiding (huidig vs. voorgaand kwartaal) ──────────────────────

test("richting: op (soli 68→78), neer (vuk 9→8), gelijk (mvev 10→10)", () => {
  const b = leidBalansAf(activaQ2, passivaQ2, activaQ1, passivaQ1);
  const per = (k: string) => b.passiva.find((r) => r.key === k)?.richting;
  assert.equal(per("ev_soli"), "op");
  assert.equal(per("vuk"), "neer");
  assert.equal(per("ev_toets_mvev"), "gelijk");
});

test("zonder vergelijkingsperiode is de richting null en vorig null", () => {
  const b = leidBalansAf(activaQ2, passivaQ2, null, null);
  for (const r of [...b.activa, ...b.passiva]) {
    assert.equal(r.richting, null);
    assert.equal(r.vorig, null);
  }
});

// ── Stoplichtdefinitie reserves (één definitie, decisions/0074) ─────────────

test("binnen band → ok (solidariteitsreserve 3,3% in band 1,5–5,0)", () => {
  assert.equal(leidReserveStatusAf(1.5, 5.0, 3.3), "ok");
});

test("op de grens telt als binnen band (geen vals alarm op de rand)", () => {
  assert.equal(leidReserveStatusAf(1.5, 5.0, 1.5), "ok");
  assert.equal(leidReserveStatusAf(1.5, 5.0, 5.0), "ok");
});

test("onder de ondergrens → onder (rood)", () => {
  assert.equal(leidReserveStatusAf(1.5, 5.0, 1.2), "onder");
});

test("boven de bovengrens → boven (oranje)", () => {
  assert.equal(leidReserveStatusAf(1.5, 5.0, 5.4), "boven");
});

test("geen band → monitoring (neutraal), ongeacht de stand", () => {
  assert.equal(leidReserveStatusAf(null, null, 0.4), "monitoring");
  assert.equal(leidReserveStatusAf(null, null, null), "monitoring");
});

test("band zonder stand% → monitoring (geen schijnzekerheid)", () => {
  assert.equal(leidReserveStatusAf(1.5, 5.0, null), "monitoring");
});

test("halve band werkt: alleen ondergrens of alleen bovengrens toetst die grens", () => {
  assert.equal(leidReserveStatusAf(1.5, null, 1.0), "onder");
  assert.equal(leidReserveStatusAf(1.5, null, 9.9), "ok");
  assert.equal(leidReserveStatusAf(null, 5.0, 5.5), "boven");
});

// ── Periode-keuze + formattering ────────────────────────────────────────────

const periodes = [
  { periode: "2026Q1", peildatum: "2026-03-31", volgorde: 1 },
  { periode: "2026Q2", peildatum: "2026-06-30", volgorde: 2 },
];

test("zonder parameter wint de nieuwste periode; de voorgaande is de vergelijking", () => {
  const { gekozen, vorige } = kiesPeriode(periodes, undefined);
  assert.equal(gekozen?.periode, "2026Q2");
  assert.equal(vorige?.periode, "2026Q1");
});

test("expliciete keuze werkt; de oudste periode heeft geen voorgaande", () => {
  const { gekozen, vorige } = kiesPeriode(periodes, "2026Q1");
  assert.equal(gekozen?.periode, "2026Q1");
  assert.equal(vorige, null);
});

test("ongeldige parameter valt terug op de nieuwste periode (fail-safe, geen error)", () => {
  const { gekozen } = kiesPeriode(periodes, "2031Q9'; drop table--");
  assert.equal(gekozen?.periode, "2026Q2");
});

test("lege registry geeft null (pagina toont lege-staat, geen crash)", () => {
  assert.deepEqual(kiesPeriode([], "2026Q2"), { gekozen: null, vorige: null });
});

test("formattering: '2026Q2' → 'Q2 2026'; '2026-06-30' → '30-06-2026'; onbekende vorm blijft ruw", () => {
  assert.equal(formatteerPeriode("2026Q2"), "Q2 2026");
  assert.equal(formatteerPeriode("jaar-2026"), "jaar-2026");
  assert.equal(formatteerPeildatum("2026-06-30"), "30-06-2026");
  assert.equal(formatteerPeildatum("onbekend"), "onbekend");
});

// ── Mutatie-helpers (KPI-tegels) ────────────────────────────────────────────

test("mutatiePct: 2432 → 2480 = +1,97…% ; zonder basis null", () => {
  const pct = mutatiePct(2480, 2432);
  assert.ok(pct !== null && Math.abs(pct - 1.9736842105) < 1e-9);
  assert.equal(mutatiePct(2480, null), null);
  assert.equal(mutatiePct(null, 2432), null);
  assert.equal(mutatiePct(2480, 0), null);
});

test("mutatiePt: FG 105,5 → 106,0 = +0,5 %-pt; zonder beide waarden null", () => {
  const pt = mutatiePt(106.0, 105.5);
  assert.ok(pt !== null && Math.abs(pt - 0.5) < 1e-9);
  assert.equal(mutatiePt(106.0, null), null);
});

console.log(`\n${n} tests geslaagd.`);
