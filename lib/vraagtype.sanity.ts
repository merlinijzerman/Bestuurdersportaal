// ============================================================
//  Sanity-tests voor lib/vraagtype.ts (increment 2).
//
//  Verifieert de risicovolle, pure logica: vraagtype-detectie (breed vs.
//  specifiek), strategiekeuze t.o.v. de drempel, en de batch-splitsing incl.
//  de harde bovengrens (afkap-signaal).
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/vraagtype.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  bepaalVraagtype,
  schatTokens,
  kiesStrategie,
  maakBatches,
  bepaalAntwoordmodus,
  retrievalModusVoor,
  moetWisselMeldingTonen,
  bepaalInlineMeldingen,
  bronbasisLabel,
  bepaalVervolgacties,
  isBesluitvormingsgericht,
  ZICHTBARE_ANTWOORDMODI,
  bepaalBronIntent,
  moetVerduidelijken,
  bepaalAutoBronModus,
  VERDUIDELIJKING_OPTIES,
} from "./vraagtype";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("vraagtype sanity-tests:");

// ── Vraagtype-detectie: breed ──
const breed = [
  "Vat dit document samen",
  "Kun je een samenvatting geven?",
  "Welke risico's noemt dit stuk?",
  "Welke besluiten worden gevraagd?",
  "Beoordeel dit voorstel",
  "Waar gaat dit document over?",
  "Geef een overzicht van de hoofdpunten",
  "Welke kritische vragen moet ik stellen?",
  "Wat is de rode draad in dit stuk?",
  "Evalueer de onderbouwing",
];
for (const v of breed) {
  test(`breed: "${v}"`, () => assert.equal(bepaalVraagtype(v), "breed"));
}

// ── Vraagtype-detectie: specifiek ──
const specifiek = [
  "Wat is de deadline in artikel 3?",
  "Welk percentage dekkingsgraad wordt genoemd?",
  "Staat er iets over de premie?",
  "Wie is de verantwoordelijke bestuurder?",
  "Op welke datum is het vastgesteld?",
];
for (const v of specifiek) {
  test(`specifiek: "${v}"`, () => assert.equal(bepaalVraagtype(v), "specifiek"));
}

// ── Diacritics/casing robuust ──
test("hoofdletters en accenten storen detectie niet", () => {
  assert.equal(bepaalVraagtype("VAT DIT SAMEN"), "breed");
  assert.equal(bepaalVraagtype("Welke risico's"), "breed");
});

// ── schatTokens ──
test("schatTokens ≈ tekens/4", () => {
  assert.equal(schatTokens(""), 0);
  assert.equal(schatTokens("abcd"), 1);
  assert.equal(schatTokens("a".repeat(401)), 101);
});

// ── kiesStrategie ──
test("specifiek → targeted (ongeacht grootte)", () => {
  assert.equal(kiesStrategie("specifiek", 999999, 48000), "targeted");
});
test("breed onder drempel → full_document", () => {
  assert.equal(kiesStrategie("breed", 1000, 48000), "full_document");
  assert.equal(kiesStrategie("breed", 48000, 48000), "full_document"); // grens inclusief
});
test("breed boven drempel → map_reduce", () => {
  assert.equal(kiesStrategie("breed", 48001, 48000), "map_reduce");
});

// ── maakBatches ──
function chunk(tokens: number) {
  return { tekst: "x".repeat(tokens * 4) }; // ≈ `tokens` tokens
}

test("alles past in één batch", () => {
  const r = maakBatches([chunk(10), chunk(10), chunk(10)], 100, 10);
  assert.equal(r.batches.length, 1);
  assert.equal(r.afgekapt, false);
});

test("splitst zodra het tokenbudget wordt overschreden", () => {
  // 3× 40 tokens, budget 100 → batch1: 40+40=80, batch2: 40.
  const r = maakBatches([chunk(40), chunk(40), chunk(40)], 100, 10);
  assert.equal(r.batches.length, 2);
  assert.deepEqual(r.batches.map((b) => b.length), [2, 1]);
  assert.equal(r.afgekapt, false);
});

test("harde bovengrens kapt af en signaleert dat", () => {
  // 4 chunks van elk 60 tokens, budget 50 → elke chunk eigen batch; max 2 batches.
  const r = maakBatches([chunk(60), chunk(60), chunk(60), chunk(60)], 50, 2);
  assert.equal(r.batches.length, 2);
  assert.equal(r.afgekapt, true);
});

