// ============================================================
//  Sanity-tests voor lib/vraagtype.ts (increment 2).
//
//  Verifieert de risicovolle, pure logica: vraagtype-detectie (breed vs.
//  specifiek), strategiekeuze t.o.v. de drempel, en de batch-splitsing incl.
//  de harde bovengrens (afkap-signaal).
//
//  Vitest-suite met node:assert voor bestaande assertionpariteit.
//  Uitvoeren: npx vitest run core/lib/vraagtype.test.ts
// ============================================================

import assert from "node:assert/strict";
import { test } from "vitest";
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
  isKorteBevestiging,
  bepaalAutoBronModus,
  VERDUIDELIJKING_OPTIES,
  isPersoonlijkeVraag,
  isStatusgerichteVraag,
  heeftPortaalstandNodig,
  isVoorstelvraag,
  isOpsteltaak,
  retrievalModusVoorVraag,
  meldingNietVastgesteldeStukken,
} from "./vraagtype";

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
test("zichtbare modusset = alleen sparring (Auto = null in UI)", () => {
  // Teruggebracht tot Auto (= null) + Sparren. Feiten en Duiding zijn geen
  // voorafknop meer maar vervolgacties ná een antwoord (zie bepaalVervolgacties).
  assert.deepEqual(ZICHTBARE_ANTWOORDMODI, ["sparring"]);
  // feitelijk/duiding/historisch/besluitrijpheid blijven intern bestaan (auto-
  // detectie + vervolgacties), maar niet als knop.
  assert.ok(!ZICHTBARE_ANTWOORDMODI.includes("feitelijk" as never));
  assert.ok(!ZICHTBARE_ANTWOORDMODI.includes("duiding" as never));
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

test("vervolgacties: ALGEMENE vraag (documentGericht=false) → Feiten/Duiding wél, lens/lengte niet", () => {
  // Sinds de modus-reductie (Auto + Sparren) zijn Feiten en Duiding geen voorafknop
  // meer maar vervolgacties op ELK antwoord — dus ook bij een algemene vraag. De
  // sparring-lens (kritische vragen) en de lengte-acties blijven documentgericht.
  const a = bepaalVervolgacties("Wat is de premie in 2025?", "feitelijk", true);
  const t = a.map((x) => x.type);
  assert.ok(t.includes("geef_duiding")); // Duiding nu breed beschikbaar
  assert.ok(!t.includes("maak_feitelijker")); // antwoord is al feitelijk
  assert.ok(!t.includes("werk_uit_besluitvorming")); // geen besluitsignaal
  assert.ok(!t.includes("maak_tijdlijn")); // geen historisch signaal
  assert.ok(!t.includes("stel_kritische_vragen")); // lens alleen documentgericht
  assert.ok(!t.includes("maak_korter")); // lengte alleen documentgericht
});

test("vervolgacties: DOCUMENTGERICHTE vraag → behoud duiding + kritische vragen", () => {
  const a = bepaalVervolgacties("Wat is de premie in 2025?", "feitelijk", true, true);
  const t = a.map((x) => x.type);
  assert.ok(!t.includes("maak_feitelijker")); // is al feitelijk
  assert.ok(t.includes("geef_duiding"));
  assert.ok(t.includes("stel_kritische_vragen"));
  assert.ok(t.includes("maak_korter")); // lengte-acties komen terug
  assert.ok(t.includes("maak_concreter"));
});

test("G1 (plateau B): tijdens een actieve reflectieflow zijn er GEEN vervolgacties", () => {
  // De rijkste set die de functie kan opleveren — documentgericht, historisch én
  // besluitvormingsgericht — moet leeg worden zodra reflectieActief aanstaat.
  const zonder = bepaalVervolgacties(
    "Is dit voorstel besluitrijp gezien het beleid in het verleden?",
    "besluitrijpheid",
    true,
    true,
    false
  );
  assert.ok(zonder.length > 0, "voorwaarde: zonder reflectie zijn er wél acties");

  const met = bepaalVervolgacties(
    "Is dit voorstel besluitrijp gezien het beleid in het verleden?",
    "besluitrijpheid",
    true,
    true,
    true
  );
  assert.deepEqual(met, []);

  // De default is false: bestaande aanroepers (die de parameter niet meegeven)
  // houden hun huidige gedrag.
  assert.deepEqual(
    bepaalVervolgacties("Is dit voorstel besluitrijp?", "besluitrijpheid", true, true),
    bepaalVervolgacties("Is dit voorstel besluitrijp?", "besluitrijpheid", true, true, false)
  );
});

test("vervolgacties: historisch signaal → tijdlijn + eerdere besluiten", () => {
  const a = bepaalVervolgacties("Wat was het beleid in het verleden?", "historisch", true);
  const t = a.map((x) => x.type);
  assert.ok(t.includes("maak_tijdlijn"));
  assert.ok(t.includes("toon_eerdere_besluiten"));
});

test("vervolgacties: reformatteer-acties hergebruiken scope; verbredende niet", () => {
  // documentGericht=true zodat maak_feitelijker (lens) wordt aangeboden.
  const a = bepaalVervolgacties("Geef duiding bij dit voorstel", "duiding", true, true);
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

// ── T5 C3: korte bevestiging onderdrukt de verduidelijkingsvraag ──
test("isKorteBevestiging herkent inhoudsloze instemming/voortzetting", () => {
  for (const v of [
    "ja",
    "Ja graag",
    "ja graag.",
    "Ja, graag",
    "doe maar",
    "Doe maar!",
    "ga door",
    "graag",
    "prima",
    "Akkoord",
    "oké",
    "dat is goed",
    "lijkt me goed",
    "inderdaad",
  ]) {
    assert.equal(isKorteBevestiging(v), true, `verwacht bevestiging: ${v}`);
  }
});

test("isKorteBevestiging laat echte vragen en langere turns ongemoeid", () => {
  for (const v of [
    "Ja, maar hoe zit het met de dekkingsgraad?",
    "Wat is ons beleggingsbeleid?",
    "Kun je dat toelichten voor de Wtp?",
    "graag een overzicht van de risico's per kwartaal alstublieft", // >40 tekens
    "nee",
    "",
  ]) {
    assert.equal(isKorteBevestiging(v), false, `mag geen bevestiging zijn: ${v}`);
  }
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

// ============================================================================
//  Contextbesef (besluit 0090) — persoonlijke/statusgerichte vragen + portaalstand.
//  De brede meetset (54 contrastieve vragen) wordt getoetst in
//  lib/bronkeuze-classificatie.sanity.ts. Hier: de acceptatiecriteria 1/2/3 als
//  expliciete cases + de drie nieuwe pure helpers.
// ============================================================================

// ── Acceptatiecriterium 1: persoonlijke vraag → fonds, zeker (geen terugvraag) ──
test("criterium 1: 'mijn volgende actie' → fonds zeker (geen verduidelijking)", () => {
  const r = bepaalBronIntent("Wat is mijn volgende actie om op te pakken?");
  assert.deepEqual(r, { intent: "fonds", vertrouwen: "zeker" });
  assert.equal(moetVerduidelijken(r, false), false); // geen verduidelijkingsvraag meer
});

// ── Acceptatiecriterium 2: zuiver algemene vraag blijft algemeen, géén portaalstand ──
test("criterium 2: 'Wtp over invaren' → algemeen én geen portaalstand", () => {
  const v = "Wat zegt de Wtp over invaren?";
  assert.equal(bepaalBronIntent(v).intent, "algemeen");
  assert.equal(heeftPortaalstandNodig(v), false); // criterium 6
});

// ── Acceptatiecriterium 3: persoonlijk + generiek → gecombineerd ──
test("criterium 3: 'Wtp voor mijn rol' → gecombineerd", () => {
  assert.deepEqual(bepaalBronIntent("Wat betekent de Wtp voor mijn rol?"), {
    intent: "gecombineerd",
    vertrouwen: "zeker",
  });
});

// ── isPersoonlijkeVraag: taak-/staatvraag herkennen, kennisvraag niet ──
test("isPersoonlijkeVraag: mijn/voor mij/moet ik; NIET 'moet ik weten' of kaal 'ik'", () => {
  assert.equal(isPersoonlijkeVraag("Wat is mijn volgende actie?"), true);
  assert.equal(isPersoonlijkeVraag("Welke stappen staan voor mij open?"), true);
  assert.equal(isPersoonlijkeVraag("Wat moet ik nog oppakken?"), true);
  assert.equal(isPersoonlijkeVraag("Wat vraagt de wet van mij?"), true);
  // Uitsluitingen: kennisvraag en kaal "ik".
  assert.equal(isPersoonlijkeVraag("Wat moet ik weten over tegenstrijdig belang?"), false);
  assert.equal(isPersoonlijkeVraag("Ik wil begrijpen wat een dekkingsgraad is."), false);
  assert.equal(isPersoonlijkeVraag("Wat is een dekkingsgraad?"), false);
});

// ── isStatusgerichteVraag: voortgang herkennen, kale onderwerpvraag niet ──
test("isStatusgerichteVraag: 'wat staat er open'/'hoe ver zijn we'; NIET 'hoe ver mag …'", () => {
  assert.equal(isStatusgerichteVraag("Wat staat er nog open?"), true);
  assert.equal(isStatusgerichteVraag("Hoe ver zijn we met het transitieplan?"), true);
  assert.equal(isStatusgerichteVraag("Wat is de status?"), true);
  // Bewust géén treffer: "hoe ver" zonder "zijn/staan we".
  assert.equal(isStatusgerichteVraag("Hoe ver mag de dekkingsgraad dalen?"), false);
  assert.equal(isStatusgerichteVraag("Wat is een dekkingsgraad?"), false);
});

// ── heeftPortaalstandNodig: persoonlijk OF status; zuiver algemeen niet ──
test("heeftPortaalstandNodig: persoonlijk óf status → true; zuiver algemeen → false", () => {
  assert.equal(heeftPortaalstandNodig("Wat is mijn volgende actie?"), true);
  assert.equal(heeftPortaalstandNodig("Wat staat er nog open?"), true);
  assert.equal(heeftPortaalstandNodig("Wat is een dekkingsgraad?"), false); // criterium 6
  assert.equal(heeftPortaalstandNodig("Wat zegt de Wtp over invaren?"), false);
});

// ── Voorstel-/conceptvragen (30-07-2026) ────────────────────────────────────
// Achtergrond: onder retrievalmodus 'actueel' filtert de RPC alles weg wat niet
// 'vastgesteld'/'van_kracht' is (harde conceptregel). Een vraag naar voorstellen
// zou daardoor per definitie niets vinden. Deze tests borgen dat zulke vragen de
// filter omzeilen, én dat gewone vragen dat NIET doen (anders komen concepten
// stil in elk antwoord terecht — precies wat de conceptregel voorkomt).
test("isVoorstelvraag: voorstel-/conceptsignalen herkend", () => {
  assert.equal(
    isVoorstelvraag("Welke bestuursvoorstellen liggen er voor wijzigen beleggingsbeleid?"),
    true
  );
  assert.equal(isVoorstelvraag("Wat ligt er voor ter besluitvorming?"), true);
  assert.equal(isVoorstelvraag("Zijn er concepten van het transitieplan?"), true);
  assert.equal(isVoorstelvraag("Welke agendastukken zijn er?"), true);
  assert.equal(isVoorstelvraag("Wat is nog niet vastgesteld?"), true);
});

test("isVoorstelvraag: gewone vragen zijn GEEN voorstelvraag", () => {
  // Geen staat-signaal → de conceptregel blijft gelden.
  assert.equal(isVoorstelvraag("Wat is de actuele dekkingsgraad van ons fonds?"), false);
  assert.equal(isVoorstelvraag("Wat houdt de Wtp op hoofdlijnen in?"), false);
  assert.equal(isVoorstelvraag("Hoe is onze solidariteitsreserve ingericht?"), false);
  // "conceptueel" mag geen treffer zijn (woordgrens).
  assert.equal(isVoorstelvraag("Is dit conceptueel houdbaar?"), false);
});

// ── 12-08-2026 — de samenstellingsbug en het vergaderstuk-vocabulaire ───────
// Aanleiding: conceptvergaderstukken werden niet gevonden, zelfs niet als er
// expliciet naar werd gevraagd. Twee oorzaken zaten in DEZE lijst.
//
//   1. De sluitende \b achter een vaste suffixlijst brak op Nederlandse
//      samenstellingen: "conceptnotulen" matchte niet, "conceptstuk" wel.
//   2. Vergaderstuk-vocabulaire ontbrak volledig, terwijl juist die stukken
//      per constructie op status 'concept' blijven staan.
test("isVoorstelvraag: conceptsamenstellingen worden herkend (regressie 12-08-2026)", () => {
  for (const v of [
    "Wat staat er in de conceptnotulen over de dekkingsgraad?",
    "Laat de conceptbegroting 2027 zien",
    "Wat zegt het conceptjaarverslag over de uitvoeringskosten?",
    "Is er een conceptbeleidsplan?",
    "Geef de conceptrapportage van Q2",
    "Wat staat er in de concept-notulen?",
    "Welke conceptversies zijn er van het transitieplan?",
  ]) {
    assert.equal(isVoorstelvraag(v), true, `zou een voorstelvraag moeten zijn: ${v}`);
  }
});

test("isVoorstelvraag: vergaderstuk-vocabulaire wordt herkend (12-08-2026)", () => {
  for (const v of [
    "Welke vergaderstukken liggen er voor donderdag?",
    "Wat staat er in de oplegnotitie bij agendapunt 4?",
    "Zijn er bestuursstukken over de premiedekkingsgraad?",
    "Wat is er geagendeerd voor de komende vergadering?",
    "Wat staat er op de agenda?",
    "Welke stukken voor de komende vergadering zijn er al?",
  ]) {
    assert.equal(isVoorstelvraag(v), true, `zou een voorstelvraag moeten zijn: ${v}`);
  }
});

// De grens blijft staan: de open staart op 'concept' mag NIET het denkkader-
// woord opslokken, en een gewone inhoudelijke vraag blijft onder 'actueel'.
test("isVoorstelvraag: de open concept-staart slokt 'conceptueel' niet op", () => {
  assert.equal(isVoorstelvraag("Is dit conceptueel houdbaar?"), false);
  assert.equal(isVoorstelvraag("Wat is het conceptuele kader achter de Wtp?"), false);
  assert.equal(isVoorstelvraag("Hoe conceptualiseren we het risicoraamwerk?"), false);
  // Geen staat-signaal → ongewijzigd gedrag.
  assert.equal(isVoorstelvraag("Wat is de premiedekkingsgraad per 1 juli?"), false);
  assert.equal(isVoorstelvraag("Hoe verloopt de uitvoering van het herstelplan?"), false);
});

test("retrievalModusVoorVraag: conceptvergaderstuk-vraag verlaat 'actueel'", () => {
  // Dit is het gedrag waar het om begonnen was: onder 'actueel' filtert de RPC
  // op documentstatus in ('vastgesteld','van_kracht') en is een conceptstuk per
  // definitie onvindbaar — ook als de gebruiker er letterlijk naar vraagt.
  assert.equal(
    retrievalModusVoorVraag("feitelijk", "Wat staat er in de conceptnotulen van juni?"),
    "besluitvorming"
  );
  assert.equal(
    retrievalModusVoorVraag("feitelijk", "Welke vergaderstukken liggen er voor donderdag?"),
    "besluitvorming"
  );
});

test("retrievalModusVoorVraag: voorstelvraag verlaat 'actueel', rest ongemoeid", () => {
  // Feitelijk zou 'actueel' zijn → voorstelvraag wordt 'besluitvorming'.
  assert.equal(
    retrievalModusVoorVraag("feitelijk", "Welke bestuursvoorstellen liggen er?"),
    "besluitvorming"
  );
  // Gewone feitelijke vraag blijft 'actueel' (geen gedragswijziging).
  assert.equal(
    retrievalModusVoorVraag("feitelijk", "Wat is de actuele dekkingsgraad?"),
    "actueel"
  );
  // Een modus die al niet op actualiteit filtert blijft ongemoeid.
  assert.equal(
    retrievalModusVoorVraag("historisch", "Welke voorstellen lagen er destijds?"),
    "historisch"
  );
  assert.equal(
    retrievalModusVoorVraag("besluitrijpheid", "Is dit voorstel besluitrijp?"),
    "besluitvorming"
  );
  // Gelijk aan de basisfunctie waar geen voorstel-/catalogussignaal is.
  for (const m of ["feitelijk", "duiding", "sparring"] as const) {
    assert.equal(
      retrievalModusVoorVraag(m, "Wat is de dekkingsgraad?"),
      retrievalModusVoor(m)
    );
  }
});

test("retrievalModusVoorVraag: catalogusvraag (bronoverzicht) → 'alles'", () => {
  // "Welke documenten zijn er over X" vraagt naar wat BESTAAT. Onder 'actueel'
  // verdwijnen concepten en vervallen stukken uit die inventaris en meldt de
  // assistent dat er niets is — de omgekeerde conclusie van de werkelijkheid.
  assert.equal(bepaalAntwoordmodus("Welke documenten ken je over het beleggingsbeleid?"), "bronoverzicht");
  assert.equal(
    retrievalModusVoorVraag("bronoverzicht", "Welke documenten ken je over het beleggingsbeleid?"),
    "alles"
  );
  assert.equal(
    retrievalModusVoorVraag("bronoverzicht", "Welke stukken zijn er over de wijziging beleggingsbeleid?"),
    "alles"
  );
  // Een historische of besluitvormingsgerichte modus blijft leidend.
  assert.equal(retrievalModusVoorVraag("historisch", "Welke documenten waren er destijds?"), "historisch");
});

test("meldingNietVastgesteldeStukken: aantal en enkelvoud/meervoud kloppen", () => {
  const een = meldingNietVastgesteldeStukken(1);
  assert.equal(een.type, "niet_vastgestelde_stukken");
  assert.ok(een.tekst.includes("1 stuk"), een.tekst);
  assert.ok(een.tekst.includes("is wel"), een.tekst);
  const drie = meldingNietVastgesteldeStukken(3);
  assert.ok(drie.tekst.includes("3 stukken"), drie.tekst);
  assert.ok(drie.tekst.includes("zijn wel"), drie.tekst);
  // Nooit suggereren dat er een actuele bron is (schijnzekerheid-guardrail).
  for (const m of [een, drie]) {
    assert.ok(/niet als actuele bron/i.test(m.tekst), m.tekst);
  }
});

// ── B1: opsteltaak-detectie (register-correctie) ────────────────────────────
test("isOpsteltaak vuurt op een producerend werkwoord + documentsoort", () => {
  for (const v of [
    "Stel een memo op over het partnerbegrip",
    "Kun je een notitie schrijven voor het bestuur?",
    "Schrijf een oplegger bij dit agendapunt",
    "Maak een memo over de dekkingsgraad",
    "Formuleer een bestuursvoorstel voor wijziging van het beleggingsbeleid",
    "Stel een concept-memo op",
  ]) {
    assert.equal(isOpsteltaak(v), true, v);
  }
});

test("isOpsteltaak blijft uit bij vragen ÓVER een stuk of zonder documentsoort", () => {
  for (const v of [
    "Wat staat er in de notitie over het partnerbegrip?",
    "Vat de memo samen",
    "Welke bestuursvoorstellen liggen er voor?", // voorstelvraag, geen opsteltaak
    "Geef bestuurlijke duiding",
    "Kunt u de impact-uitvraag aan de uitvoerder concreet uitwerken?",
    "Leg de dekkingsgraad uit",
  ]) {
    assert.equal(isOpsteltaak(v), false, v);
  }
});
