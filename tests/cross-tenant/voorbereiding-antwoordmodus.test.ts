// ============================================================================
//  §15-matrix — de voorbereiding als antwoordmodus (app-laag, T2 / #304).
// ----------------------------------------------------------------------------
//  De voorbereiding liep tot dit ticket door een eigen route zonder auditregel.
//  Ze loopt nu door `/api/chat`, en daarmee hangen vijf invarianten aan één
//  tak die niemand kan uitvoeren zonder een echte modelcall. Die zetten we hier
//  via bron-inspectie vast — hetzelfde patroon als portaalcontext-privacy.
//
//   (1) NOOIT EEN WEDERVRAAG. "Bereid dit punt voor" is een knopdruk, geen
//       vraag met een onzekere bron-intentie. Zou de verduidelijkingstak vuren,
//       dan krijgt de bestuurder na één klik een tegenvraag in plaats van zijn
//       voorbereiding. De grendel is dat agendapunt-modus `bronIntentResultaat`
//       op null zet; dat is een AANNAME zolang niemand haar vastlegt.
//   (2) ÉÉN TAK, ÉÉN ARGUMENT. De modus wisselt de regelset en verder niets;
//       acht van de negen `bouwSysteemBlokken`-call-sites blijven ongemoeid.
//   (3) RETRIEVAL-PARITEIT. Een agendapunt zónder gekoppelde stukken zoekt bij
//       een voorbereiding wél in de bibliotheek — mét de bibliotheekfilters.
//   (4) HET PRODUCT MAG DE BEURT NOOIT BREKEN. De bestuurder heeft zijn tekst
//       al gezien; een mislukte upsert wordt gemeld, niet gepromoveerd tot fout.
//   (5) TENANT- EN EIGENAARSGRENS. De upsert schrijft de server-afgeleide
//       gebruiker, nooit een waarde uit de request-body.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/voorbereiding-antwoordmodus.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

/**
 * Bron zonder commentaar. De "hoort hier niet meer te staan"-asserties gaan over
 * CODE; deze bestanden leggen in hun kop juist uit wát er is weggehaald, en die
 * toelichting mag de test niet rood maken — anders is de prijs van goed
 * gedocumenteerde code een falende test, en dat leert het verkeerde.
 */
const zonderCommentaar = (bron: string) =>
  bron.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const route = lees("app", "api", "chat", "route.ts");
const kaart = lees(
  "app",
  "(dashboard)",
  "vergaderingen",
  "_components",
  "VoorbereidingKaart.tsx"
);
const kaartCode = zonderCommentaar(kaart);

// ── (1) De verduidelijkingstak kan niet vuren ───────────────────────────────

test("voorbereiding — agendapunt-modus zet de bron-intentie op null (geen wedervraag)", () => {
  // `moetVerduidelijkenNu` eist `bronIntentResultaat !== null`. In agendapunt-
  // modus is dat resultaat per constructie null. Beide helften staan hier, want
  // los van elkaar bewijzen ze niets.
  assert.match(
    route,
    /const bronIntentResultaat[\s\S]{0,600}?scopeActief \|\| agendapuntModusActief \|\| bronloosBureau \|\| moduleScopeActief\s*\?\s*null/,
    "agendapunt-modus moet bronIntentResultaat op null zetten"
  );
  assert.match(
    route,
    /const moetVerduidelijkenNu =[\s\S]{0,400}?bronIntentResultaat !== null/,
    "de verduidelijkingstak moet op bronIntentResultaat !== null hangen"
  );
});

// ── (2) Eén tak, één argument ───────────────────────────────────────────────

