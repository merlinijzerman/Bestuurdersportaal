// ============================================================
//  Sanity-tests voor de volledige-sectieroute (#548):
//  lib/retrieval/document-sectie.ts + de alinea-per-regelchunking.
//
//  Synthetische fixtures: een parlementair amendement (PDF-bronblokken), een
//  fondsreglement als DOCX (opgebouwd met JSZip, geen binair bestand in Git)
//  en losse chunkrijen voor de weigergevallen.
//  Uitvoeren: npx tsx core/lib/document-sectie.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import JSZip from "jszip";
import { extractTekst, type TekstSegment } from "./document-extractie";
import {
  BRONBLOKKEN_INDEXERING_VERSIE,
  bouwChunkRecordsZonderVerrijking,
  INDEXERING_VERSIE,
  type ChunkRecord,
} from "./chunk-bouw";
import {
  bakenDocumentsectieAf,
  bepaalSectieverzoek,
  geefDocumentsectieWeer,
  kiesSectiedocument,
  ontleedLabel,
  stelSectieSamen,
  zonderOverlap,
  type SectieChunk,
} from "./retrieval/document-sectie";

let n = 0;
async function check(naam: string, fn: () => void | Promise<void>) {
  await fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("document-sectie sanity-tests:");

const alsChunks = (records: ChunkRecord[]): SectieChunk[] =>
  records.map((r) => ({ ...r, id: `c${r.chunk_index}` }));

/** Volledige pijplijn op chunks: afbakenen + samenstellen. */
function sectie(vraag: string, chunks: SectieChunk[], ocr = false) {
  const v = bepaalSectieverzoek(vraag)!;
  const b = bakenDocumentsectieAf(v, chunks, { ocrToegepast: ocr });
  const rijen = b.van === null ? [] : chunks.filter((c) => c.chunk_index >= b.van! && c.chunk_index <= b.tot!);
  return { v, b, s: stelSectieSamen(b, rijen) };
}

const LANG = (n: number, woord: string) =>
  Array.from({ length: n }, (_, i) => `Zin ${i + 1} over ${woord} met voldoende woorden om de chunkgrens te halen.`).join(" ");

// Amendement als bronblokken (zoals pdf-bronblokken ze levert): artikel 150r
// loopt over twee pagina's en over meerdere chunks.
const AMENDEMENT: TekstSegment[] = [
  {
    pagina: 1, paragraaf: null, opmaak: "alinea_per_regel",
    tekst: [
      "I",
      "In artikel I, onderdeel QQQ, wordt na het voorgestelde artikel 150q een nieuwe paragraaf ingevoegd, luidende:",
      "Artikel 150r. Opschorting individuele waardeoverdracht",
      `1. ${LANG(14, "waardeoverdracht")}`,
      "2. Het eerste lid is niet van toepassing indien het overdragende pensioenfonds bij de opdrachtaanvaarding, bedoeld in artikel 102a, heeft aangegeven geen gebruik te maken van de mogelijkheid.",
    ].join("\n\n"),
  },
  {
    pagina: 2, paragraaf: null, opmaak: "alinea_per_regel",
    tekst: [
      `3. ${LANG(6, "opschorting")}`,
      "II",
      "Artikel 145q. Opschorting individuele waardeoverdracht",
      "1. De plicht tot waardeoverdracht geldt niet zolang bedoeld in artikel 109a, heeft aangegeven.",
      "Toelichting",
      "Dit amendement regelt een tijdelijke pauze.",
    ].join("\n\n"),
  },
];
const amendementChunks = alsChunks(
  bouwChunkRecordsZonderVerrijking({
    documentId: "d", segmenten: AMENDEMENT, documenttype: "wetsgeschiedenis", wetsgeschiedenisSubtype: "aangenomen_amendement",
  })
);

async function main() {
await check("verzoek: artikel, hoofdstuk, paragraaf/§, onderdeel en documenttermen", () => {
  assert.deepEqual(bepaalSectieverzoek("Geef het hele artikel 150r van amendement 36 067 nr. 90"), {
    soort: "artikel", nummer: "150r", onderdeel: null, documenttermen: ["amendement", "36", "067", "90"],
  });
  assert.equal(bepaalSectieverzoek("Toon de volledige § 3.2 van het beleggingsplan")?.soort, "paragraaf");
  assert.equal(bepaalSectieverzoek("Toon de volledige § 3.2 van het beleggingsplan")?.nummer, "3.2");
  assert.equal(bepaalSectieverzoek("Geef het gehele hoofdstuk 4 uit de MvT")?.soort, "hoofdstuk");
  assert.deepEqual(
    bepaalSectieverzoek("letterlijke tekst van artikel I, onderdeel A van de memorie")?.onderdeel, "A");
  // Geen 'hele/volledige' of geen nummer → geen sectieverzoek (gewone RAG).
  assert.equal(bepaalSectieverzoek("Wat staat er in artikel 150r?"), null);
  assert.equal(bepaalSectieverzoek("Geef het hele beleggingsplan"), null);
});

await check("label ontleden: parlementair deel, artikel/onderdeel, hoofdstuk, §, genummerd, kop", () => {
  assert.deepEqual(ontleedLabel("Amendement — wijziging — Artikel 150r"), {
    deel: "Amendement — wijziging", soort: "artikel", nummer: "150r", onderdeel: null });
  assert.deepEqual(ontleedLabel("Artikelsgewijze toelichting — Artikel I, onderdeel A").onderdeel, "A");
  assert.equal(ontleedLabel("Algemeen deel — Hoofdstuk 3").soort, "hoofdstuk");
  assert.equal(ontleedLabel("Algemeen deel — §3.1").nummer, "3.1");
  assert.equal(ontleedLabel("3.2.1").soort, "genummerd");
  assert.equal(ontleedLabel("Amendement — wijziging — Wijzigingsonderdeel II", "kop").soort, "kop");
  assert.equal(ontleedLabel("Algemeen deel").soort, "deel");
  assert.equal(ontleedLabel(null).soort, null);
});

await check("hele artikel 150r: alle chunks over twee pagina's, in volgorde, zonder overlap of verlies", () => {
  const { b, s } = sectie("Geef het hele artikel 150r van amendement 90", amendementChunks);
  assert.equal(b.reden, "ok");
  assert.ok(b.tot! - b.van! + 1 >= 3, "sectie beslaat meerdere chunks (meer dan in één passage past)");
  assert.equal(s.volledig, true);
  assert.equal(s.beginPagina, 1);
  assert.equal(s.eindPagina, 2);
  assert.ok(s.tekst.startsWith("Artikel 150r. Opschorting"));
  assert.ok(s.tekst.includes("bedoeld in artikel 102a, heeft aangegeven"));
  assert.ok(s.tekst.includes("*[pagina 2]*"));
  // Letterlijk: elke zin precies één keer (overlap verwijderd), alinea 1 heel.
  for (let i = 1; i <= 14; i++) {
    assert.equal(s.tekst.split(`Zin ${i} over waardeoverdracht`).length - 1, 1, `zin ${i}`);
  }
  assert.ok(s.tekst.includes(`1. ${LANG(14, "waardeoverdracht")}`), "alinea 1 als één alinea hersteld");
  // Grens: onderdeel II en artikel 145q horen er niet bij.
  assert.ok(!s.tekst.includes("Artikel 145q"));
  assert.ok(!/(^|\n)II(\n|$)/.test(s.tekst));
});

await check("weergave: letterlijk met locatie en link naar het origineel", () => {
  const { v, s } = sectie("Geef het hele artikel 150r van amendement 90", amendementChunks);
  const uit = geefDocumentsectieWeer(v, { id: "DOC", titel: "Amendement 36 067 nr. 90" }, s);
  assert.match(uit, /^\*\*Artikel 150r\*\* — “Amendement 36 067 nr\. 90” \(pagina 1–2\)/);
  assert.ok(uit.endsWith("[Open het origineel](/api/documents/DOC/bestand#page=1)"));
});

await check("artikel 102a is geen sectie (verwijzing, geen kop)", () => {
  const { b } = sectie("Geef het hele artikel 102a van amendement 90", amendementChunks);
  assert.equal(b.reden, "niet_gevonden");
});

await check("oude index (r1, zoals bestaande fondsdocumenten): nooit letterlijk, wel melding + link", () => {
  const oud = amendementChunks.map((c) => ({ ...c, indexering_versie: INDEXERING_VERSIE }));
  const { v, b, s } = sectie("Geef het hele artikel 150r van amendement 90", oud);
  assert.equal(b.reden, "oude_index");
  assert.equal(s.volledig, false);
  assert.equal(s.tekst, "");
  const uit = geefDocumentsectieWeer(v, { id: "DOC", titel: "Amendement" }, s);
  assert.match(uit, /niet betrouwbaar volledig en letterlijk weergeven: dit document is geïndexeerd vóór de verbeterde verwerking/);
  assert.match(uit, /\[origineel\]\(\/api\/documents\/DOC\/bestand#page=1\)/);
  assert.ok(!uit.includes("Zin 1 over"), "geen (gedeeltelijke) tekst in de melding");
});

await check("onvolledig: een ontbrekende chunk midden in de sectie → onderbroken", () => {
  const { b } = sectie("Geef het hele artikel 150r", amendementChunks);
  const zonder = amendementChunks.filter((c) => c.chunk_index !== b.van! + 1);
  const r = sectie("Geef het hele artikel 150r van amendement 90", zonder);
  assert.equal(r.b.reden, "onderbroken");
  assert.equal(r.s.volledig, false);
});

await check("OCR-tekst: geen letterlijke volledige weergave", () => {
  assert.equal(sectie("Geef het hele artikel 150r", amendementChunks, true).b.reden, "ocr");
});

await check("te groot: melding in plaats van een afgekapte tekst", () => {
  const groot: TekstSegment[] = [{
    pagina: 1, paragraaf: null, opmaak: "alinea_per_regel",
    tekst: ["Hoofdstuk 2 Beleggingen", ...Array.from({ length: 300 }, (_, i) => `Alinea ${i}. ${LANG(4, "beleggen")}`)].join("\n\n"),
  }];
  const chunks = alsChunks(bouwChunkRecordsZonderVerrijking({ documentId: "g", segmenten: groot }));
  const { v, s } = sectie("Geef het hele hoofdstuk 2 van het plan", chunks);
  assert.equal(s.reden, "te_groot");
  assert.equal(s.volledig, false);
  assert.match(geefDocumentsectieWeer(v, { id: "G", titel: "Plan" }, s), /te lang om hier volledig/);
});

await check("hetzelfde nummer op twee plekken → meerdere (nooit gokken)", () => {
  const dubbel = amendementChunks.map((c) => ({ ...c }));
  const extra = { ...dubbel.find((c) => c.structuur_label?.endsWith("Artikel 145q"))!, chunk_index: dubbel.length, id: "x" };
  extra.structuur_label = "Amendement — wijziging — Artikel 150r";
  const { b } = sectie("Geef het hele artikel 150r", [...dubbel, extra]);
  assert.equal(b.reden, "meerdere");
});

await check("documentkeuze: dossiernummer/titel; gelijke score = dubbelzinnig; geen treffer = geen", () => {
  const v = bepaalSectieverzoek("Geef het hele artikel 150r van amendement 36 067 nr. 90")!;
  const docs = [
    { id: "a", titel: "Amendement Stoffer c.s. over waardeoverdracht", dossiernummer: "36 067 nr. 90" },
    { id: "b", titel: "Amendement Smals over premies", dossiernummer: "36 067 nr. 91" },
    { id: "c", titel: "Beleggingsplan 2026" },
  ];
  const k = kiesSectiedocument(v, docs);
  assert.equal(k.soort === "gekozen" && k.document.id, "a");
  const v2 = bepaalSectieverzoek("Geef het hele artikel 3 van het amendement")!;
  assert.equal(kiesSectiedocument(v2, docs).soort, "dubbelzinnig");
  const v3 = bepaalSectieverzoek("Geef het hele artikel 3 van het huishoudelijk reglement")!;
  assert.equal(kiesSectiedocument(v3, docs).soort, "geen");
});

await check("overlap: alleen een aantoonbare overlap wordt verwijderd", () => {
  assert.deepEqual(zonderOverlap("a b c d e", "d e\nf g"), { rest: "f g", vervolgAlinea: true });
  assert.deepEqual(zonderOverlap("a b c d e", "d e\n\nf g"), { rest: "f g", vervolgAlinea: false });
  assert.equal(zonderOverlap("a b c d e", "x y\nf g"), null);
});

// ── Synthetische fonds-DOCX: zelfde gedeelde pijplijn als generiek ──────────

async function maakDocx(alineas: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  zip.file("word/document.xml",
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    alineas.map((a) => `<w:p><w:r><w:t xml:space="preserve">${esc(a)}</w:t></w:r></w:p>`).join("") +
    "</w:body></w:document>");
  return zip.generateAsync({ type: "nodebuffer" });
}

const REGLEMENT = [
  "Pensioenreglement Stichting Pensioenfonds Horizon (synthetisch)",
  "Hoofdstuk 1 Algemeen",
  "Artikel 1. Begripsbepalingen",
  "In dit reglement wordt verstaan onder deelnemer: de werknemer die pensioen opbouwt.",
  "Hoofdstuk 2 Waardeoverdracht",
  "Artikel 5. Recht op waardeoverdracht",
  `1. ${LANG(12, "het recht op waardeoverdracht")}`,
  "2. Kort lid.",
  "Artikel 6. Termijnen",
  "De uitvoerder verstrekt binnen twee maanden een opgave.",
  "Hoofdstuk 3 Slotbepalingen",
  "Artikel 9. Inwerkingtreding",
  "Dit reglement treedt in werking op 1 januari 2027.",
];

await check("fonds-DOCX: extractie alinea per regel, bronblokken-indexversie, geen tekst weg", async () => {
  const ex = await extractTekst(await maakDocx(REGLEMENT), "docx");
  assert.equal(ex.segmenten[0].opmaak, "alinea_per_regel");
  const records = bouwChunkRecordsZonderVerrijking({ documentId: "f", segmenten: ex.segmenten });
  assert.ok(records.every((r) => r.indexering_versie === BRONBLOKKEN_INDEXERING_VERSIE));
  // "2. Kort lid." (< 50 tekens) valt niet weg.
  assert.ok(records.some((r) => r.tekst.includes("2. Kort lid.")));
  assert.deepEqual(
    [...new Set(records.map((r) => r.structuur_label))].filter(Boolean),
    ["Hoofdstuk 1", "Artikel 1", "Hoofdstuk 2", "Artikel 5", "Artikel 6", "Hoofdstuk 3", "Artikel 9"]
  );
});

await check("fonds-DOCX: hele hoofdstuk 2 en hele artikel 5 (over chunks), locatie = sectiekop", async () => {
  const ex = await extractTekst(await maakDocx(REGLEMENT), "docx");
  const chunks = alsChunks(bouwChunkRecordsZonderVerrijking({ documentId: "f", segmenten: ex.segmenten }));
  const h2 = sectie("Geef het hele hoofdstuk 2 van het pensioenreglement", chunks);
  assert.equal(h2.b.reden, "ok");
  assert.ok(h2.s.tekst.startsWith("Hoofdstuk 2 Waardeoverdracht"));
  assert.ok(h2.s.tekst.includes("Artikel 6. Termijnen"));
  assert.ok(!h2.s.tekst.includes("Hoofdstuk 3"));
  assert.equal(h2.s.beginPagina, null);
  const a5 = sectie("Geef het volledige artikel 5 van het pensioenreglement", chunks);
  assert.equal(a5.b.reden, "ok");
  assert.ok(a5.b.tot! > a5.b.van!, "artikel 5 beslaat meerdere chunks");
  assert.ok(a5.s.tekst.includes(`1. ${LANG(12, "het recht op waardeoverdracht")}`));
  assert.ok(a5.s.tekst.endsWith("2. Kort lid."));
  const uit = geefDocumentsectieWeer(a5.v, { id: "F", titel: "Pensioenreglement" }, a5.s);
  assert.match(uit, /\(sectie “Artikel 5”\)/);
  assert.ok(uit.endsWith("[Open het origineel](/api/documents/F/bestand)"));
});

await check("gedeelde ingest: dezelfde inhoud geeft voor fonds en generiek dezelfde bronstructuur", async () => {
  // De chunkbouw kent geen bibliotheek meer: de strategie volgt het tekstformaat.
  const buffer = await maakDocx(REGLEMENT);
  const fonds = bouwChunkRecordsZonderVerrijking({ documentId: "x", segmenten: (await extractTekst(buffer, "docx")).segmenten });
  const generiek = bouwChunkRecordsZonderVerrijking({ documentId: "x", segmenten: (await extractTekst(buffer, "docx")).segmenten });
  assert.deepEqual(fonds, generiek);
});

await check("PPTX/XLSX-segmenten (zonder opmaak) houden het oude gedrag en de oude versie", () => {
  const dia: TekstSegment[] = [{ pagina: 1, paragraaf: "Dia 1", tekst: "Artikel 5. Kort" }];
  const r = bouwChunkRecordsZonderVerrijking({ documentId: "p", segmenten: dia });
  assert.ok(r.every((c) => c.indexering_versie === INDEXERING_VERSIE));
});

console.log(`\n${n} sanity-tests geslaagd.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
