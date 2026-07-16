// ============================================================
//  Sanity-tests voor de Solidariteitsbeleid-afleidingslogica (T15, decisions/0076).
//
//  Borgt de risicovolle rekenlogica: netto vulling (som van vier bronnen,
//  geen halve som), beginstand (vorige stand of teruggerekend), eindstand
//  (begin + netto − uitdeling), de consistent-vlag tegen de balans-stand,
//  het hergebruikte stoplicht en de band-gauge-positie (clamp 0–1).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/stuurinfo-soli.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  leidSoliOntwikkelingAf,
  nettoVullingVan,
  SOLI_VULLING_KEYS,
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

// Seedwaarden Horizon 2026Q2 (2026_07_17_t15b): 68,0 + 10,0 − 0 = 78,0.
const vullingQ2 = [
  bron("premie", 1.1, 1),
  bron("rendement", 4.6, 2),
  bron("micro_langleven", -0.6, 3),
  bron("overrendementsbijdrage", 4.9, 4),
];
const q2: SoliPeriodeBron = {
  vulling: vullingQ2,
  uitdeling: 0,
  stand: 78.0,
  pctWaarde: 3.3,
  ondergrens: 1.5,
  bovengrens: 5.0,
};

console.log("stuurinfo-soli sanity-tests:");

// ── Netto vulling ───────────────────────────────────────────────────────────

test("netto vulling = som van de vier bronnen, ± (1,1+4,6−0,6+4,9 = 10,0)", () => {
  const netto = nettoVullingVan(vullingQ2);
  assert.ok(netto !== null && Math.abs(netto - 10.0) < 1e-9);
});

test("ontbrekende of lege bron → netto null (geen halve som als schijnzekerheid)", () => {
  assert.equal(nettoVullingVan(vullingQ2.slice(0, 3)), null);
  assert.equal(nettoVullingVan([...vullingQ2.slice(0, 3), bron("overrendementsbijdrage", null)]), null);
});

test("onbekende extra punt_keys tellen niet mee (vaste vier bronnen)", () => {
  const netto = nettoVullingVan([...vullingQ2, bron("rommel", 999)]);
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
  // Horizon 2026Q1-seed: stand 68,0, netto 1,8, uitdeling 0 → beginstand 66,2.
  const q1: SoliPeriodeBron = {
    vulling: [bron("premie", 0.4), bron("rendement", 0.7), bron("micro_langleven", 0.3), bron("overrendementsbijdrage", 0.4)],
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
});

// ── Consistent-vlag (afgeleide eindstand vs. balans-stand) ──────────────────

test("afwijking tussen afgeleide eindstand en balans-stand → consistent false", () => {
  // Balans-save heeft de stand later gewijzigd (bv. 80): 68 + 10 − 0 = 78 ≠ 80.
  const o = leidSoliOntwikkelingAf({ ...q2, stand: 80.0 }, 68.0);
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

// ── Bronregels (vaste volgorde, labels uit data met fallback) ───────────────

test("bronnen in vaste volgorde; datalabel wint, definitie-label als fallback", () => {
  const metLabel = vullingQ2.map((b) =>
    b.puntKey === "premie" ? { ...b, label: "Premie (werkgevers)" } : b
  );
  const o = leidSoliOntwikkelingAf({ ...q2, vulling: metLabel }, 68.0);
  assert.deepEqual(o.bronnen.map((b) => b.key), SOLI_VULLING_KEYS);
  assert.equal(o.bronnen[0].label, "Premie (werkgevers)");
  assert.equal(o.bronnen[2].label, "Resultaat micro-langleven");
});

test("micro-langleven mag negatief zijn en blijft als ± zichtbaar in de bronregels", () => {
  const o = leidSoliOntwikkelingAf(q2, 68.0);
  assert.equal(o.bronnen.find((b) => b.key === "micro_langleven")?.waarde, -0.6);
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

test("meridiaan 2026Q2-seed: 29,0 + (0,5+2,0−0,3+2,8) − 0 = 34,0", () => {
  const o = leidSoliOntwikkelingAf(
    {
      vulling: [bron("premie", 0.5), bron("rendement", 2.0), bron("micro_langleven", -0.3), bron("overrendementsbijdrage", 2.8)],
      uitdeling: 0, stand: 34.0, pctWaarde: 3.4, ondergrens: 1.5, bovengrens: 5.0,
    },
    29.0
  );
  assert.ok(o.eindstand !== null && Math.abs(o.eindstand - 34.0) < 1e-9);
  assert.equal(o.consistent, true);
});

console.log(`\n${n} tests geslaagd.`);
