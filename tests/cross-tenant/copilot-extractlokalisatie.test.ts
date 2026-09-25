// ============================================================================
//  #413 T4-C — Het extract is een aanwijzer, geen bron.
// ----------------------------------------------------------------------------
//  Hermetisch: geen netwerk, geen database.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PASSAGE_TEKENS,
  MIN_EXTRACT_TEKENS,
  lokaliseerEersteBruikbare,
  lokaliseerExtract,
  normaliseerMetIndexkaart,
  normaliseerVoorLokalisatie,
} from "../../core/lib/microsoft-retrieval/extractlokalisatie";
import type { TekstSegment } from "../../core/lib/document-extractie";

const segment = (tekst: string, pagina: number | null = 1, paragraaf: string | null = null): TekstSegment =>
  ({ tekst, pagina, paragraaf });

const ZIN = "De hersteltermijn voor Koraalmaat 47 bedraagt twaalf maanden na vaststelling.";

test("de passage komt UIT DE EIGEN EXTRACTIE, niet uit het extract", () => {
  // Het extract is anders geschreven (kapitalisatie, typografische tekens);
  // wat terugkomt is de eigen, leesbare tekst.
  const uitkomst = lokaliseerExtract([segment(ZIN)], "DE HERSTELTERMIJN VOOR KORAALMAAT 47 BEDRAAGT TWAALF MAANDEN");
  assert.ok(uitkomst.ok);
  assert.equal(uitkomst.lokalisatie.passage, ZIN);
  assert.equal(uitkomst.lokalisatie.pagina, 1);
});

test("opmaakverschillen mogen de lokalisatie niet laten stuklopen", () => {
  const eigen = segment("Het bestuur besluit — conform artikel 3 — tot een hersteltermijn van 12 maanden.");
  for (const extract of [
    "Het bestuur besluit - conform artikel 3 - tot een hersteltermijn van 12 maanden.",
    "Het  bestuur   besluit — conform artikel 3 — tot een hersteltermijn van 12 maanden.",
    "het bestuur besluit – conform artikel 3 – tot een hersteltermijn van 12 maanden.",
  ]) {
    const uitkomst = lokaliseerExtract([eigen], extract);
    assert.ok(uitkomst.ok, extract);
  }
});

test("typografische aanhalingstekens en harde spaties tellen als gewoon", () => {
  const eigen = segment("In de “beleidsnota” staat dat de dekkingsgraad hersteld moet worden.");
  const uitkomst = lokaliseerExtract([eigen], 'In de "beleidsnota" staat dat de dekkingsgraad hersteld moet worden.');
  assert.ok(uitkomst.ok);
});

test("normalisatie verandert geen woorden en geen volgorde", () => {
  assert.equal(normaliseerVoorLokalisatie("  Twee   Woorden  "), "twee woorden");
  assert.equal(normaliseerVoorLokalisatie("a\tb\nc"), "a b c");
  // Woorden blijven staan; er wordt niets weggefilterd.
  assert.equal(normaliseerVoorLokalisatie("de 12 maanden!"), "de 12 maanden!");
});

test("TWEE TREFFERS is ambigu en valt fail-closed af", () => {
  // Dezelfde zin twee keer in hetzelfde document: dan is niet aan te wijzen
  // welke passage geciteerd wordt.
  const uitkomst = lokaliseerExtract([segment(`${ZIN} Later in het stuk: ${ZIN}`)], ZIN);
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "lokalisatie");
});

test("twee treffers in VERSCHILLENDE segmenten zijn even ambigu", () => {
  const uitkomst = lokaliseerExtract([segment(ZIN, 1), segment(ZIN, 7)], ZIN);
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "lokalisatie");
});

test("NUL TREFFERS: het extract staat niet meer in de actuele tekst", () => {
  const uitkomst = lokaliseerExtract([segment(ZIN)], "Een zin die in dit document helemaal niet voorkomt.");
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "lokalisatie");
});

test("een te kort extract bewijst niets", () => {
  const kort = "korte tekst";
  assert.ok(kort.length < MIN_EXTRACT_TEKENS);
  const uitkomst = lokaliseerExtract([segment(`${kort} en verder nog veel meer inhoud hier`)], kort);
  assert.equal(uitkomst.ok, false);
  assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "extractie");
});

test("een leeg of louter opgemaakt extract valt af", () => {
  for (const extract of ["", "   ", "  ", "— —"]) {
    const uitkomst = lokaliseerExtract([segment(ZIN)], extract);
    assert.equal(uitkomst.ok, false, JSON.stringify(extract));
    assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "extractie");
  }
});

test("pagina en paragraaf komen uit het EIGEN segment", () => {
  const uitkomst = lokaliseerExtract(
    [segment("Niets hier te vinden voor deze naald.", 3, "1.1"), segment(ZIN, 9, "4.2")],
    ZIN,
  );
  assert.ok(uitkomst.ok);
  assert.equal(uitkomst.lokalisatie.pagina, 9);
  assert.equal(uitkomst.lokalisatie.paragraaf, "4.2");
});

