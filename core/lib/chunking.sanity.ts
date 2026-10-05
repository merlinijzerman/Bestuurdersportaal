// ============================================================
//  Sanity-tests voor lib/chunking.ts (segment-chunking, Fase 1b).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/chunking.sanity.ts (of node met TS-strip).
//  Verifieert de risicovolle logica: pagina/paragraaf-tagging per segment en
//  dat een chunk nooit over een segmentgrens heen loopt.
// ============================================================

import assert from "node:assert/strict";
import { maakChunks, maakChunksUitSegmenten, splitsInStructuurUnits } from "./chunking";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("chunking sanity-tests:");

// Eén ruime alinea per segment (> 50 tekens zodat hij niet wordt weggefilterd).
const alineaA = "Dit is de eerste pagina over de financieringsgraad van het pensioenfonds en de bijbehorende solidariteitsreserve.";
const alineaB = "Dit is de tweede pagina over het beleggingsbeleid, het rendement en de beheersing van de renterisico's.";

check("pagina wordt per segment getagd", () => {
  const chunks = maakChunksUitSegmenten([
    { pagina: 1, paragraaf: null, tekst: alineaA },
    { pagina: 2, paragraaf: null, tekst: alineaB },
  ]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].pagina, 1);
  assert.equal(chunks[1].pagina, 2);
});

check("paragraaf-label (XLSX-tabblad) wordt overgenomen", () => {
  const chunks = maakChunksUitSegmenten([
    { pagina: null, paragraaf: "Tabblad: Premies", tekst: alineaA },
  ]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].pagina, null);
  assert.equal(chunks[0].paragraaf, "Tabblad: Premies");
});

check("chunk loopt niet over een segmentgrens", () => {
  // Twee korte segmenten zouden zonder segment-grens samengevoegd kunnen worden;
  // per-segment chunking moet ze gescheiden houden (elk eigen pagina).
  const chunks = maakChunksUitSegmenten([
    { pagina: 5, paragraaf: null, tekst: alineaA },
    { pagina: 6, paragraaf: null, tekst: alineaB },
  ]);
  const paginas = new Set(chunks.map((c) => c.pagina));
  assert.deepEqual([...paginas].sort(), [5, 6]);
  // Geen enkele chunk-tekst mag inhoud van beide pagina's bevatten.
  for (const c of chunks) {
    const heeftA = c.tekst.includes("financieringsgraad");
    const heeftB = c.tekst.includes("beleggingsbeleid");
    assert.ok(!(heeftA && heeftB), "chunk mengt twee segmenten");
  }
});

check("groot segment wordt in meerdere chunks gesplitst, alle met dezelfde pagina", () => {
  const grootBlok = Array.from({ length: 40 }, (_, i) =>
    `Alinea ${i} met voldoende inhoud over governance, toezicht en naleving binnen het fonds.`
  ).join("\n\n");
  const chunks = maakChunksUitSegmenten([{ pagina: 3, paragraaf: null, tekst: grootBlok }]);
  assert.ok(chunks.length > 1, "verwacht meerdere chunks");
  assert.ok(chunks.every((c) => c.pagina === 3));
});

check("maakChunks blijft platte string-API bieden", () => {
  const stukken = maakChunks(alineaA + "\n\n" + alineaB);
  assert.ok(Array.isArray(stukken));
  assert.ok(stukken.every((s) => typeof s === "string"));
});

// ── R1.1 — structuur-bewuste chunking ─────────────────────────────
check("lopende tekst zonder structuur → één 'tekst'-unit (geen regressie)", () => {
  const units = splitsInStructuurUnits(alineaA);
  assert.equal(units.length, 1);
  assert.equal(units[0].type, "tekst");
});

check("artikelen worden niet samengevoegd en krijgen een label", () => {
  const tekst =
    "Artikel 1 Toepassingsgebied\nDit reglement geldt voor alle deelnemers van het fonds.\n" +
    "Artikel 2 Aanvang deelneming\nDe deelneming vangt aan op de eerste werkdag.";
  const chunks = maakChunksUitSegmenten([{ pagina: 1, paragraaf: null, tekst }]);
  const labels = chunks.map((c) => c.structuur_label);
  assert.ok(labels.includes("Artikel 1"));
  assert.ok(labels.includes("Artikel 2"));
  assert.ok(chunks.every((c) => c.structuur_type === "artikel"));
  // Geen chunk mag inhoud van beide artikelen mengen.
  for (const c of chunks) {
    const a1 = c.tekst.includes("Toepassingsgebied");
    const a2 = c.tekst.includes("Aanvang deelneming");
    assert.ok(!(a1 && a2), "chunk mengt twee artikelen");
  }
});

