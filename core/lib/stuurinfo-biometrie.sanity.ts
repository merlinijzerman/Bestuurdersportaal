// ============================================================
//  Sanity-tests voor de Biometrische rendementen-afleidingslogica
//  (T17, decisions/0078).
//
//  Borgt de risicovolle rekenlogica: netto langleven (micro + macro +
//  vrijval, geen halve som), de risicopremies uit premie_component (tab 7,
//  AO/PVI = AOP + PVI — beide vereist), de resultaten PP/WZP en AO/PVI
//  (premie + toegekend) en de volledige periode-afleiding met de
//  t17b-seedwaarden.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/stuurinfo-biometrie.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  leidLanglevenAf,
  nettoLangleven,
  leidRisicodekkingAf,
  risicopremiesVan,
  toegekendVan,
  leidBiometrieAf,
  LANGLEVEN_KEYS,
  RISICODEKKING_KEYS,
} from "./stuurinfo-biometrie";
import type { MutatieBron } from "./stuurinfo-ontwikkeling";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const bron = (puntKey: string, waarde: number | null, volgorde = 0): MutatieBron => ({
  puntKey,
  label: null,
  volgorde,
  waarde,
});

// Seedwaarden Horizon 2026Q2 (t17b): −0,8 − 1,2 + 1,4 = −0,6 (= de
// langleven-post in de soli-ontwikkeling, tab 5 — één bron).
const langlevenQ2 = [
  bron("micro", -0.8, 1),
  bron("macro", -1.2, 2),
  bron("vrijval", 1.4, 3),
];
// Risicopremies uit premie_component (t16b): PP/WZP 1,1; AOP 0,1 + PVI 1,0.
const componentenQ2 = [
  bron("risico_ppwzp", 1.1),
  bron("risico_aop", 0.1),
  bron("risico_pvi", 1.0),
];
// Toegekende dekkingen (t17b): −0,3 en −0,4.
const dekkingQ2 = [
  bron("ppwzp_toegekend", -0.3, 1),
  bron("aopvi_toegekend", -0.4, 2),
];

console.log("stuurinfo-biometrie sanity-tests:");

// ── Netto langleven ─────────────────────────────────────────────────────────

test("netto langleven = micro + macro + vrijval (−0,8 − 1,2 + 1,4 = −0,6)", () => {
  const netto = nettoLangleven(langlevenQ2);
  assert.ok(netto !== null && Math.abs(netto - -0.6) < 1e-9);
});

test("ontbrekende of lege langleven-bron → netto null (geen halve som)", () => {
  assert.equal(nettoLangleven(langlevenQ2.slice(0, 2)), null);
  assert.equal(nettoLangleven([...langlevenQ2.slice(0, 2), bron("vrijval", null)]), null);
});

test("onbekende extra punt_keys tellen niet mee (vaste drie bronnen)", () => {
  const netto = nettoLangleven([...langlevenQ2, bron("rommel", 999)]);
  assert.ok(netto !== null && Math.abs(netto - -0.6) < 1e-9);
});

test("bronregels in vaste volgorde; datalabel wint, definitie-label als fallback", () => {
  const metLabel = langlevenQ2.map((b) =>
    b.puntKey === "micro" ? { ...b, label: "Micro-langleven (ervaringssterfte)" } : b
  );
  const o = leidLanglevenAf(metLabel);
  assert.deepEqual(o.bronnen.map((b) => b.key), LANGLEVEN_KEYS);
  assert.equal(o.bronnen[0].label, "Micro-langleven (ervaringssterfte)");
  assert.equal(o.bronnen[2].label, "Vrijval van kapitaal bij overlijden");
  assert.ok(o.netto !== null && Math.abs(o.netto - -0.6) < 1e-9);
});

// ── Risicopremies uit premie_component (tab 7 — één bron) ───────────────────

test("risicopremies: PP/WZP = risico_ppwzp (1,1); AO/PVI = AOP + PVI (0,1 + 1,0 = 1,1)", () => {
  const p = risicopremiesVan(componentenQ2);
  assert.equal(p.ppwzp, 1.1);
  assert.ok(p.aopvi !== null && Math.abs(p.aopvi - 1.1) < 1e-9);
});