test("lege invoer → geen batches, niet afgekapt", () => {
  const r = maakBatches([], 100, 10);
  assert.equal(r.batches.length, 0);
  assert.equal(r.afgekapt, false);
});

// ── Antwoordmodusfamilie (Increment G) ──
test("reflectieve/afwegende vraag → sparring", () => {
  assert.equal(bepaalAntwoordmodus("Speel eens advocaat van de duivel bij dit voorstel"), "sparring");
  assert.equal(bepaalAntwoordmodus("Wat mis ik in deze analyse?"), "sparring");
  assert.equal(bepaalAntwoordmodus("Wees kritisch op dit beleid"), "sparring");
  assert.equal(bepaalAntwoordmodus("Wat zou jij hiervan vinden?"), "sparring");
  assert.equal(bepaalAntwoordmodus("Waar zou ik me zorgen over moeten maken?"), "sparring");
});
test("besluitrijpheid-vraag → besluitrijpheid", () => {
  assert.equal(bepaalAntwoordmodus("Is dit besluitrijp?"), "besluitrijpheid");
  assert.equal(bepaalAntwoordmodus("Kunnen we hierover besluiten?"), "besluitrijpheid");
  assert.equal(bepaalAntwoordmodus("Is dit voldoende onderbouwd om te besluiten?"), "besluitrijpheid");
});
test("historische vraag → historisch", () => {
  assert.equal(bepaalAntwoordmodus("Wat was het beleid destijds?"), "historisch");
  assert.equal(bepaalAntwoordmodus("Geef de historie van dit dossier"), "historisch");
  assert.equal(bepaalAntwoordmodus("Wat stond er in de vorige versie?"), "historisch");
});
test("duidingsvraag → duiding", () => {
  assert.equal(bepaalAntwoordmodus("Kun je dit duiden?"), "duiding");
  assert.equal(bepaalAntwoordmodus("Wat betekent dit voor ons bestuur?"), "duiding");
  assert.equal(bepaalAntwoordmodus("Wat zijn de implicaties van deze brief?"), "duiding");
});
test("bronoverzichtsvraag → bronoverzicht", () => {
  assert.equal(bepaalAntwoordmodus("Welke documenten gaan over de dekkingsgraad?"), "bronoverzicht");
  assert.equal(bepaalAntwoordmodus("Geef een overzicht van de bronnen"), "bronoverzicht");
});
test("neutrale feitvraag → feitelijk (default)", () => {
  assert.equal(bepaalAntwoordmodus("Wat is de dekkingsgraad eind 2025?"), "feitelijk");
  assert.equal(bepaalAntwoordmodus("Op welke datum is het beleid vastgesteld?"), "feitelijk");
});
test("sparring wint van zwakkere signalen bij dubbele match", () => {
  // bevat zowel 'implicaties' (duiding) als 'wat mis ik' (sparring) → sparring eerst.
  assert.equal(
    bepaalAntwoordmodus("Wat zijn de implicaties en wat mis ik hierin?"),
    "sparring"
  );
});

// ── retrievalModusVoor ──
test("antwoordmodus → retrieval-scope mapping", () => {
  assert.equal(retrievalModusVoor("feitelijk"), "actueel");
  assert.equal(retrievalModusVoor("duiding"), "actueel");
  assert.equal(retrievalModusVoor("sparring"), "actueel");
  assert.equal(retrievalModusVoor("bronoverzicht"), "actueel");
  assert.equal(retrievalModusVoor("persoonlijke_voorbereiding"), "actueel");
  assert.equal(retrievalModusVoor("historisch"), "historisch");
  assert.equal(retrievalModusVoor("besluitrijpheid"), "besluitvorming");
});

// ── moetWisselMeldingTonen ──
test("wissel-melding alleen bij autodetectie van een niet-default modus", () => {
  assert.equal(moetWisselMeldingTonen("sparring", null), true);   // autodetectie + afwijkend
  assert.equal(moetWisselMeldingTonen("feitelijk", null), false); // default, geen verrassing
  assert.equal(moetWisselMeldingTonen("sparring", "sparring"), false); // bewust vastgezet
  assert.equal(moetWisselMeldingTonen("duiding", "feitelijk"), false); // vastgezet ≠ null
});