test("een lange passage wordt begrensd, rond de treffer", () => {
  const vulling = "Achtergrondtekst die veel ruimte inneemt. ".repeat(80); // > 3000 tekens
  const uitkomst = lokaliseerExtract([segment(`${vulling}${ZIN}${vulling}`)], ZIN);
  assert.ok(uitkomst.ok);
  assert.ok(uitkomst.lokalisatie.passage.length <= MAX_PASSAGE_TEKENS, "passage is niet begrensd");
  assert.ok(uitkomst.lokalisatie.passage.includes("hersteltermijn"), "de treffer valt buiten het venster");
});

test("OFFSETMAPPING: het venster ligt om de treffer, ook als de tekst samentrekt", () => {
  // De genormaliseerde en de leesbare tekst hebben NIET dezelfde lengte: elke
  // reeks witruimte wordt één spatie. Met dubbele spaties vóór de treffer liep
  // dat in de meting 600 tekens uiteen — genoeg om het venster volledig naast
  // de treffer te leggen terwijl de test op "bevat het woord" nog slaagde.
  // De vulling is zo gekozen dat de drift (hier ~2000 tekens) GROTER is dan het
  // venster: zonder vertaalslag valt de treffer er gegarandeerd buiten. Met een
  // kleinere vulling kan een verschoven venster de zin toevallig nog raken, en
  // dan bewijst de test niets.
  const vulling = "Veel   witruimte   en   dubbele   spaties.   ".repeat(200);
  const eigen = segment(`${vulling}${ZIN}${vulling}`);
  const uitkomst = lokaliseerExtract([eigen], ZIN);
  assert.ok(uitkomst.ok);

  const passage = uitkomst.lokalisatie.passage;
  assert.ok(passage.length <= MAX_PASSAGE_TEKENS);
  // De VOLLEDIGE zin moet in de passage staan, niet alleen een los woord dat
  // toevallig ook in de vulling voorkomt.
  assert.ok(passage.includes(ZIN), "de treffer valt buiten het venster");

  // En het bewijs dat de twee teksten werkelijk uiteenlopen: zonder vertaalslag
  // zou de positie honderden tekens verschoven zijn.
  const kaart = normaliseerMetIndexkaart(eigen.tekst);
  const positieGenormaliseerd = kaart.tekst.indexOf(normaliseerVoorLokalisatie(ZIN));
  const positieLeesbaar = kaart.naarLeesbaar[positieGenormaliseerd];
  assert.ok(positieGenormaliseerd >= 0);
  assert.ok(
    positieLeesbaar - positieGenormaliseerd > 100,
    `verwacht een forse drift, gemeten ${positieLeesbaar - positieGenormaliseerd}`,
  );
  assert.equal(kaart.leesbaar.slice(positieLeesbaar, positieLeesbaar + ZIN.length), ZIN);
});

test("de indexkaart wijst elk genormaliseerd teken naar zijn eigen bron", () => {
  const kaart = normaliseerMetIndexkaart("  A\t\tB  ");
  assert.equal(kaart.tekst, "a b");
  // "a" komt uit index 2, de spatie uit de eerste tab (3), "B" uit index 5.
  assert.deepEqual(kaart.naarLeesbaar, [2, 3, 5]);
  assert.equal(kaart.leesbaar.slice(kaart.naarLeesbaar[2], kaart.naarLeesbaar[2] + 1), "B");
});

test("normaliseerVoorLokalisatie en de indexkaart zijn dezelfde implementatie", () => {
  // Twee implementaties van dezelfde normalisatie lopen vroeg of laat uiteen,
  // en dan zoekt de naald anders dan de hooiberg.
  for (const proef of [ZIN, "  dubbele   spaties  ", "Typografie: “quote” — streepje", "ÉÉN Hoofdletter"]) {
    assert.equal(normaliseerVoorLokalisatie(proef), normaliseerMetIndexkaart(proef).tekst, proef);
  }
});

test("de eerste bruikbare van meerdere extracts wint", () => {
  const segmenten = [segment(ZIN)];
  const uitkomst = lokaliseerEersteBruikbare(segmenten, [
    "Deze staat er niet in en levert dus niets op.",
    "De hersteltermijn voor Koraalmaat 47 bedraagt twaalf maanden",
  ]);
  assert.ok(uitkomst.ok);
  assert.equal(uitkomst.lokalisatie.passage, ZIN);
});

test("zonder extracts, of als geen enkel extract lokaliseerbaar is, volgt een afwijzing", () => {
  const segmenten = [segment(ZIN)];
  const leeg = lokaliseerEersteBruikbare(segmenten, []);
  assert.equal(leeg.ok, false);
  assert.equal(leeg.ok === false && leeg.afwijzing, "extractie");

  const geen = lokaliseerEersteBruikbare(segmenten, ["Komt hier echt niet in voor, nergens."]);
  assert.equal(geen.ok, false);
  assert.equal(geen.ok === false && geen.afwijzing, "lokalisatie");
});

test("een lege eigen extractie levert nooit een passage", () => {
  for (const segmenten of [[], [segment("")], [segment("   ")]]) {
    const uitkomst = lokaliseerExtract(segmenten, ZIN);
    assert.equal(uitkomst.ok, false);
    assert.equal(uitkomst.ok === false && uitkomst.afwijzing, "lokalisatie");
  }
});
