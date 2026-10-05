// ============================================================
//  Sanity-tests voor lib/pdf-bronblokken.ts (#548).
//
//  Synthetische PDF-tekstitems (positie + lettergrootte) naar het model van
//  Kamerstuk 36 067 nr. 90 en de MvT bij de Wtp: geen echte PDF in Git.
//  Uitvoeren: npx tsx core/lib/pdf-bronblokken.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  bouwBronblokken,
  schoonOcrSegmenten,
  type PdfPaginaInvoer,
  type PdfTekstItem,
} from "./pdf-bronblokken";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("pdf-bronblokken sanity-tests:");

const BREEDTE = 558;
const HOOGTE = 771;
const LINKS = 221;
const FS = 9.1;
const PITCH = 10.6;

/** Een regel hoofdtekst op hoogte y (één item per regel). */
function regel(y: number, str: string, x = LINKS, fs = FS): PdfTekstItem {
  return { str, x, y, fontSize: fs, width: str.length * fs * 0.45 };
}

/** Opeenvolgende regels vanaf y, met normale regelafstand. */
function alinea(y: number, regels: string[], eersteX = LINKS): PdfTekstItem[] {
  return regels.map((r, i) => regel(y - i * PITCH, r, i === 0 ? eersteX : LINKS));
}

function voet(pagina: number): PdfTekstItem[] {
  return [
    regel(68.7, "Tweede Kamer, vergaderjaar 2022–2023, 36 067, nr. 90"),
    { str: String(pagina), x: 535, y: 68.7, fontSize: FS, width: 5 },
  ];
}

function pagina(nr: number, items: PdfTekstItem[]): PdfPaginaInvoer {
  return { pagina: nr, breedte: BREEDTE, hoogte: HOOGTE, items };
}

const P1 = pagina(1, [
  ...alinea(600, ["I"]),
  ...alinea(578, ["In artikel I, onderdeel QQQ, wordt na het voorgestelde artikel 150q een", "nieuwe paragraaf ingevoegd, luidende:"], 230),
  ...alinea(540, ["Artikel 150r. Opschorting individuele waardeoverdracht"]),
  ...alinea(518, [
    "3. Het eerste lid, onderdeel b, is niet van toepassing indien het",
    "ontvangende pensioenfonds bij de opdrachtaanvaarding, bedoeld in",
    "artikel 102a, heeft aangegeven geen gebruik te maken van de",
    "mogelijkheid tot waardeoverdracht als bedoeld in artikel 150m.",
  ], 230),
  ...alinea(460, [
    "4. De plicht tot waardeoverdracht herleeft zodra zowel bij het overdra-",
    "gende als het ontvangende fonds waarde- en premieoverdracht heeft plaats-",
    "gevonden.",
  ], 230),
  regel(81.6, "kst-36067-90", 55),
  regel(75.1, "ISSN 0921 - 7371", 55),
  ...voet(1),
]);
const P2 = pagina(2, [
  ...alinea(700, ["II"]),
  ...alinea(678, ["Toelichting"]),
  ...alinea(656, ["Dit amendement regelt een tijdelijke pauze. En zodra beide pensioenuit-"]),
  ...voet(2),
]);
const P3 = pagina(3, [
  ...alinea(770, ["voerders zijn ingevaren, herleeft het recht op waardeoverdracht."]),
  ...voet(3),
]);

const resultaat = bouwBronblokken([P1, P2, P3]);
const p1 = resultaat.segmenten.find((s) => s.pagina === 1)!.tekst.split("\n\n");

check("afgebroken verwijzing 'artikel 102a, heeft …' blijft binnen de alinea", () => {
  assert.ok(p1.includes("Artikel 150r. Opschorting individuele waardeoverdracht"));
  assert.ok(!p1.some((b) => b.startsWith("artikel 102a")), "geen blok begint met de verwijzing");
  assert.ok(p1.some((b) => b.includes("bedoeld in artikel 102a, heeft aangegeven")));
});

check("woordafbreking hersteld; 'waarde- en premieoverdracht' blijft staan", () => {
  const lid4 = p1.find((b) => b.startsWith("4."))!;
  assert.ok(lid4.includes("overdragende als"), lid4);
  assert.ok(lid4.includes("waarde- en premieoverdracht"), lid4);
  assert.ok(lid4.includes("plaatsgevonden."), lid4);
});

check("lijstitems en romeinse onderdelen zijn eigen blokken", () => {
  assert.equal(p1[0], "I");
  assert.ok(p1.some((b) => b.startsWith("3. Het eerste lid")));
  assert.ok(p1.some((b) => b.startsWith("4. De plicht")));
  assert.ok(resultaat.segmenten[1].tekst.startsWith("II\n\n"), "II bovenaan p. 2 is geen paginanummer");
});

check("paginavoeten, kst-nummer, ISSN en paginanummer zijn uit de tekst", () => {
  const alles = resultaat.segmenten.map((s) => s.tekst).join("\n");
  assert.doesNotMatch(alles, /vergaderjaar|kst-36067|ISSN/);
  assert.ok(!resultaat.segmenten.some((s) => /(^|\n\n)\d+$/.test(s.tekst)), "geen los paginanummer");
  assert.ok(resultaat.diagnose.verwijderdeMargeregels >= 8);
});