// ── Increment I-1: zichtbare modusset ──
test("zichtbare modusset = feitelijk/duiding/sparring (Auto = null in UI)", () => {
  assert.deepEqual(ZICHTBARE_ANTWOORDMODI, ["feitelijk", "duiding", "sparring"]);
  // historisch/besluitrijpheid blijven intern bestaan, maar niet als knop.
  assert.ok(!ZICHTBARE_ANTWOORDMODI.includes("historisch" as never));
  assert.ok(!ZICHTBARE_ANTWOORDMODI.includes("besluitrijpheid" as never));
});

// ── Increment I-1: inline-meldingen (FO §11c, zes uitzonderingen) ──
function types(ms: { type: string }[]) {
  return ms.map((m) => m.type);
}

// Negatieve test (a) — VERPLICHT: fondsgebonden vraag zonder fondstreffer.
test("combineren + 0 treffers → geen_fondstreffer (algemene kennis)", () => {
  const m = bepaalInlineMeldingen({
    bronModus: "combineren",
    antwoordmodus: "feitelijk",
    aantalBronnen: 0,
    scopeActief: false,
  });
  assert.deepEqual(types(m), ["geen_fondstreffer"]);
});

// Negatieve test (b) — VERPLICHT: interpretatieve duiding.
test("antwoordmodus duiding → interpretatieve_duiding", () => {
  const m = bepaalInlineMeldingen({
    bronModus: "combineren",
    antwoordmodus: "duiding",
    aantalBronnen: 3,
    scopeActief: false,
  });
  assert.ok(types(m).includes("interpretatieve_duiding"));
});

test("strikt (documenten) + treffers → alleen_fondsdocumenten", () => {
  const m = bepaalInlineMeldingen({
    bronModus: "documenten",
    antwoordmodus: "feitelijk",
    aantalBronnen: 2,
    scopeActief: false,
  });
  assert.deepEqual(types(m), ["alleen_fondsdocumenten"]);
});

test("strikt (documenten) + 0 treffers → onvoldoende_basis", () => {
  const m = bepaalInlineMeldingen({
    bronModus: "documenten",
    antwoordmodus: "feitelijk",
    aantalBronnen: 0,
    scopeActief: false,
  });
  assert.deepEqual(types(m), ["onvoldoende_basis"]);
});

test("scope-actief telt als strikt, ongeacht bron-modus", () => {
  const m = bepaalInlineMeldingen({
    bronModus: "combineren",
    antwoordmodus: "feitelijk",
    aantalBronnen: 1,
    scopeActief: true,
  });
  assert.deepEqual(types(m), ["alleen_fondsdocumenten"]);
});

test("combineren + treffers + algemene-kennis-markers → algemene_kennis_fonds (#4)", () => {
  const m = bepaalInlineMeldingen({
    bronModus: "combineren",
    antwoordmodus: "feitelijk",
    aantalBronnen: 3,
    scopeActief: false,
    algemeneKennisMarkers: 2,
  });
  assert.deepEqual(types(m), ["algemene_kennis_fonds"]);
});

test("rustige weergave: combineren + treffers, geen markers → géén melding", () => {
  const m = bepaalInlineMeldingen({
    bronModus: "combineren",
    antwoordmodus: "feitelijk",
    aantalBronnen: 3,
    scopeActief: false,
  });
  assert.deepEqual(types(m), []);
});

test("algemene vraag → geen bron-melding (bewuste keuze)", () => {
  const m = bepaalInlineMeldingen({
    bronModus: "algemeen",
    antwoordmodus: "feitelijk",
    aantalBronnen: 0,
    scopeActief: false,
  });
  assert.deepEqual(types(m), []);
});

test("besluitrijpheid → onzekerheid_besluit (#6)", () => {
  const m = bepaalInlineMeldingen({
    bronModus: "combineren",
    antwoordmodus: "besluitrijpheid",
    aantalBronnen: 1,
    scopeActief: false,
  });
  assert.ok(types(m).includes("onzekerheid_besluit"));
});

