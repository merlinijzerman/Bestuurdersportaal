// ============================================================
//  Sanity-tests voor de Excel-sjabloonmodule (T14, decisions/0075).
//
//  Borgt: label-normalisatie (case/whitespace/diacritics/koppeltekens),
//  NL-getalparsing, de roundtrip sjabloon → parser (elk sjabloonveld wordt
//  herkend), ontbrekend-/onherkend-detectie en de Δ-berekening van het
//  controlescherm.
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/stuurinfo-sjabloon.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  SJABLOON_VELDEN,
  normaliseerLabel,
  parseNlGetal,
  parseSjabloonRijen,
  bouwControleVelden,
  sjabloonAoa,
  type SjabloonReferentie,
} from "./stuurinfo-sjabloon";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("stuurinfo-sjabloon sanity-tests:");

// ── Normalisatie ─────────────────────────────────────────────────────────────

test("normalisatie: case, whitespace, diacritics en koppelteken-varianten", () => {
  assert.equal(normaliseerLabel("  Belegd   Vermogen  "), "belegd vermogen");
  assert.equal(normaliseerLabel("Financiëringsgraad"), "financieringsgraad");
  assert.equal(
    normaliseerLabel("Solidariteitsreserve — ondergrens"),
    normaliseerLabel("Solidariteitsreserve - ondergrens")
  );
  assert.equal(
    normaliseerLabel("Solidariteitsreserve–ondergrens"),
    normaliseerLabel("Solidariteitsreserve - ondergrens")
  );
  assert.equal(normaliseerLabel("Kostenreserve:"), "kostenreserve");
});

// ── NL-getalparsing ──────────────────────────────────────────────────────────

test("parseNlGetal: getallen, NL-notatie, procent, plus/min, rommel", () => {
  assert.equal(parseNlGetal(2400), 2400);
  assert.equal(parseNlGetal("2.400"), 2400);
  assert.equal(parseNlGetal("2.400,5"), 2400.5);
  assert.equal(parseNlGetal("0,1"), 0.1);
  assert.equal(parseNlGetal("0.1"), 0.1);
  assert.equal(parseNlGetal("1,5%"), 1.5);
  assert.equal(parseNlGetal("+3,2"), 3.2);
  assert.equal(parseNlGetal("−4"), -4);
  assert.equal(parseNlGetal("106,0"), 106);
  assert.equal(parseNlGetal("€ 78"), 78);
  assert.equal(parseNlGetal(""), null);
  assert.equal(parseNlGetal("n.v.t."), null);
  assert.equal(parseNlGetal(null), null);
  assert.equal(parseNlGetal(Number.NaN), null);
  assert.equal(parseNlGetal("1.23.4"), null);
  // US-notatie (punt ná komma) wordt geweigerd — geen stille misinterpretatie
  // van "2,400.5" als 2.4005 (reviewbevinding T14b).
  assert.equal(parseNlGetal("2,400.5"), null);
  assert.equal(parseNlGetal("1,5.0"), null);
});

// ── Roundtrip sjabloon → parser ──────────────────────────────────────────────

test("roundtrip: het download-sjabloon met ingevulde waarden herkent élk veld", () => {
  const aoa = sjabloonAoa().map((rij, i) =>
    i === 0 ? rij : [rij[0], 1 + i, rij[2]]
  );
  const r = parseSjabloonRijen(aoa as unknown[][]);
  assert.equal(r.herkend.length, SJABLOON_VELDEN.length);
  assert.equal(r.onherkend.length, 0);
  assert.equal(r.ontbrekend.length, 0);
});

test("leeg download-sjabloon: alle verplichte velden ontbreken, niets onherkend", () => {
  const r = parseSjabloonRijen(sjabloonAoa() as unknown[][]);
  assert.equal(r.herkend.length, 0);
  assert.equal(r.onherkend.length, 0);
  assert.equal(r.ontbrekend.length, SJABLOON_VELDEN.filter((v) => v.verplicht).length);
});

// ── Herkenning / onherkend / ontbrekend ──────────────────────────────────────