check("afbreking over de paginagrens: alleen het eerste woord verhuist", () => {
  const p2 = resultaat.segmenten.find((s) => s.pagina === 2)!.tekst;
  const p3 = resultaat.segmenten.find((s) => s.pagina === 3)!.tekst;
  assert.match(p2, /pensioenuitvoerders$/);
  assert.equal(p3, "zijn ingevaren, herleeft het recht op waardeoverdracht.");
});

check("paginanummers blijven die van de bron", () => {
  assert.deepEqual(resultaat.segmenten.map((s) => s.pagina), [1, 2, 3]);
});

check("voetnootverwijzing in superscript valt weg, voetnoot onderaan wordt [n]-blok", () => {
  const p = pagina(1, [
    regel(700, "Mijlpalen zijn de rapporten van de Commissie Goudswaard"),
    { str: "1", x: 470, y: 703.7, fontSize: 5.5, width: 3 },
    regel(700 - PITCH, "en van de Commissie Frijns.", LINKS),
    regel(689.4 - 2 * PITCH, "Daarna volgde het advies.", LINKS),
    { str: "1", x: LINKS, y: 180.4, fontSize: 4.5, width: 3 },
    regel(177.6, "Kamerstukken II 2009/10, 30 413, nr. 139.", 227.3, 6.9),
  ]);
  const r = bouwBronblokken([p]);
  const blokken = r.blokken.map((b) => `${b.soort}:${b.tekst}`);
  assert.ok(blokken.includes("voetnoot:[1] Kamerstukken II 2009/10, 30 413, nr. 139."), blokken.join(" | "));
  assert.ok(blokken.some((b) => b.startsWith("alinea:Mijlpalen") && b.includes("Goudswaard en van de")), blokken.join(" | "));
  assert.equal(r.diagnose.voetnootverwijzingen, 1);
});

check("inhoudsopgave wordt één blok (geen koppen)", () => {
  const toc = (y: number, nr: string, titel: string, blz: string): PdfTekstItem[] => [
    { str: nr, x: LINKS, y, fontSize: FS, width: 8 },
    { str: titel, x: 248, y, fontSize: FS, width: titel.length * 4 },
    { str: blz, x: 530, y, fontSize: FS, width: 10 },
  ];
  const p = pagina(1, [
    ...toc(486, "1.", "Inleiding", "1"),
    ...toc(476, "2.", "Doelstelling", "16"),
    ...toc(466, "3.", "Wettelijk kader", "26"),
    ...alinea(420, ["Hoofdstuk 1 Inleiding"]),
  ]);
  const r = bouwBronblokken([p]);
  assert.deepEqual(r.blokken.map((b) => b.soort), ["inhoudsopgave", "alinea"]);
  assert.equal(r.blokken[0].tekst, "Inhoudsopgave: 1. Inleiding (blz. 1); 2. Doelstelling (blz. 16); 3. Wettelijk kader (blz. 26)");
});

check("tabel: meerdere cellen op opeenvolgende regels → '| … |'-rijen; losse regel met gat niet", () => {
  const rij = (y: number, a: string, b: string): PdfTekstItem[] => [
    { str: a, x: LINKS, y, fontSize: FS, width: a.length * 4 },
    { str: b, x: 420, y, fontSize: FS, width: b.length * 4 },
  ];
  const p = pagina(1, [
    ...rij(600, "Model input", "Invaardekkingsgraad"),
    ...rij(590, "Basis", "95%"),
    ...alinea(560, ["Een formule staat hier:"]),
    ...rij(530, "rendement, dus", ". De dalende rente"),
  ]);
  const r = bouwBronblokken([p]);
  assert.equal(r.blokken[0].soort, "tabel");
  assert.equal(r.blokken[0].tekst, "| Model input | Invaardekkingsgraad |\n| Basis | 95% |");
  assert.ok(r.blokken.every((b) => b.soort !== "tabel" || b === r.blokken[0]));
});

check("kantlijncel naast de hoofdtekstkolom wordt een eigen blok", () => {
  const p = pagina(1, [
    { str: "36 067", x: 55, y: 653, fontSize: 12.3, width: 45 },
    { str: "Wijziging van de Pensioenwet", x: LINKS, y: 653, fontSize: 12.3, width: 200 },
    ...alinea(600, ["Hoofdtekst op de vaste linkerkant van de kolom."]),
    ...alinea(580, ["Nog een alinea op de vaste linkerkant van de kolom."]),
  ]);
  const r = bouwBronblokken([p]);
  assert.deepEqual(r.blokken.slice(0, 2).map((b) => `${b.soort}:${b.tekst}`), [
    "kantlijn:36 067",
    "alinea:Wijziging van de Pensioenwet",
  ]);
});

check("deterministisch: dezelfde invoer geeft dezelfde uitvoer", () => {
  assert.deepEqual(bouwBronblokken([P1, P2, P3]), bouwBronblokken([P1, P2, P3]));
});

check("OCR-nabewerking: drukvoet en paginanummer weg, afbreking hersteld, 'pensioen- en' blijft", () => {
  const { segmenten } = schoonOcrSegmenten([
    { pagina: 1, paragraaf: null, tekst: "# Titel\n\nDe overdra-\ngende partij en pensioen-\nen premieregeling.\n\n12\n\nkst-36067-90" },
  ]);
  assert.equal(segmenten[0].tekst, "# Titel\n\nDe overdragende partij en pensioen-\nen premieregeling.");
});

console.log(`\n${n} sanity-tests geslaagd.`);
