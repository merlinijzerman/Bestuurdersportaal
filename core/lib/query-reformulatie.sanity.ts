// ============================================================
//  Sanity-tests voor lib/query-reformulatie.ts — meetset B (besluit 0139).
//
//  Geen testframework in de repo; dit script draait standalone met assert.
//  Uitvoeren: npx tsx core/lib/query-reformulatie.sanity.ts
//
//  Doel: bewijzen dat de herziene heeftReformulatieNodig()
//   (1) zelfstandige vragen NIET meer onterecht herformuleert (valse-
//       reformulatie-fractie 5/6 → 0/6, was de directe oorzaak van het
//       incident 06-08 15:29/15:34), en
//   (2) geen enkele echte, contextafhankelijke vervolgvraag laat wegvallen
//       (guardrail "nooit slechter dan nu").
// ============================================================

import assert from "node:assert/strict";
import { heeftReformulatieNodig } from "./query-reformulatie";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("query-reformulatie sanity-tests (meetset B):");

// ── Zelfstandige vragen: MOGEN NIET reformuleren (met historie) ──────────────
// Elke regel noemt waarop de vraag VANDAAG (vóór 0139) onterecht vuurde.
const MAG_NIET: Array<[string, string]> = [
  ["Wat zijn onze strategische doelstellingen?", "woorden.length <= 5"],
  ["Wat staat er in het reglement over pensioneren?", "het"],
  ["Hoe hoog is de dekkingsgraad?", "woorden.length <= 5"],
  ["Welke besluiten heeft het bestuur genomen?", "het"],
  ["Wanneer gaat de Wtp-transitie in?", "(al goed vóór 0139)"],
  ["Wat is deze regeling waard bij vervroegd pensioen?", "deze (als determinator)"],
];

check("zelfstandige vragen reformuleren NIET (0/6 vals)", () => {
  const vals = MAG_NIET.filter(([v]) => heeftReformulatieNodig(v, true));
  assert.deepEqual(
    vals.map(([v]) => v),
    [],
    `Onterecht geherformuleerd: ${JSON.stringify(vals)}`
  );
});

// ── Contextafhankelijke vervolgvragen: MOETEN reformuleren ───────────────────
const MOET: string[] = [
  "En wat betekent dat voor het bestuur?",
  "Kun je dat toelichten?",
  "Waarom?",
  "En de rest?",
  "Hoe zit dat met de ledenraad?",
  "Geldt dit ook voor arbeidsongeschikte deelnemers?",
];

check("echte vervolgvragen reformuleren WEL (6/6)", () => {
  const gemist = MOET.filter((v) => !heeftReformulatieNodig(v, true));
  assert.deepEqual(gemist, [], `Echte anafoor gemist: ${JSON.stringify(gemist)}`);
});

// ── Positionele demonstratief-regel: determinator vs. anafoor ────────────────
check("aanwijzend voornaamwoord + zelfstandig naamwoord = determinator (geen reformulatie)", () => {
  assert.equal(heeftReformulatieNodig("Wat staat er in dat reglement?", true), false);
  assert.equal(heeftReformulatieNodig("Wat betekent deze regeling precies?", true), false);
});

check("aanwijzend voornaamwoord + functiewoord/werkwoord = anafoor (wel reformulatie)", () => {
  assert.equal(heeftReformulatieNodig("Kun je dat toelichten?", true), true);
  assert.equal(heeftReformulatieNodig("Hoe zit dat met de ledenraad?", true), true);
});

// ── Randvoorwaarden ──────────────────────────────────────────────────────────
check("zonder historie nooit reformuleren", () => {
  assert.equal(heeftReformulatieNodig("Waarom?", false), false);
  assert.equal(heeftReformulatieNodig("En wat betekent dat?", false), false);
});

check("lege/whitespace-vraag reformuleert niet", () => {
  assert.equal(heeftReformulatieNodig("   ", true), false);
});

// ── Rapportage van de valse-reformulatie-fractie (voor/na, criterium B) ──────
const valsNa = MAG_NIET.filter(([v]) => heeftReformulatieNodig(v, true)).length;
console.log(`\n  Valse-reformulatie-fractie op de zelfstandige-vragen-set: ${valsNa}/${MAG_NIET.length} (was 5/6 vóór 0139).`);
console.log(`\nAlle ${n} query-reformulatie sanity-checks groen.`);