test("onherkend label krijgt ⚠-status en wordt niet als herkend geteld", () => {
  const r = parseSjabloonRijen([
    ["Veld", "Waarde", "Eenheid"],
    ["Belegd vermogen", "2.400", "€ mln"],
    ["Kostenvoorziening", 40, "€ mln"], // bestaat niet in het sjabloon
  ]);
  assert.equal(r.herkend.length, 1);
  assert.equal(r.onherkend.length, 1);
  assert.equal(r.onherkend[0].label, "Kostenvoorziening");
  assert.ok(r.ontbrekend.includes("Technische voorziening"));
});

test("herkenning is tolerant voor case/notatie ('OVERIG TOETSVERMOGEN', komma-waarde)", () => {
  const r = parseSjabloonRijen([["OVERIG  TOETSVERMOGEN", "2,0"]]);
  assert.equal(r.herkend.length, 1);
  assert.equal(r.herkend[0].veld.doel.soort, "balans_passiva");
  assert.equal(r.herkend[0].waarde, 2);
});

test("veld met lege/onbruikbare waarde telt als ontbrekend (niet stil op 0)", () => {
  const r = parseSjabloonRijen([["Belegd vermogen", ""]]);
  assert.equal(r.herkend.length, 0);
  assert.ok(r.ontbrekend.includes("Belegd vermogen"));
});

test("soli-grenzen zijn optioneel: ontbreken blokkeert niet", () => {
  const alleVerplicht = sjabloonAoa()
    .slice(1)
    .filter((rij) => {
      const veld = SJABLOON_VELDEN.find((v) => v.label === rij[0]);
      return veld?.verplicht;
    })
    .map((rij) => [rij[0], 10]);
  const r = parseSjabloonRijen(alleVerplicht as unknown[][]);
  assert.equal(r.ontbrekend.length, 0);
  assert.equal(r.herkend.length, SJABLOON_VELDEN.filter((v) => v.verplicht).length);
});

// ── Controlescherm ───────────────────────────────────────────────────────────

const referentie: SjabloonReferentie = {
  activa: { belegd: 2360, overig: 72 },
  passiva: {
    ev_toets_mvev: 10, ev_toets_oper: 8, ev_toets_overig: 2,
    ev_soli: 68, ev_comp: 40, tv: 2290, vuk: 9, overig: 5,
  },
  reserves: { kostenreserve: 39, ao_reserve: 18, ppwzp_reserve: 7, ppwzp_reserve_eerbiedigend: 0.1 },
  grenzen: { solidariteitsreserve: { ondergrens: 1.5, bovengrens: 5.0 } },
  financieringsgraad: 105.5,
};

test("controlescherm: Δ vorige per doel (belegd +40, soli +10), onherkend zonder Δ", () => {
  const r = parseSjabloonRijen([
    ["Belegd vermogen", 2400],
    ["Solidariteitsreserve", 78],
    ["Kostenvoorziening", 40],
  ]);
  const velden = bouwControleVelden(r, referentie);
  const belegd = velden.find((v) => v.bronLabel === "Belegd vermogen");
  assert.equal(belegd?.deltaVorige, 40);
  assert.equal(belegd?.status, "herkend");
  assert.equal(belegd?.doelLabel, "Balans › Belegd vermogen");
  const soli = velden.find((v) => v.bronLabel === "Solidariteitsreserve");
  assert.equal(soli?.deltaVorige, 10);
  const vreemd = velden.find((v) => v.bronLabel === "Kostenvoorziening");
  assert.equal(vreemd?.status, "onherkend");
  assert.equal(vreemd?.doelLabel, null);
  assert.equal(vreemd?.deltaVorige, null);
});

test("controlescherm zonder referentieperiode: Δ = null (geen schijnzekerheid)", () => {
  const r = parseSjabloonRijen([["Belegd vermogen", 2400]]);
  const velden = bouwControleVelden(r, null);
  assert.equal(velden[0].deltaVorige, null);
});

console.log(`\nstuurinfo-sjabloon: ${n} sanity-tests geslaagd.`);
