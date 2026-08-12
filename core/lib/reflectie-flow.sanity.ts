// ============================================================================
//  core/lib/reflectie-flow.sanity.ts — plateau B / B-1, acceptatiecriteria
//  AC-18, AC-23 en AC-26.
// ----------------------------------------------------------------------------
//  Bevriest de reflectietoestandsmachine:
//
//   1. De VOLLEDIGE transitietabel — elke geldige overgang slaagt en, wat meer
//      zegt, elke andere combinatie van (status, actie) faalt. Die tweede helft
//      is uitputtend: 7 statussen × 6 acties = 42 combinaties, waarvan er 15
//      geldig zijn. De overige 27 moeten hard geweigerd worden (AC-18).
//   2. De fail-safe: een status ouder dan FAILSAFE_UREN telt niet meer, en bij
//      elke vorm van twijfel is het antwoord `niet_actief` (AC-23).
//   3. De beurtregel: bij beurt >= MAX_BEURTEN is `conceptweergave` verplicht.
//   4. De labels: de drie afrondlabels staan er letterlijk, en geen enkele
//      verboden term komt voor in welk zichtbaar label dan ook (AC-26).
//
//  Dit is de SPIEGEL van public.reflectie_transitie(). Wijkt de SQL af, dan is
//  dat een verschil dat hier zichtbaar hoort te worden — niet iets dat je in
//  productie ontdekt. De autoriteit blijft de server (besluit 0110).
//
//  Uitvoeren: npx tsx core/lib/reflectie-flow.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  REFLECTIE_STATUSSEN,
  REFLECTIE_ACTIES,
  REFLECTIE_INGANGEN,
  INGANG_LABEL,
  INGANG_VERDIEPING,
  NIET_TE_PLAATSEN_VRAGEN,
  AFRONDLABELS,
  VERBODEN_LABELS,
  FAILSAFE_UREN,
  MAX_BEURTEN,
  isActief,
  toegestaneDoelen,
  magTransitie,
  volgendeNaAntwoord,
  moetNaarConcept,
  isVerlopen,
  effectieveStatus,
  isReflectieStatus,
  isReflectieActie,
  isReflectieIngang,
  type ReflectieStatus,
  type ReflectieActie,
} from "./reflectie-flow";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// ── De geldige overgangen, letterlijk uit TO §6.1 / v1.0 §9.4 ───────────────
// Deze lijst staat hier BEWUST opnieuw en niet geïmporteerd uit de module: een
// test die zijn verwachting uit de code haalt die hij toetst, toetst niets.
const GELDIG: ReadonlyArray<[ReflectieStatus, ReflectieActie, ReflectieStatus[]]> = [
  ["niet_actief", "start", ["ingang_gekozen"]],
  ["ingang_gekozen", "antwoord", ["verdieping_1"]],
  ["verdieping_1", "antwoord", ["verdieping_2"]],
  ["verdieping_2", "antwoord", ["verdieping_3"]],
  ["verdieping_1", "concept", ["conceptweergave"]],
  ["verdieping_2", "concept", ["conceptweergave"]],
  ["verdieping_3", "concept", ["conceptweergave"]],
  ["conceptweergave", "herformuleren", ["conceptweergave"]],
  ["conceptweergave", "afronden", ["afgerond"]],
  ["ingang_gekozen", "afbreken", ["niet_actief"]],
  ["verdieping_1", "afbreken", ["niet_actief"]],
  ["verdieping_2", "afbreken", ["niet_actief"]],
  ["verdieping_3", "afbreken", ["niet_actief"]],
  ["conceptweergave", "afbreken", ["niet_actief"]],
  ["afgerond", "afbreken", ["niet_actief"]],
];

function sleutel(s: ReflectieStatus, a: ReflectieActie) {
  return `${s}|${a}`;
}
const GELDIGE_SLEUTELS = new Set(GELDIG.map(([s, a]) => sleutel(s, a)));

test("elke geldige overgang levert precies de verwachte doelstatussen", () => {
  for (const [status, actie, doelen] of GELDIG) {
    assert.deepEqual(
      [...toegestaneDoelen(status, actie)],
      doelen,
      `${status} + ${actie}`
    );
    assert.equal(magTransitie(status, actie), true, `${status} + ${actie}`);
    for (const doel of doelen) {
      assert.equal(magTransitie(status, actie, doel), true, `${status}+${actie}→${doel}`);
    }
  }
});