// ── Increment I-1: bronbasis-label ──
test("bronbasisLabel dekt alle bron-modi + scope", () => {
  assert.equal(bronbasisLabel("documenten", 2, false), "Uitsluitend fondsdocumenten");
  assert.equal(bronbasisLabel("documenten", 0, false), "Geen fondsdocumenten gevonden");
  assert.equal(
    bronbasisLabel("combineren", 2, false),
    "Fondsdocumenten, aangevuld met algemene kennis"
  );
  assert.equal(
    bronbasisLabel("combineren", 0, false),
    "Algemene kennis (geen fondsdocumenten gevonden)"
  );
  assert.equal(bronbasisLabel("algemeen", 0, false), "Algemene kennis (geen interne bronnen)");
  assert.equal(bronbasisLabel("combineren", 5, true), "Geselecteerde documenten");
});

// ── Increment I-1: vervolgacties (FO §13) ──
test("isBesluitvormingsgericht: duiding/besluitrijpheid + besluitsignalen", () => {
  assert.equal(isBesluitvormingsgericht("Wat is de dekkingsgraad?", "duiding"), true);
  assert.equal(isBesluitvormingsgericht("Wat is de dekkingsgraad?", "besluitrijpheid"), true);
  assert.equal(isBesluitvormingsgericht("Kunnen we dit voorstel goedkeuren?", "feitelijk"), true);
  assert.equal(isBesluitvormingsgericht("Wat is de premie in 2025?", "feitelijk"), false);
});

test("vervolgacties bieden GEEN 'Toon gebruikte bronnen' meer aan (paneel staat er al)", () => {
  const a = bepaalVervolgacties("Wat is de premie?", "feitelijk", true);
  assert.ok(!a.some((x) => x.type === "toon_bronnen"));
});

test("vervolgacties: besluitvormingsvraag → Werk uit richting besluitvorming", () => {
  const a = bepaalVervolgacties("Is dit voorstel besluitrijp?", "besluitrijpheid", true);
  const wu = a.find((x) => x.type === "werk_uit_besluitvorming");
  assert.ok(wu);
  assert.equal(wu!.modus, "besluitrijpheid");
  assert.equal(wu!.hergebruikScope, false);
});

test("vervolgacties: niet altijd alle knoppen — feitelijk zonder besluit/historie", () => {
  const a = bepaalVervolgacties("Wat is de premie in 2025?", "feitelijk", true);
  const t = a.map((x) => x.type);
  assert.ok(!t.includes("werk_uit_besluitvorming")); // geen besluitsignaal
  assert.ok(!t.includes("maak_tijdlijn")); // geen historisch signaal
  assert.ok(!t.includes("maak_feitelijker")); // is al feitelijk
  assert.ok(t.includes("geef_duiding"));
  assert.ok(t.includes("stel_kritische_vragen"));
});

test("vervolgacties: historisch signaal → tijdlijn + eerdere besluiten", () => {
  const a = bepaalVervolgacties("Wat was het beleid in het verleden?", "historisch", true);
  const t = a.map((x) => x.type);
  assert.ok(t.includes("maak_tijdlijn"));
  assert.ok(t.includes("toon_eerdere_besluiten"));
});

test("vervolgacties: reformatteer-acties hergebruiken scope; verbredende niet", () => {
  const a = bepaalVervolgacties("Geef duiding bij dit voorstel", "duiding", true);
  const feit = a.find((x) => x.type === "maak_feitelijker");
  const wu = a.find((x) => x.type === "werk_uit_besluitvorming");
  assert.equal(feit!.hergebruikScope, true);
  assert.equal(wu!.hergebruikScope, false);
});

// ============================================================================
//  Increment I-2 (FO §11a) — automatische bronkeuze.
//  De brede meetset (40 contrastieve vragen) wordt getoetst in
//  lib/bronkeuze-classificatie.sanity.ts met de geaccordeerde drempels. Hier:
//  (1) de afgeleide helpers (auto-modus, verduidelijken, chip-opties) en
//  (2) GEDRAGSNEUTRALITEIT — de intent verandert de retrieval-modus NIET en
//      onderdrukt alleen de #1-melding bij een verwachte 'algemeen'-mis.
// ============================================================================

// ── bepaalAutoBronModus: combineren-vloer, tenzij expliciet beperkt ──
test("auto-bronmodus: vloer = combineren; restrictie = documenten", () => {
  assert.equal(bepaalAutoBronModus(false), "combineren");
  assert.equal(bepaalAutoBronModus(true), "documenten");
});