test("ontbrekende AOP óf PVI → AO/PVI-premie null (geen halve som)", () => {
  const p = risicopremiesVan([bron("risico_ppwzp", 1.1), bron("risico_aop", 0.1)]);
  assert.equal(p.ppwzp, 1.1);
  assert.equal(p.aopvi, null);
});

test("ontbrekende PP/WZP-premie → null; overige componenten storen niet", () => {
  const p = risicopremiesVan([bron("spaarpremie", 15.8), bron("risico_aop", 0.1), bron("risico_pvi", 1.0)]);
  assert.equal(p.ppwzp, null);
  assert.ok(p.aopvi !== null && Math.abs(p.aopvi - 1.1) < 1e-9);
});

// ── Resultaten (premie + toegekend) ─────────────────────────────────────────

test("resultaat = premie + toegekend (1,1 − 0,3 = +0,8; 1,1 − 0,4 = +0,7)", () => {
  const ppwzp = leidRisicodekkingAf(1.1, -0.3);
  const aopvi = leidRisicodekkingAf(1.1, -0.4);
  assert.ok(ppwzp.resultaat !== null && Math.abs(ppwzp.resultaat - 0.8) < 1e-9);
  assert.ok(aopvi.resultaat !== null && Math.abs(aopvi.resultaat - 0.7) < 1e-9);
});

test("ontbrekende premie of toegekend → resultaat null (geen schijnzekerheid)", () => {
  assert.equal(leidRisicodekkingAf(null, -0.3).resultaat, null);
  assert.equal(leidRisicodekkingAf(1.1, null).resultaat, null);
});

test("toegekendVan leest per punt; afwezig → null", () => {
  assert.equal(RISICODEKKING_KEYS.length, 2);
  assert.equal(toegekendVan(dekkingQ2, "ppwzp_toegekend"), -0.3);
  assert.equal(toegekendVan(dekkingQ2.slice(0, 1), "aopvi_toegekend"), null);
});

// ── Volledige periode-afleiding (seed rekent rond) ──────────────────────────

test("horizon Q2-seed: netto −0,6; resultaten +0,8 en +0,7 (→ soli resp. oper, tabs 5/6)", () => {
  const b = leidBiometrieAf(langlevenQ2, dekkingQ2, componentenQ2);
  assert.ok(b.langleven.netto !== null && Math.abs(b.langleven.netto - -0.6) < 1e-9);
  assert.ok(b.ppwzp.resultaat !== null && Math.abs(b.ppwzp.resultaat - 0.8) < 1e-9);
  assert.ok(b.aopvi.resultaat !== null && Math.abs(b.aopvi.resultaat - 0.7) < 1e-9);
  // Controle tegen de oper-vergelijking (t17b): som(8) −0,5 + 0,8 + 0,7 = +1,0.
  assert.ok(Math.abs(-0.5 + b.ppwzp.resultaat + b.aopvi.resultaat - 1.0) < 1e-9);
});

test("meridiaan Q2-seed: netto −0,3; resultaten +0,3 en +0,3", () => {
  const b = leidBiometrieAf(
    [bron("micro", -0.3), bron("macro", -0.6), bron("vrijval", 0.6)],
    [bron("ppwzp_toegekend", -0.2), bron("aopvi_toegekend", -0.2)],
    [bron("risico_ppwzp", 0.5), bron("risico_aop", 0.1), bron("risico_pvi", 0.4)]
  );
  assert.ok(b.langleven.netto !== null && Math.abs(b.langleven.netto - -0.3) < 1e-9);
  assert.ok(b.ppwzp.resultaat !== null && Math.abs(b.ppwzp.resultaat - 0.3) < 1e-9);
  assert.ok(b.aopvi.resultaat !== null && Math.abs(b.aopvi.resultaat - 0.3) < 1e-9);
});

test("lege invoer → alles null, bronregels blijven volledig zichtbaar", () => {
  const b = leidBiometrieAf([], [], []);
  assert.equal(b.langleven.netto, null);
  assert.equal(b.langleven.bronnen.length, 3);
  assert.equal(b.ppwzp.resultaat, null);
  assert.equal(b.aopvi.resultaat, null);
});

console.log(`\n${n} tests geslaagd.`);