test("elke NIET-geldige (status, actie)-combinatie wordt geweigerd", () => {
  let geweigerd = 0;
  for (const status of REFLECTIE_STATUSSEN) {
    for (const actie of REFLECTIE_ACTIES) {
      if (GELDIGE_SLEUTELS.has(sleutel(status, actie))) continue;
      assert.deepEqual(
        [...toegestaneDoelen(status, actie)],
        [],
        `${status} + ${actie} zou ongeldig moeten zijn`
      );
      assert.equal(magTransitie(status, actie), false, `${status} + ${actie}`);
      geweigerd++;
    }
  }
  // 7 statussen × 6 acties = 42; 15 rijen geldig ⇒ 27 ongeldig.
  assert.equal(geweigerd, REFLECTIE_STATUSSEN.length * REFLECTIE_ACTIES.length - GELDIG.length);
  assert.equal(geweigerd, 27);
});

test("het beurtplafond: geen vierde verdiepingsantwoord", () => {
  // De correctie op TO §6.1. Alle drie de verdiepingsstatussen zijn bereikbaar,
  // en vanuit de derde is `antwoord` hard geweigerd — anders zou er een vierde
  // verdiepingsvraag komen, tegen v1.0 §9.6 in.
  assert.equal(magTransitie("verdieping_2", "antwoord", "verdieping_3"), true);
  assert.equal(magTransitie("verdieping_3", "antwoord"), false);
  assert.equal(magTransitie("verdieping_3", "concept", "conceptweergave"), true);
  // En `verdieping_3` is daadwerkelijk bereikbaar vanaf het begin.
  let status: ReflectieStatus = "niet_actief";
  status = toegestaneDoelen(status, "start")[0];
  assert.equal(status, "ingang_gekozen");
  for (let beurt = 1; beurt <= MAX_BEURTEN; beurt++) {
    const volgende = volgendeNaAntwoord(status, beurt);
    assert.ok(volgende, `beurt ${beurt} vanuit ${status}`);
    status = volgende;
  }
  assert.equal(status, "verdieping_3");
  assert.equal(volgendeNaAntwoord(status, MAX_BEURTEN + 1), null);
});

test("B-opt 1a: herformuleren is een zelf-lus, uitsluitend vanuit conceptweergave", () => {
  // De belofte van de knop "Aanpassen": blijven in conceptweergave, geen extra
  // beurt. Op transitieniveau is dat exact één toegestane overgang.
  assert.deepEqual(
    [...toegestaneDoelen("conceptweergave", "herformuleren")],
    ["conceptweergave"]
  );
  assert.equal(magTransitie("conceptweergave", "herformuleren", "conceptweergave"), true);
  // Vanuit elke andere status is herformuleren ongeldig — het is geen
  // verdiepingsactie en kan de bevroren bronset of de beurt niet aanraken.
  for (const s of REFLECTIE_STATUSSEN) {
    if (s === "conceptweergave") continue;
    assert.equal(magTransitie(s, "herformuleren"), false, `herformuleren vanuit ${s}`);
  }
  // Herformuleren verhoogt de beurt niet: het is geen `antwoord`. De beurt-borging
  // zelf zit in reflectie_transitie() (SQL), maar hier borgen we dat de actie geen
  // antwoord-overgang meelift.
  assert.equal(volgendeNaAntwoord("conceptweergave", 1), null);
});

