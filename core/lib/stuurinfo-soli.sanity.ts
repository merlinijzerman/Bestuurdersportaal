// ============================================================
//  Sanity-tests voor de Solidariteitsbeleid-afleidingslogica
//  (T15, decisions/0076 — bijgewerkt in T17, decisions/0078).
//
//  Borgt de risicovolle rekenlogica: netto vulling (drie invoerbronnen + de
//  AFGELEIDE langleven-post uit tab 3, geen halve som), beginstand (vorige
//  stand of teruggerekend), eindstand (begin + netto − uitdeling), de
//  consistent-vlag tegen de balans-stand, het hergebruikte stoplicht en de
//  band-gauge-positie (clamp 0–1).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/stuurinfo-soli.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  leidSoliOntwikkelingAf,
  nettoVullingVan,
  SOLI_VULLING_DEFINITIES,
  SOLI_LANGLEVEN_POST,
  type SoliPeriodeBron,
  type SoliVullingBron,
} from "./stuurinfo-soli";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const bron = (puntKey: string, waarde: number | null, volgorde = 0): SoliVullingBron => ({
  puntKey,
  label: null,
  volgorde,
  waarde,
});

// Seedwaarden Horizon 2026Q2 (t15b + t17b): 68,0 + 10,0 − 0 = 78,0.
// Langleven-post = AFGELEID netto uit tab 3 (t17b: −0,8 − 1,2 + 1,4 = −0,6).
const vullingQ2 = [
  bron("premie", 1.1, 1),
  bron("rendement", 4.6, 2),
  bron("overrendementsbijdrage", 4.9, 4),
];
const q2: SoliPeriodeBron = {
  vulling: vullingQ2,
  langlevenNetto: -0.6,
  uitdeling: 0,
  stand: 78.0,
  pctWaarde: 3.3,
  ondergrens: 1.5,
  bovengrens: 5.0,
};

console.log("stuurinfo-soli sanity-tests:");

// ── Netto vulling ───────────────────────────────────────────────────────────

test("netto vulling = drie invoerbronnen + afgeleide langleven-post (1,1+4,6+4,9−0,6 = 10,0)", () => {
  const netto = nettoVullingVan(vullingQ2, -0.6);
  assert.ok(netto !== null && Math.abs(netto - 10.0) < 1e-9);
});

test("ontbrekende of lege invoerbron → netto null (geen halve som als schijnzekerheid)", () => {
  assert.equal(nettoVullingVan(vullingQ2.slice(0, 2), -0.6), null);
  assert.equal(nettoVullingVan([...vullingQ2.slice(0, 2), bron("overrendementsbijdrage", null)], -0.6), null);
});

test("ontbrekend langleven-netto (biometrie-invoer incompleet) → netto null", () => {
  assert.equal(nettoVullingVan(vullingQ2, null), null);
});

test("onbekende extra punt_keys tellen niet mee (vaste drie invoerbronnen)", () => {
  const netto = nettoVullingVan([...vullingQ2, bron("rommel", 999)], -0.6);
  assert.ok(netto !== null && Math.abs(netto - 10.0) < 1e-9);
});

test("een achtergebleven micro_langleven-rij telt NIET meer mee (T17-opschoning)", () => {
  // Vóór t17b kan er nog een opgeslagen micro_langleven-rij bestaan; de
  // afleiding negeert die — de langleven-post komt uitsluitend uit tab 3.
  const netto = nettoVullingVan([...vullingQ2, bron("micro_langleven", -99)], -0.6);
  assert.ok(netto !== null && Math.abs(netto - 10.0) < 1e-9);
});

// ── Begin- en eindstand ─────────────────────────────────────────────────────

test("met voorgaande periode: beginstand = vorige stand; eindstand = begin + netto − uitdeling (68 + 10 − 0 = 78)", () => {
  const o = leidSoliOntwikkelingAf(q2, 68.0);
  assert.equal(o.beginstand, 68.0);
  assert.ok(o.eindstand !== null && Math.abs(o.eindstand - 78.0) < 1e-9);
  assert.equal(o.consistent, true);
});

test("oudste periode (geen vorige): beginstand teruggerekend = stand − netto + uitdeling", () => {
  // Horizon 2026Q1-seed: stand 68,0, netto 1,8 (0,4+0,7+0,4 + langleven 0,3),
  // uitdeling 0 → beginstand 66,2.
  const q1: SoliPeriodeBron = {
    vulling: [bron("premie", 0.4), bron("rendement", 0.7), bron("overrendementsbijdrage", 0.4)],
    langlevenNetto: 0.3,
    uitdeling: 0, stand: 68.0, pctWaarde: 3.0, ondergrens: 1.5, bovengrens: 5.0,
  };
  const o = leidSoliOntwikkelingAf(q1, null);
  assert.ok(o.beginstand !== null && Math.abs(o.beginstand - 66.2) < 1e-9);
  assert.equal(o.consistent, true); // teruggerekend = tautologisch consistent
});

test("uitdeling drukt de eindstand (68 + 10 − 4 = 74)", () => {
  const o = leidSoliOntwikkelingAf({ ...q2, uitdeling: 4 }, 68.0);
  assert.ok(o.eindstand !== null && Math.abs(o.eindstand - 74.0) < 1e-9);
});

test("onvolledige invoer → eindstand null (geen schijnzekerheid)", () => {
  assert.equal(leidSoliOntwikkelingAf({ ...q2, uitdeling: null }, 68.0).eindstand, null);
  assert.equal(leidSoliOntwikkelingAf({ ...q2, vulling: vullingQ2.slice(0, 2) }, 68.0).eindstand, null);
  assert.equal(leidSoliOntwikkelingAf({ ...q2, langlevenNetto: null }, 68.0).eindstand, null);
});

