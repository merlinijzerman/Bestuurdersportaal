// ============================================================================
//  core/lib/reflectie-richtingen.sanity.ts — B-opt tranche 3, AC-R1 t/m R7.
// ----------------------------------------------------------------------------
//  Bevriest de vraagkeuze-guardrails:
//   1. Gesloten richtinglijsten per ingang; een richting erbuiten is ongeldig.
//   2. Een deterministische terugval-vraag bestaat per ingang (de vloer).
//   3. De validator keurt goed wat mag en weigert wat niet mag — per AC-regel
//      minstens één positief én één negatief geval.
//
//  Uitvoeren: npx tsx core/lib/reflectie-richtingen.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { REFLECTIE_INGANGEN, type ReflectieIngang } from "./reflectie-flow";
import {
  RICHTINGEN,
  isGeldigeRichting,
  standaardVraag,
  tegenperspectiefVraag,
  valideerVerdiepingsvraag,
  DIAGNOSE_BLOCKLIST,
} from "./reflectie-richtingen";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

test("elke ingang heeft een gesloten, niet-lege richtinglijst", () => {
  for (const ingang of REFLECTIE_INGANGEN) {
    const lijst = RICHTINGEN[ingang];
    assert.ok(Array.isArray(lijst) && lijst.length > 0, ingang);
    // Ontdubbeld binnen de ingang.
    assert.equal(new Set(lijst).size, lijst.length, `dubbele richting in ${ingang}`);
  }
  // De vier ingangen zijn exact gedekt (geen extra, geen ontbrekende).
  assert.deepEqual(Object.keys(RICHTINGEN).sort(), [...REFLECTIE_INGANGEN].sort());
});

test("isGeldigeRichting laat alleen richtingen uit de eigen lijst toe", () => {
  assert.equal(isGeldigeRichting("twijfel", "aannames"), true);
  assert.equal(isGeldigeRichting("twijfel", "planning"), false); // hoort bij risico
  assert.equal(isGeldigeRichting("risico", "planning"), true);
  assert.equal(isGeldigeRichting("overtuigt", "bewijs"), true);
  assert.equal(isGeldigeRichting("mis_iets", "onzin"), false);
  assert.equal(isGeldigeRichting("mis_iets", 42 as unknown), false);
  assert.equal(isGeldigeRichting("mis_iets", null as unknown), false);
});

test("de deterministische terugval bestaat per ingang en is een vraag", () => {
  for (const ingang of REFLECTIE_INGANGEN) {
    const v = standaardVraag(ingang);
    assert.equal(typeof v, "string");
    assert.ok(v.trim().endsWith("?"), ingang);
    // De terugval passeert per definitie zijn eigen validator (met uitweg waar nodig).
    const bronNummers: number[] = [];
    assert.equal(
      valideerVerdiepingsvraag(v, { bevrorenBronNummers: bronNummers }).ok,
      true,
      `terugval ${ingang} zou zijn eigen validator moeten passeren`
    );
  }
});

test("B-opt 4a: de tegenperspectief-terugval bestaat per ingang en passeert de validator", () => {
  for (const ingang of REFLECTIE_INGANGEN) {
    const v = tegenperspectiefVraag(ingang);
    assert.equal(typeof v, "string");
    assert.ok(v.trim().endsWith("?"), ingang);
    // Het is een VRAAG, geen argument: precies één vraagteken, geen blocklist,
    // en hij passeert zijn eigen validator (geen valse uitweg-eis).
    assert.equal(
      valideerVerdiepingsvraag(v).ok,
      true,
      `tegenperspectief ${ingang} zou de validator moeten passeren`
    );
  }
});