test("AC-18: de vijf pogingen uit het acceptatiecriterium falen alle vijf", () => {
  // 1. Direct van niet_actief naar afgerond springen.
  assert.equal(magTransitie("niet_actief", "afronden"), false);
  assert.equal(magTransitie("niet_actief", "afronden", "afgerond"), false);
  // 2. Vanuit een verdieping direct afronden zonder conceptweergave.
  assert.equal(magTransitie("verdieping_1", "afronden"), false);
  assert.equal(magTransitie("verdieping_3", "afronden"), false);
  // 3. Opnieuw starten terwijl de flow al loopt (zou de bevroren bronset
  //    vervangen — precies de "willekeurige bronset kiezen"-poging).
  for (const s of REFLECTIE_STATUSSEN) {
    if (s === "niet_actief") continue;
    assert.equal(magTransitie(s, "start"), false, `start vanuit ${s}`);
  }
  // 4. Een doelstatus opgeven die niet in de tabel staat.
  assert.equal(magTransitie("ingang_gekozen", "antwoord", "conceptweergave"), false);
  assert.equal(magTransitie("verdieping_2", "antwoord", "afgerond"), false);
  // 5. Terug in de tijd: van conceptweergave terug naar een verdieping.
  assert.equal(magTransitie("conceptweergave", "antwoord"), false);
  assert.equal(magTransitie("afgerond", "antwoord"), false);
  assert.equal(magTransitie("afgerond", "afronden"), false);
});

test("de beurtteller kan alleen omhoog en stopt op het plafond", () => {
  assert.equal(volgendeNaAntwoord("ingang_gekozen", 1), "verdieping_1");
  assert.equal(volgendeNaAntwoord("verdieping_1", 2), "verdieping_2");
  assert.equal(volgendeNaAntwoord("verdieping_2", MAX_BEURTEN), "verdieping_3");
  // Boven het plafond bestaat er geen overgang meer — geen vierde antwoord.
  assert.equal(volgendeNaAntwoord("verdieping_2", MAX_BEURTEN + 1), null);
  assert.equal(volgendeNaAntwoord("verdieping_3", MAX_BEURTEN + 1), null);
  // Een status zonder antwoord-overgang levert null, geen gok.
  assert.equal(volgendeNaAntwoord("niet_actief", 1), null);
  assert.equal(volgendeNaAntwoord("conceptweergave", 1), null);
  assert.equal(volgendeNaAntwoord("afgerond", 1), null);
});

test("moetNaarConcept markeert precies het bereikte plafond", () => {
  assert.equal(moetNaarConcept("verdieping_3", MAX_BEURTEN), true);
  assert.equal(moetNaarConcept("verdieping_2", MAX_BEURTEN - 1), false);
  assert.equal(moetNaarConcept("ingang_gekozen", 0), false);
  // Niet van toepassing zodra de flow de verdiepingsfase voorbij is.
  assert.equal(moetNaarConcept("conceptweergave", MAX_BEURTEN), false);
  assert.equal(moetNaarConcept("afgerond", MAX_BEURTEN), false);
  assert.equal(moetNaarConcept("niet_actief", MAX_BEURTEN), false);
});

test("isActief is precies 'niet niet_actief'", () => {
  assert.equal(isActief("niet_actief"), false);
  for (const s of REFLECTIE_STATUSSEN) {
    if (s === "niet_actief") continue;
    assert.equal(isActief(s), true, s);
  }
});

// ── Fail-safe ───────────────────────────────────────────────────────────────
const UUR = 60 * 60 * 1000;
const NU = 1_770_000_000_000; // vaste waarde: Date.now() hoort niet in een sanitytest

test("fail-safe: verlopen exact op de grens van FAILSAFE_UREN", () => {
  assert.equal(FAILSAFE_UREN, 24);
  assert.equal(isVerlopen(NU - FAILSAFE_UREN * UUR, NU), false, "exact op de grens telt nog");
  assert.equal(isVerlopen(NU - FAILSAFE_UREN * UUR - 1, NU), true, "één ms erover telt niet meer");
  assert.equal(isVerlopen(NU - UUR, NU), false);
});

test("AC-23: bij elke vorm van twijfel valt de status terug op niet_actief", () => {
  // Verlopen.
  assert.equal(effectieveStatus("verdieping_2", NU - 25 * UUR, NU), "niet_actief");
  // Ontbrekend tijdstip.
  assert.equal(effectieveStatus("verdieping_2", null, NU), "niet_actief");
  assert.equal(effectieveStatus("verdieping_2", undefined, NU), "niet_actief");
  // Ontbrekende of onbekende status (bv. een rij uit een nieuwere versie).
  assert.equal(effectieveStatus(null, NU, NU), "niet_actief");
  assert.equal(effectieveStatus(undefined, NU, NU), "niet_actief");
  assert.equal(
    effectieveStatus("afgerond_maar_dan_anders" as ReflectieStatus, NU, NU),
    "niet_actief"
  );
  // Het laatste bericht is geen reflectiebericht (tweede voorwaarde FR-57).
  assert.equal(effectieveStatus("verdieping_1", NU, NU, false), "niet_actief");
  // En alleen als álles klopt blijft de status staan.
  assert.equal(effectieveStatus("verdieping_1", NU - UUR, NU, true), "verdieping_1");
});