test("voorbereiding — de modus wisselt de regelset, niets anders", () => {
  assert.match(
    route,
    /bouwSysteemBlokken\(\s*antwoordmodus === "persoonlijke_voorbereiding"\s*\?\s*SP_VOORBEREIDING_REGELS\s*:\s*SP_AGENDAPUNT_REGELS,/,
    "de selectie hoort één ternair argument te zijn in de bestaande agendapunt-tak"
  );
});

test("voorbereiding — er is precies ÉÉN call-site met SP_VOORBEREIDING_REGELS", () => {
  const treffers = route.match(/SP_VOORBEREIDING_REGELS/g) ?? [];
  // Eén import + één gebruik. Een derde treffer betekent een tweede tak, en dat
  // is precies de divergentie die dit ticket opheft.
  assert.equal(
    treffers.length,
    2,
    `verwacht 1 import + 1 gebruik, gevonden ${treffers.length}`
  );
});

test("voorbereiding — het aantal bouwSysteemBlokken-call-sites is onveranderd", () => {
  const callSites = route.match(/bouwSysteemBlokken\(/g) ?? [];
  // Negen bij aanvang van T2 (één import niet meegeteld: die staat als naam in
  // de importlijst zonder haakje). Groeit dit getal, dan is er een tak bij
  // gekomen en klopt de nulgrens uit de werkopdracht niet meer.
  assert.equal(callSites.length, 9, `verwacht 9 call-sites, gevonden ${callSites.length}`);
});

// ── (3) Retrieval-pariteit met de vervallen route ───────────────────────────

test("voorbereiding — zonder gekoppelde stukken wordt er wél geretrieved", () => {
  assert.match(
    route,
    /const voorbereidingZonderStukken =\s*agendapuntModusActief &&\s*!agendapuntMetStukken &&\s*antwoordmodus === "persoonlijke_voorbereiding";/,
    "de conditie moet uitsluitend door de nieuwe modus bereikbaar zijn"
  );
  assert.match(
    route,
    /agendapuntModusActief\s*\?\s*agendapuntMetStukken \|\| voorbereidingZonderStukken/,
    "moetRetrieven moet de bronloze voorbereiding toelaten"
  );
});

test("voorbereiding — die bibliotheekzoektocht draagt de status-/actualiteitsfilter", () => {
  // Zonder deze uitzondering zou de bronloze voorbereiding als enige tak de hele
  // bibliotheek inclusief historische stukken ongefilterd binnenhalen.
  assert.match(
    route,
    /voorbereidingZonderStukken\s*\?\s*bibliotheekFilters/,
    "de bronloze voorbereiding moet bibliotheekFilters dragen, niet undefined"
  );
});

test("voorbereiding — de bronkop belooft geen [gekoppeld stuk] als er geen stukken zijn", () => {
  // maakContext zet zonder primaire ids géén herkomstlabel; een kop die die
  // markering wél belooft laat het model een onderscheid benoemen dat in de
  // bronblokken niet bestaat.
  assert.match(
    route,
    /voorbereidingZonderStukken && chunks\.length > 0\s*\?\s*`[^`]*BRONNEN UIT DE BIBLIOTHEEK/,
    "de bronloze voorbereiding hoort een eigen, eerlijke bronkop te krijgen"
  );
});

// ── (4) Het product mag de beurt nooit breken ───────────────────────────────

test("voorbereiding — een mislukte upsert breekt het antwoord niet", () => {
  const blok =
    /antwoordmodus === "persoonlijke_voorbereiding" && agendapuntSeed\)\s*\{\s*try \{[\s\S]*?\} catch \(productFout\) \{[\s\S]*?console\.error\([\s\S]*?inlineMeldingenFinaal\.push\(/;
  assert.match(
    route,
    blok,
    "het wegschrijven hoort in een eigen try/catch met een melding, niet in de outer catch"
  );
  // En de melding mag niet stil zijn: de bestuurder moet weten dat de kaart de
  // uitkomst niet bewaart, anders denkt hij dat het punt is voorbereid.
  assert.match(route, /kon niet bij het agendapunt worden bewaard/);
});

test("voorbereiding — het wegschrijven staat ná de auditregel", () => {
  const audit = route.indexOf('schrijf_ai_interactie');
  const product = route.indexOf('.from("voorbereidingen")');
  assert.ok(audit > -1 && product > audit, "de auditregel gaat vóór het product");
});

// ── (5) Tenant- en eigenaarsgrens ───────────────────────────────────────────

test("voorbereiding — de upsert schrijft de server-afgeleide gebruiker", () => {
  assert.match(
    route,
    /\.from\("voorbereidingen"\)\s*\.upsert\(\s*\{[\s\S]{0,400}?gebruiker_id: ctx\.gebruikerId,/,
    "gebruiker_id moet uit de wrappercontext komen, nooit uit de request-body"
  );
  assert.match(
    route,
    /\.from\("voorbereidingen"\)[\s\S]{0,700}?agendapunt_id: agendapuntSeed\.id,/,
    "agendapunt_id moet de server-gevalideerde seed zijn, niet de rauwe body-waarde"
  );
});

test("voorbereiding — de upsert raakt alleen de kolommen die dit pad bezit", () => {
  const blok = /\.upsert\(\s*\{([\s\S]*?)\},\s*\{ onConflict: "agendapunt_id,gebruiker_id" \}/.exec(
    route
  );
  assert.ok(blok, "upsert met onConflict op de unique-constraint niet gevonden");
  // eigen_notities/vrije_notities horen NIET in de payload: PostgREST zet bij een
  // conflict uitsluitend de meegestuurde kolommen, dus dit is precies wat de
  // aantekeningen van de notities-route in stand houdt.
  for (const verboden of ["eigen_notities", "vrije_notities", "diepte"]) {
    assert.equal(
      blok![1].includes(verboden),
      false,
      `${verboden} hoort niet bij dit schrijfpad — dat zou andermans kolom overschrijven`
    );
  }
});

// ── De kaart ────────────────────────────────────────────────────────────────

test("voorbereiding — de kaart heeft geen eigen fetch/SSE-lus meer", () => {
  assert.equal(
    /fetch\(/.test(kaartCode),
    false,
    "de kaart mag geen eigen verzoek meer doen; het paneel voert de beurt uit"
  );
  assert.equal(
    kaartCode.includes("/api/agendapunten/"),
    false,
    "de kaart mag de vervallen voorbereidingsroute niet meer aanroepen"
  );
  assert.equal(
    /getReader\(|TextDecoder/.test(kaartCode),
    false,
    "de laatste eigen SSE-lus buiten useAssistent hoort weg te zijn"
  );
});

test("voorbereiding — de kaart leest het product, niet een gesprekquery", () => {
  assert.match(kaartCode, /\.from\("voorbereidingen"\)/);
  assert.equal(
    kaartCode.includes('.from("gesprekken")'),
    false,
    "de gesprekquery op document_scope->agendapunt_context hoort weg te zijn"
  );
  assert.equal(kaartCode.includes("agendapunt_context"), false);
});

test("voorbereiding — de startbeurt draagt de OPGELOSTE agendapuntcontext, niet de state", () => {
  // `pasIngangToe` zet de context via een state-setter en het oppervlak verstuurt
  // in dezelfde tick; de gespreksstaat wijst dan nog naar de vorige waarde.
  // Zonder deze override loopt de voorbereiding als gewone bibliotheekvraag:
  // andere prompt-tak, geen toelichtingsseed, geen gekoppelde stukken — en
  // niets in de interface dat dat verklaart. Zelfde val als `persistScope`.
  const oppervlak = lees(
    "app",
    "(dashboard)",
    "ai",
    "_components",
    "AssistentOppervlak.tsx"
  );
  assert.match(
    oppervlak,
    /const patch = await pasIngangToe\(aanvraag\.ingangen\);/,
    "de opgeloste patch moet worden opgevangen"
  );
  assert.match(
    oppervlak,
    /agendapuntContextOverride: patch\.agendapuntContext \?\? null,/,
    "de startbeurt moet de opgeloste context expliciet meegeven"
  );
});

test("voorbereiding — de kaart stuurt de modus als per-beurt-override mee", () => {
  assert.match(
    kaart,
    /antwoordmodus: "persoonlijke_voorbereiding" as const/,
    "de startbeurt moet de modus dragen"
  );
  assert.match(
    kaart,
    /productVoorAgendapunt: agendapuntId/,
    "zonder dit signaal ziet de bestuurder de uitkomst pas na een herlaadbeurt"
  );
});