// ── moetVerduidelijken: alleen bij ONZEKER én geen fondsrestrictie ──
test("verduidelijken: alleen bij onzeker zonder fondsrestrictie", () => {
  assert.equal(
    moetVerduidelijken({ intent: "fonds", vertrouwen: "onzeker" }, false),
    true
  );
  // Restrictie aan → bron al gekozen, niet doorvragen.
  assert.equal(
    moetVerduidelijken({ intent: "fonds", vertrouwen: "onzeker" }, true),
    false
  );
  // Zekere intentie → nooit doorvragen.
  assert.equal(
    moetVerduidelijken({ intent: "fonds", vertrouwen: "zeker" }, false),
    false
  );
  assert.equal(
    moetVerduidelijken({ intent: "algemeen", vertrouwen: "zeker" }, false),
    false
  );
});

// ── Chip-opties: precies de twee bevestigingen ──
test("verduidelijking-opties = Voor mijn fonds / In algemene zin", () => {
  assert.deepEqual(
    VERDUIDELIJKING_OPTIES.map((o) => o.intent),
    ["fonds", "algemeen"]
  );
});

// ── Classificatie-kern: kernpatronen + de gevaarlijke nul-tolerantie ──
test("anker → fonds (zeker); generiek → algemeen (zeker)", () => {
  assert.deepEqual(bepaalBronIntent("Wat is ons beleggingsbeleid?"), {
    intent: "fonds",
    vertrouwen: "zeker",
  });
  assert.deepEqual(bepaalBronIntent("Wat is een dekkingsgraad?"), {
    intent: "algemeen",
    vertrouwen: "zeker",
  });
});

test("anker + generiek → gecombineerd (zeker)", () => {
  assert.deepEqual(
    bepaalBronIntent("Wijkt ons premiebeleid af van het wettelijk kader?"),
    { intent: "gecombineerd", vertrouwen: "zeker" }
  );
});

// Negatieve test (kritiek): de onzekere fallback leunt fondsgericht, NOOIT stil
// 'algemeen' — anders schijnzekerheid op afwezige fondsbronnen.
test("geen anker/signaal → fonds ONZEKER (nooit stil algemeen)", () => {
  const r = bepaalBronIntent("Hoe zit het met de solidariteitsreserve?");
  assert.equal(r.intent, "fonds");
  assert.equal(r.vertrouwen, "onzeker");
  assert.notEqual(r.intent, "algemeen");
});

// ── Gedragsneutraliteit t.o.v. Increment G ──
// (1) De intent stuurt NIET de retrieval-modus: ongeacht de intentie blijft de
//     auto-modus de combineren-vloer (alleen de fondsrestrictie wijzigt die).
test("neutraliteit: intent verandert de auto-retrieval-modus niet", () => {
  // Drie verschillende intenties, identieke (combineren) auto-modus.
  for (const v of [
    "Wat is ons beleggingsbeleid?", // fonds
    "Wat is een dekkingsgraad?", // algemeen
    "Hoe zit het met de solidariteitsreserve?", // onzeker
  ]) {
    void bepaalBronIntent(v);
    assert.equal(bepaalAutoBronModus(false), "combineren");
  }
});

// (2) bepaalInlineMeldingen is volledig intent-onafhankelijk: de melding hangt aan
//     wat er DAADWERKELIJK is opgehaald, niet aan de (mogelijk foute) intent-gok.
//     Schijnzekerheid-guardrail: combineren + 0 treffers krijgt ALTIJD
//     'geen_fondstreffer', zodat een fondsvraag die fout als 'algemeen' is
//     geclassificeerd nooit stil als fondsspecifiek antwoord overkomt.
test("schijnzekerheid-guardrail: combineren + 0 treffers → ALTIJD geen_fondstreffer", () => {
  const m = bepaalInlineMeldingen({
    bronModus: "combineren",
    antwoordmodus: "feitelijk",
    aantalBronnen: 0,
    scopeActief: false,
  });
  assert.deepEqual(types(m), ["geen_fondstreffer"]);
});

test("meldingen zijn intent-onafhankelijk: WEL treffers + duiding → duiding-melding, geen #1", () => {
  const m = bepaalInlineMeldingen({
    bronModus: "combineren",
    antwoordmodus: "duiding",
    aantalBronnen: 3,
    scopeActief: false,
  });
  assert.ok(types(m).includes("interpretatieve_duiding"));
  assert.ok(!types(m).includes("geen_fondstreffer"));
});

console.log(`\n${n} sanity-tests geslaagd.`);