// ── Validator: positief ─────────────────────────────────────────────────────
test("AC-R1..R7 positief: geldige vragen worden goedgekeurd", () => {
  // Zonder context: één open vraag, geen komma's, geen bron → geen uitweg nodig.
  assert.equal(valideerVerdiepingsvraag("Wat weegt hier voor u het zwaarst?").ok, true);
  // Met context: bronverankering + uitweg.
  assert.equal(
    valideerVerdiepingsvraag(
      "De conclusie leunt sterk op de aanname dat de uitvoerder in het derde kwartaal gereed is [Bron 2]. Zit uw twijfel daarin, of ergens anders?",
      { bevrorenBronNummers: [2] }
    ).ok,
    true
  );
  // Opsomming met uitweg.
  assert.equal(
    valideerVerdiepingsvraag(
      "Waar zit uw twijfel vooral: in de feiten, de aannames, de redenering — of ergens anders?"
    ).ok,
    true
  );
});

// ── Validator: negatief, per AC-regel ───────────────────────────────────────
test("AC-R1: meer dan 60 woorden faalt", () => {
  const lang = Array(65).fill("woord").join(" ") + "?";
  const u = valideerVerdiepingsvraag(lang);
  assert.equal(u.ok, false);
  assert.equal(u.reden, "te_lang");
});

test("AC-R2: geen of meerdere vraagtekens faalt", () => {
  assert.equal(valideerVerdiepingsvraag("Dit is een stelling.").reden, "vraagtekens");
  assert.equal(valideerVerdiepingsvraag("Wat mist u? En wat nog meer?").reden, "vraagtekens");
});

test("AC-R3: koppen, opsommingen en hoofdletterrubrieken falen", () => {
  assert.equal(valideerVerdiepingsvraag("## Kop\nWat mist u?").reden, "kop");
  assert.equal(valideerVerdiepingsvraag("- Wat mist u?").reden, "opsomming");
  assert.equal(
    valideerVerdiepingsvraag("WAT U INBRENGT\nWat mist u?").reden,
    "hoofdletterrubriek"
  );
});

test("AC-R4: elke blocklistterm faalt", () => {
  for (const term of DIAGNOSE_BLOCKLIST) {
    const u = valideerVerdiepingsvraag(`Uw zorg ${term} de leverancier — klopt dat?`);
    assert.equal(u.ok, false, term);
    assert.ok(u.reden?.startsWith("blocklist:"), `${term} → ${u.reden}`);
  }
});

test("AC-R5: richtingen aanbieden zonder uitweg faalt", () => {
  // Bronverankering zonder uitweg.
  assert.equal(
    valideerVerdiepingsvraag("In de stukken staat de planning [Bron 2]. Zit uw zorg daarin?", {
      bevrorenBronNummers: [2],
    }).reden,
    "geen_uitweg"
  );
  // Opsomming (≥ 2 komma's) zonder uitweg.
  assert.equal(
    valideerVerdiepingsvraag("Zit het in de feiten, de aannames, de redenering?").reden,
    "geen_uitweg"
  );
});

test("AC-R6: een bron buiten de bevroren set faalt", () => {
  const u = valideerVerdiepingsvraag(
    "In de stukken staat X [Bron 7]. Zit uw zorg daarin, of ergens anders?",
    { bevrorenBronNummers: [1, 2] }
  );
  assert.equal(u.ok, false);
  assert.ok(u.reden?.startsWith("bron_buiten_set:"));
});

test("AC-R7: herkomstuitspraak zonder server-injectie faalt; mét injectie mag", () => {
  const tekst =
    "Een deel leunt op algemene kennis van het model. Wat wilt u als eerste scherper krijgen?";
  assert.equal(valideerVerdiepingsvraag(tekst).ok, false);
  assert.ok(valideerVerdiepingsvraag(tekst).reden?.startsWith("samenstelling:"));
  // Mét de server-injectie is de uitspraak wél toegestaan.
  assert.equal(
    valideerVerdiepingsvraag(tekst, { samenstellingMeegegeven: true }).ok,
    true
  );
});

console.log(`\n${n} sanity-tests geslaagd (reflectie-richtingen).`);