check("artikelverwijzing na regelafbreking opent geen artikelunit", () => {
  const units = splitsInStructuurUnits(
    "Artikel 21. Verzoek tot waardeoverdracht\nDe deelnemer handelt volgens\n" +
    "artikel 18, eerste lid, van de Pensioenwet.\nDeze zin hoort bij artikel 21."
  );
  assert.equal(units.length, 1);
  assert.equal(units[0].label, "Artikel 21");
  assert.ok(units[0].tekst.includes("artikel 18, eerste lid"));
});

check("decimale artikelnummers blijven heel", () => {
  const units = splitsInStructuurUnits("Artikel 2.5. Reikwijdte\nDeze bepaling geldt hier.");
  assert.equal(units[0].label, "Artikel 2.5");
});

check("voluit geschreven wettelijke paragraaf en volgend hoofdstuk begrenzen artikelen", () => {
  const units = splitsInStructuurUnits(
    "Artikel 17f. Klein pensioen\nSlot van artikel 17f.\n" +
    "Paragraaf 6.2. Individuele waardeoverdracht\nUitvoering van de Pensioenwet.\n" +
    "Artikel 17g. Overgangsrecht\nEerste artikel in de paragraaf.\n" +
    "Artikel 18. Verzoek informatie\nTweede artikel in de paragraaf.\n" +
    "Hoofdstuk 6a. Bestuur en toezicht fonds\nNieuwe bepalingen."
  );
  assert.deepEqual(units.map((u) => [u.type, u.label]), [
    ["artikel", "Artikel 17f"],
    ["paragraaf", "Paragraaf 6.2"],
    ["artikel", "Artikel 17g"],
    ["artikel", "Artikel 18"],
    ["kop", "Hoofdstuk 6a"],
  ]);
  assert.ok(!units[0].tekst.includes("Paragraaf 6.2"));
  assert.ok(!units[3].tekst.includes("Hoofdstuk 6a"));
});

check("lopende verwijzing naar een paragraaf opent geen nieuwe unit", () => {
  const units = splitsInStructuurUnits(
    "Artikel 18. Verzoek informatie\nVolgens\nparagraaf 6.2 van dit besluit geldt een termijn."
  );
  assert.equal(units.length, 1);
  assert.equal(units[0].label, "Artikel 18");
});

check("definities komen als samenhangende, gescheiden chunks terug", () => {
  const tekst =
    "Artikel 1 Begripsbepalingen\n" +
    "a. Fonds: de Stichting Pensioenfonds Horizon.\n" +
    "b. Deelnemer: de werknemer die pensioen opbouwt.";
  const chunks = maakChunksUitSegmenten([{ pagina: 1, paragraaf: null, tekst }]);
  assert.ok(chunks.some((c) => c.structuur_type === "definitie"));
  const fondsChunk = chunks.find((c) => c.tekst.includes("Fonds: de Stichting"));
  assert.ok(fondsChunk, "definitie 'Fonds' moet als chunk bestaan");
  assert.ok(!fondsChunk!.tekst.includes("Deelnemer:"), "definities mogen niet samenklonteren");
});

check("markdown-tabel blijft één ondeelbare chunk", () => {
  const tekst =
    "## Tabblad: Dekkingsgraad\n\n" +
    "| Jaar | Dekkingsgraad |\n| --- | --- |\n| 2024 | 118% |\n| 2025 | 121% |";
  const chunks = maakChunksUitSegmenten([
    { pagina: null, paragraaf: "Tabblad: Dekkingsgraad", tekst },
  ]);
  const tabel = chunks.filter((c) => c.structuur_type === "tabel");
  assert.equal(tabel.length, 1, "tabel mag niet over chunks worden verdeeld");
  assert.ok(tabel[0].tekst.includes("2024") && tabel[0].tekst.includes("2025"));
});

console.log(`\n${n} sanity-tests geslaagd.`);