// ── Labels en ingangen ──────────────────────────────────────────────────────
test("AC-26: de drie afrondlabels staan er letterlijk", () => {
  assert.deepEqual([...AFRONDLABELS], [
    "Klopt",
    "Aanpassen",
    "Afronden zonder aparte notitie",
  ]);
});

test("AC-26: geen enkel zichtbaar label bevat een verboden term", () => {
  const zichtbaar: string[] = [
    ...AFRONDLABELS,
    ...Object.values(INGANG_LABEL),
    ...Object.values(INGANG_VERDIEPING),
    ...NIET_TE_PLAATSEN_VRAGEN,
  ];
  for (const term of VERBODEN_LABELS) {
    for (const label of zichtbaar) {
      assert.equal(
        label.toLowerCase().includes(term.toLowerCase()),
        false,
        `verboden term "${term}" gevonden in "${label}"`
      );
    }
  }
});

test("elke ingang heeft een label en een verdiepingsvraag", () => {
  assert.equal(REFLECTIE_INGANGEN.length, 8);
  for (const ingang of REFLECTIE_INGANGEN) {
    assert.equal(typeof INGANG_LABEL[ingang], "string");
    assert.ok(INGANG_LABEL[ingang].length > 0, ingang);
    assert.equal(typeof INGANG_VERDIEPING[ingang], "string");
    assert.ok(INGANG_VERDIEPING[ingang].length > 0, ingang);
  }
  // De ingangen zijn geen suggestieve conclusies: elke verdiepingsvraag is een
  // vraag, geen stelling. (v1.0 §9.5 — "Uw twijfel komt waarschijnlijk voort
  // uit..." is expliciet te vermijden.)
  for (const ingang of REFLECTIE_INGANGEN) {
    assert.ok(INGANG_VERDIEPING[ingang].trim().endsWith("?"), ingang);
  }
  assert.equal(NIET_TE_PLAATSEN_VRAGEN.length, 3);
  for (const v of NIET_TE_PLAATSEN_VRAGEN) assert.ok(v.trim().endsWith("?"), v);
});

test("type-guards weigeren invoer van buiten", () => {
  assert.equal(isReflectieStatus("verdieping_1"), true);
  assert.equal(isReflectieStatus("verdieping_9"), false);
  assert.equal(isReflectieStatus(null), false);
  assert.equal(isReflectieStatus(42), false);
  assert.equal(isReflectieActie("afbreken"), true);
  assert.equal(isReflectieActie("herformuleren"), true);
  assert.equal(isReflectieActie("verwijderen"), false);
  assert.equal(isReflectieIngang("onderbouwing"), true);
  assert.equal(isReflectieIngang("geen_aanvullende_reflectie"), false);
  assert.equal(isReflectieIngang(""), false);
});

test("besluit 0112: de module kent geen enkele registratiesleutel", () => {
  // Deze suite is de plek waar een toekomstige "reflectie_modus" of
  // "is_reflectie" als eerste zichtbaar wordt. Geen enkele exporteerbare waarde
  // mag een markering suggereren die in een log terecht zou kunnen komen.
  const alleWaarden = JSON.stringify({
    REFLECTIE_STATUSSEN,
    REFLECTIE_ACTIES,
    REFLECTIE_INGANGEN,
    INGANG_LABEL,
    INGANG_VERDIEPING,
    AFRONDLABELS,
  }).toLowerCase();
  for (const verdacht of ["retrieval_meta", "governance_log", "modus:", "audit"]) {
    assert.equal(alleWaarden.includes(verdacht), false, verdacht);
  }
});

console.log(`\n${n} sanity-tests geslaagd (reflectie-flow).`);