// ── Consistent-vlag (afgeleide eindstand vs. balans-stand) ──────────────────

test("afwijking tussen afgeleide eindstand en balans-stand → consistent false", () => {
  // Balans-save heeft de stand later gewijzigd (bv. 80): 68 + 10 − 0 = 78 ≠ 80.
  const o = leidSoliOntwikkelingAf({ ...q2, stand: 80.0 }, 68.0);
  assert.equal(o.consistent, false);
});

test("een latere biometrie-edit die het netto wijzigt → consistent false (drift-signaal)", () => {
  // Biometrie-save ná de soli-save: netto langleven −0,6 → −1,6; de
  // vergelijking 68 + 9,0 − 0 = 77 ≠ 78 wordt door de leeslaag gesignaleerd.
  const o = leidSoliOntwikkelingAf({ ...q2, langlevenNetto: -1.6 }, 68.0);
  assert.equal(o.consistent, false);
});

test("kleine numerieke ruis binnen tolerantie 0.005 blijft consistent", () => {
  const o = leidSoliOntwikkelingAf({ ...q2, stand: 78.0000001 }, 68.0);
  assert.equal(o.consistent, true);
});

test("zonder toetsbare gegevens (geen stand of geen eindstand) geen vals alarm", () => {
  assert.equal(leidSoliOntwikkelingAf({ ...q2, stand: null }, 68.0).consistent, true);
  assert.equal(leidSoliOntwikkelingAf({ ...q2, uitdeling: null }, 68.0).consistent, true);
});

// ── Bronregels (vaste volgorde, langleven-post afgeleid) ────────────────────

test("bronnen in vaste volgorde; langleven-post op positie 3 met vaste label", () => {
  const metLabel = vullingQ2.map((b) =>
    b.puntKey === "premie" ? { ...b, label: "Premie (werkgevers)" } : b
  );
  const o = leidSoliOntwikkelingAf({ ...q2, vulling: metLabel }, 68.0);
  assert.deepEqual(o.bronnen.map((b) => b.key), SOLI_VULLING_DEFINITIES.map((d) => d.key));
  assert.equal(o.bronnen[0].label, "Premie (werkgevers)");
  assert.equal(o.bronnen[2].key, SOLI_LANGLEVEN_POST.key);
  assert.equal(o.bronnen[2].label, "Netto langleven resultaat");
});

test("de langleven-post draagt de AFGELEIDE waarde uit tab 3 (± zichtbaar)", () => {
  const o = leidSoliOntwikkelingAf(q2, 68.0);
  assert.equal(o.bronnen.find((b) => b.key === "langleven")?.waarde, -0.6);
});

test("langleven-post null zolang de biometrie-invoer incompleet is", () => {
  const o = leidSoliOntwikkelingAf({ ...q2, langlevenNetto: null }, 68.0);
  assert.equal(o.bronnen.find((b) => b.key === "langleven")?.waarde, null);
});

// ── Stoplicht + band-gauge (zelfde bron als tab 1) ──────────────────────────

test("status via de éne stoplichtdefinitie (3,3% in band 1,5–5,0 → ok)", () => {
  assert.equal(leidSoliOntwikkelingAf(q2, 68.0).status, "ok");
  assert.equal(leidSoliOntwikkelingAf({ ...q2, pctWaarde: 1.2 }, 68.0).status, "onder");
  assert.equal(leidSoliOntwikkelingAf({ ...q2, pctWaarde: 5.4 }, 68.0).status, "boven");
  assert.equal(leidSoliOntwikkelingAf({ ...q2, ondergrens: null, bovengrens: null }, 68.0).status, "monitoring");
});

test("gauge-positie: (3,3 − 1,5) / (5,0 − 1,5) ≈ 0,514", () => {
  const o = leidSoliOntwikkelingAf(q2, 68.0);
  assert.ok(o.gaugePositie !== null && Math.abs(o.gaugePositie - 0.5142857143) < 1e-9);
});

test("gauge clamp: buiten de band blijft de marker op 0 of 1", () => {
  assert.equal(leidSoliOntwikkelingAf({ ...q2, pctWaarde: 0.4 }, 68.0).gaugePositie, 0);
  assert.equal(leidSoliOntwikkelingAf({ ...q2, pctWaarde: 9.9 }, 68.0).gaugePositie, 1);
});

test("gauge zonder band of zonder stand% → null (geen marker uit het niets)", () => {
  assert.equal(leidSoliOntwikkelingAf({ ...q2, ondergrens: null }, 68.0).gaugePositie, null);
  assert.equal(leidSoliOntwikkelingAf({ ...q2, pctWaarde: null }, 68.0).gaugePositie, null);
  // gedegenereerde band (onder = boven) → null, geen deling door nul
  assert.equal(leidSoliOntwikkelingAf({ ...q2, ondergrens: 5.0, bovengrens: 5.0 }, 68.0).gaugePositie, null);
});

// ── Meridiaan-seed rekent ook rond ──────────────────────────────────────────

test("meridiaan 2026Q2-seed: 29,0 + (0,5+2,0+2,8 + langleven −0,3) − 0 = 34,0", () => {
  const o = leidSoliOntwikkelingAf(
    {
      vulling: [bron("premie", 0.5), bron("rendement", 2.0), bron("overrendementsbijdrage", 2.8)],
      langlevenNetto: -0.3,
      uitdeling: 0, stand: 34.0, pctWaarde: 3.4, ondergrens: 1.5, bovengrens: 5.0,
    },
    29.0
  );
  assert.ok(o.eindstand !== null && Math.abs(o.eindstand - 34.0) < 1e-9);
  assert.equal(o.consistent, true);
});

console.log(`\n${n} tests geslaagd.`);
