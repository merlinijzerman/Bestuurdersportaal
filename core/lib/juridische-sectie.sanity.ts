import assert from "node:assert/strict";
import {
  bakenParagraafAf,
  bepaalSectiefocus,
  geefParagraafLetterlijk,
  kiesJuridischDocument,
  kiesTermijnpassages,
  kiesParagraafkop,
  sectieBronlink,
  type Sectierij,
} from "./retrieval/juridische-sectie";

const doc = "besluit";
const rijen: Sectierij[] = [
  { id: "a", document_id: doc, chunk_index: 1, tekst: "Paragraaf 6.1. Waardeoverdracht klein pensioen\nArtikel 17e. Kleine aanspraken" },
  { id: "b", document_id: doc, chunk_index: 2, tekst: "Artikel 17f. Oude tekst\nParagraaf 6.2. Individuele waardeoverdracht\nUitvoering van de Pensioenwet" },
  { id: "c", document_id: doc, chunk_index: 3, tekst: "Artikel 18. Verzoek opgave\nBinnen één maand vraagt de uitvoerder de opgave." },
  { id: "d", document_id: doc, chunk_index: 4, tekst: "Artikel 19. Opgave informatie\nBinnen twee maanden verstrekt hij de opgave." },
  { id: "e", document_id: doc, chunk_index: 5, tekst: "Artikel 28. Behandeling aanspraken\nDe aanspraken worden behandeld.\nHoofdstuk 6a. Bestuur en toezicht fonds\nAndere regels." },
];

const volledig = bepaalSectiefocus('Geef de hele Paragraaf 6.2 "Individuele waardeoverdracht" van het Besluit')!;
const kop = kiesParagraafkop(volledig, rijen)!;
assert.equal(kop.nummer, "6.2");
const sectie = bakenParagraafAf(kop, rijen);
assert.equal(sectie.volledig, true);
assert.ok(sectie.tekst.includes("Artikel 18"));
assert.ok(sectie.tekst.includes("Artikel 28"));
assert.ok(!sectie.tekst.includes("Artikel 17f"));
assert.ok(!sectie.tekst.includes("Hoofdstuk 6a"));

const onderwerp = bepaalSectiefocus("Wat zijn de termijnen voor individuele waardeoverdrachten?")!;
assert.equal(kiesParagraafkop(onderwerp, rijen)?.nummer, "6.2");

assert.equal(bakenParagraafAf(kop, rijen.slice(0, -1)).reden, "geen_eindgrens");
const beschadigd = rijen.map((r) => r.id === "c" ? { ...r, tekst: "Artikel 18. De opgave, bedoeld in , wordt gevraagd." } : r);
assert.equal(bakenParagraafAf(kop, beschadigd).reden, "extractiegaten");
assert.equal(bakenParagraafAf(kop, rijen.filter((r) => r.id !== "d")).reden, "onderbroken");

assert.equal(
  sectieBronlink("https://wetten.overheid.nl/BWBR0020892/2026-01-01/0", "6.2"),
  "https://wetten.overheid.nl/BWBR0020892/2026-01-01/0/Hoofdstuk6/Paragraaf6.2"
);
assert.equal(sectieBronlink("https://example.org/BWBR0020892/2026-01-01/0", "6.2"), null);

assert.equal(kiesJuridischDocument(
  "Geef paragraaf 6.2 van het Besluit uitvoering Pensioenwet",
  [
    { id: "pw", titel: "Pensioenwet", extern_url: null },
    { id: "b", titel: "Besluit uitvoering Pensioenwet en Wet verplichte beroepspensioenregeling", extern_url: null },
  ]
)?.id, "b");
assert.equal(kiesJuridischDocument("Geef paragraaf 6.2", [
  { id: "b", titel: "Besluit uitvoering Pensioenwet", extern_url: null },
]), null);

const link = "https://wetten.overheid.nl/BWBR0020892/2026-01-01/0/Hoofdstuk6/Paragraaf6.2";
assert.ok(geefParagraafLetterlijk(sectie, link).includes("Artikel 28"));
const terugval = geefParagraafLetterlijk(bakenParagraafAf(kop, beschadigd), link);
assert.ok(terugval.includes("gevonden"));
assert.ok(terugval.includes(link));
assert.ok(!terugval.includes("Artikel 18. De opgave"));

const termijnen = kiesTermijnpassages(sectie, 5);
assert.deepEqual(termijnen.map((r) => r.chunk_index), [3, 4]);

console.log("juridische-sectie sanity geslaagd");
