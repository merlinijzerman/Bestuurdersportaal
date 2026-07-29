// ============================================================================
//  lib/bronkeuze-classificatie.sanity.ts — Increment I-2.
//  Runner die de pure bron-intentieclassificatie (lib/vraagtype.ts) toetst
//  tegen de geaccordeerde meetset (lib/bronkeuze-meetset.ts) en HARD faalt
//  (exit ≠ 0) zodra een door gebruiker/compliance vastgestelde drempel breekt.
//
//  De DREMPELS zijn NIET door de assistent bedacht maar door gebruiker/
//  compliance vastgesteld (sign-off 2026-06-22) — zie decisions/ + HANDOVER.
//  Ze zijn bewust ASYMMETRISCH: de gevaarlijke fout (een fondsvraag stil als
//  'algemeen' afdoen → schijnzekerheid) heeft NUL-tolerantie.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/bronkeuze-classificatie.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { bepaalBronIntent } from "./vraagtype";
import { BRONKEUZE_MEETSET, type MeetsetVraag } from "./bronkeuze-meetset";

// ── Geaccordeerde drempels (gebruiker/compliance, 2026-06-22) ───────────────
const DREMPELS = {
  // 1) De gevaarlijke fout: fondsvraag → stil 'algemeen'. Absoluut verboden.
  maxFondsAlsAlgemeen: 0,
  // 2) Totale verkeerde ZEKERE auto-keuze (intent fout terwijl vertrouwen=zeker).
  maxFoutAutoFractie: 0.05,
  // 3) Terugvraag-frequentie (onzeker over de hele set) — niet té vaak doorvragen.
  maxTerugvraagFractie: 0.2,
  // 4) "Niet stil verkeerd": goede zekere keuze óf terechte terugvraag.
  minNietStilVerkeerd: 0.9,
};

interface Uitkomst {
  vraag: MeetsetVraag;
  intent: string;
  vertrouwen: string;
  /** Verwacht gedrag gehaald? (juiste zekere intent, of terechte terugvraag). */
  goed: boolean;
  /** Een zekere keuze met de VERKEERDE intent (stil verkeerd). */
  foutAuto: boolean;
  /** Specifiek: een fondsvraag stil als 'algemeen' afgedaan. */
  fondsAlsAlgemeen: boolean;
  /** Geclassificeerd als onzeker → de assistent vraagt terug. */
  terugvraag: boolean;
}

function evalueer(v: MeetsetVraag): Uitkomst {
  const { intent, vertrouwen } = bepaalBronIntent(v.vraag);
  const terugvraag = vertrouwen === "onzeker";

  let goed: boolean;
  if (v.label === "mag-terugvragen") {
    goed = terugvraag; // terecht doorgevraagd
  } else {
    goed = vertrouwen === "zeker" && intent === v.label;
  }

  // Een "foute auto-keuze" is een ZEKERE keuze die niet klopt met het label.
  // Bij een mag-terugvragen-vraag is een zekere keuze (geen terugvraag) óók fout.
  const foutAuto =
    vertrouwen === "zeker" &&
    (v.label === "mag-terugvragen" || intent !== v.label);

  const fondsAlsAlgemeen = v.label === "fonds" && intent === "algemeen";

  return { vraag: v, intent, vertrouwen, goed, foutAuto, fondsAlsAlgemeen, terugvraag };
}

const uitkomsten = BRONKEUZE_MEETSET.map(evalueer);
const n = uitkomsten.length;

console.log(`bronkeuze-classificatie — meetset (${n} vragen):\n`);

// Per-vraag-overzicht (zichtbaar bij falen én slagen).
for (const u of uitkomsten) {
  const merk = u.goed ? "✓" : "✗";
  const detail = u.terugvraag ? "→ terugvraag" : `→ ${u.intent}`;
  console.log(
    `  ${merk} [${u.vraag.label.padEnd(15)}] Q${String(u.vraag.id).padStart(2)} ${detail}`
  );
  if (!u.goed) {
    console.log(`      verwacht: ${u.vraag.label} — kreeg: ${u.intent}/${u.vertrouwen}`);
  }
}

// ── Metingen ────────────────────────────────────────────────────────────────
const zekereLabels = uitkomsten.filter((u) => u.vraag.label !== "mag-terugvragen");
const fondsAlsAlgemeen = uitkomsten.filter((u) => u.fondsAlsAlgemeen).length;
const foutAuto = uitkomsten.filter((u) => u.foutAuto).length;
const terugvraag = uitkomsten.filter((u) => u.terugvraag).length;
const nietStilVerkeerd = uitkomsten.filter((u) => u.goed).length; // goed = niet stil verkeerd

const foutAutoFractie = foutAuto / zekereLabels.length;
const terugvraagFractie = terugvraag / n;
const nietStilVerkeerdFractie = nietStilVerkeerd / n;

console.log("\nmetingen:");
console.log(`  fondsvraag → stil 'algemeen' : ${fondsAlsAlgemeen}  (max ${DREMPELS.maxFondsAlsAlgemeen})`);
console.log(`  foute zekere auto-keuze      : ${foutAuto}/${zekereLabels.length} = ${(foutAutoFractie * 100).toFixed(1)}%  (max ${(DREMPELS.maxFoutAutoFractie * 100).toFixed(0)}%)`);
console.log(`  terugvraag-frequentie        : ${terugvraag}/${n} = ${(terugvraagFractie * 100).toFixed(1)}%  (max ${(DREMPELS.maxTerugvraagFractie * 100).toFixed(0)}%)`);
console.log(`  niet stil verkeerd           : ${nietStilVerkeerd}/${n} = ${(nietStilVerkeerdFractie * 100).toFixed(1)}%  (min ${(DREMPELS.minNietStilVerkeerd * 100).toFixed(0)}%)`);

// ── Drempel-gating (HARD; exit ≠ 0 bij overschrijding) ──────────────────────
console.log("\ndrempeltoetsing:");
assert.ok(
  fondsAlsAlgemeen <= DREMPELS.maxFondsAlsAlgemeen,
  `KRITIEK: ${fondsAlsAlgemeen} fondsvra(a)g(en) stil als 'algemeen' (max ${DREMPELS.maxFondsAlsAlgemeen}).`
);
assert.ok(
  foutAutoFractie <= DREMPELS.maxFoutAutoFractie,
  `Te veel foute zekere auto-keuzes: ${(foutAutoFractie * 100).toFixed(1)}% > ${(DREMPELS.maxFoutAutoFractie * 100).toFixed(0)}%.`
);
assert.ok(
  terugvraagFractie <= DREMPELS.maxTerugvraagFractie,
  `Te vaak doorgevraagd: ${(terugvraagFractie * 100).toFixed(1)}% > ${(DREMPELS.maxTerugvraagFractie * 100).toFixed(0)}%.`
);
assert.ok(
  nietStilVerkeerdFractie >= DREMPELS.minNietStilVerkeerd,
  `Te weinig 'niet stil verkeerd': ${(nietStilVerkeerdFractie * 100).toFixed(1)}% < ${(DREMPELS.minNietStilVerkeerd * 100).toFixed(0)}%.`
);

console.log("  ✓ alle geaccordeerde drempels gehaald.");
console.log(`\n${n} meetset-vragen getoetst; classificatie binnen drempels.`);
