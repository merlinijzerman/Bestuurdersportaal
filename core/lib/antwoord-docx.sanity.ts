// ============================================================
//  Sanity-tests voor core/lib/antwoord-docx.ts (T2, Word-export).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/antwoord-docx.sanity.ts
//  Verifieert: geldige OOXML-structuur, ECHTE tabellen (w:tbl, geen losse
//  regels), [Bron N] als letterlijke tekst, de verplichte bronnenlijst, en dat de
//  schrijffunctie een document zonder herkomstanker weigert (FR-16/17, §6.4/§9).
// ============================================================

import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  bouwDocx,
  bouwDocxDocumentXml,
  docxBestandsnaam,
  type DocxStukContext,
} from "./antwoord-docx";
import { parseerBlokken } from "./antwoord-parser";
import { HERKOMST_ANKER_BUREAU, type KopieBron } from "./antwoord-klembord";

let n = 0;
function check(naam: string, fn: () => void | Promise<void>) {
  const r = fn();
  if (r instanceof Promise) throw new Error(`gebruik runAsync voor ${naam}`);
  n++;
  console.log(`  ✓ ${naam}`);
}
async function checkAsync(naam: string, fn: () => Promise<void>) {
  await fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const CTX: DocxStukContext = {
  titel: "Bestuursnotitie — Wijziging beleggingsbeleid",
  datum: "05-08-2026",
  surface: "bureau",
  fondsnaam: "Stichting Pensioenfonds Horizon",
};

const BRONNEN: KopieBron[] = [
  { nummer: 1, titel: "Beleggingsplan 2026", bron: "Intern", pagina: 12, paragraaf: "§3.2" },
];

const ANTWOORD = [
  "## Samenvatting",
  "Het voorstel wijzigt de strategische allocatie [Bron 1].",
  "",
  "| Categorie | Weging |",
  "| --- | --- |",
  "| Aandelen | 40% |",
  "| Obligaties | 60% |",
  "",
  "## Aannames en open punten",
  "- De renteaanname is nog niet bevestigd.",
].join("\n");

async function main() {
  console.log("antwoord-docx sanity-tests:");

  const xml = bouwDocxDocumentXml(parseerBlokken(ANTWOORD), BRONNEN, CTX);

  check("de document-XML is welgevormd WordprocessingML", () => {
    assert.ok(xml.startsWith("<?xml"));
    assert.ok(xml.includes("<w:document"));
    assert.ok(xml.includes("<w:body>") && xml.includes("</w:body>"));
    assert.ok(xml.includes("<w:sectPr>"));
  });

  check("een markdown-tabel wordt een ECHTE Word-tabel (w:tbl), geen losse regels", () => {
    assert.ok(xml.includes("<w:tbl>"), "geen w:tbl — tabel is niet als tabel gerenderd");
    assert.ok(xml.includes("<w:tr>") && xml.includes("<w:tc>"));
    // De kopcel draagt de arcering.
    assert.ok(xml.includes('w:fill="F2F4F9"'));
    // Numerieke kolom (percentages) rechts uitgelijnd.
    assert.ok(xml.includes('<w:jc w:val="right"/>'));
  });

  check("T5 A1: de tabel draagt een tblGrid met vaste kolombreedtes (DXA)", () => {
    assert.ok(xml.includes("<w:tblGrid>"), "geen tblGrid — ongeldige OOXML, kolombreedtes onbepaald");
    assert.ok(xml.includes("<w:gridCol w:w="), "geen gridCol-kolombreedte");
    // Tabel- én celbreedte in DXA i.p.v. type=auto.
    assert.ok(xml.includes('w:type="dxa"'), "tabel/cel niet in DXA vastgezet");
    assert.ok(!xml.includes('w:type="auto"'), "tabel gebruikt nog type=auto (onbepaalde breedte)");
  });

  check("T5 A4: een gekoppelde [Bron N] wordt een hooggeplaatst lijstnummer (superscript)", () => {
    assert.ok(
      xml.includes('<w:vertAlign w:val="superscript"/>'),
      "geen superscript-citatie — scriptie-stijl ontbreekt"
    );
    // De letterlijke [Bron N]-notatie hoort NIET meer in de tekst te staan voor
    // een gekoppelde bron; het cijfer is nu de citatie.
    assert.ok(!xml.includes("[Bron 1]"), "gekoppelde citatie staat nog als letterlijke [Bron N]");
  });

  check("de verplichte bronnenlijst staat in het document (genummerd, cijfer = lijstnummer)", () => {
    assert.ok(xml.includes("Bronnen:"));
    assert.ok(xml.includes("Beleggingsplan 2026"));
    // Scriptie-stijl: de lijstregel draagt geen [Bron N]-prefix meer.
    assert.ok(!xml.includes("[Bron 1] · "), "bronnenlijst draagt nog de [Bron N]-prefix");
  });

  check("de verplichte bureau-herkomstregel staat in het document", () => {
    assert.ok(xml.includes(HERKOMST_ANKER_BUREAU));
    assert.ok(xml.includes("Concepttekst"));
    assert.ok(xml.includes("geen bestuurlijk besluit"));
  });

  check("titel en koppen dragen Word-stijlen", () => {
    assert.ok(xml.includes('w:pStyle w:val="Title"'));
    assert.ok(xml.includes('w:pStyle w:val="Heading2"'));
  });

  check("T5 A2: een losse markdown-scheidingslijn (---) belandt niet als tekst", () => {
    const metStreep = ["## Kop", "Alinea een.", "", "---", "", "Alinea twee."].join("\n");
    const xml3 = bouwDocxDocumentXml(parseerBlokken(metStreep), [], {
      titel: "Test",
      datum: "05-08-2026",
      surface: "bureau",
      fondsnaam: null,
    });
    // De inhoudelijke alinea's blijven; de kale --- verdwijnt.
    assert.ok(xml3.includes("Alinea een.") && xml3.includes("Alinea twee."));
    assert.ok(
      !xml3.includes("<w:t xml:space=\"preserve\">---</w:t>"),
      "de --- is als letterlijke alinea in het document beland"
    );
  });

  check("T5 A3: precies één Title-paragraaf (geen tweede titel)", () => {
    const aantalTitels = (xml.match(/w:pStyle w:val="Title"/g) || []).length;
    assert.equal(aantalTitels, 1, "verwacht precies één Title-paragraaf");
  });

  check("bestandsnaam is opgeschoond en eindigt op .docx", () => {
    assert.equal(
      docxBestandsnaam("Bestuursnotitie — Wijziging beleggingsbeleid"),
      "Bestuursnotitie-Wijziging-beleggingsbeleid.docx"
    );
    assert.ok(docxBestandsnaam("").endsWith(".docx"));
  });

  await checkAsync("bouwDocx levert een geldige zip met de vijf OOXML-parts", async () => {
    const payload = await bouwDocx(ANTWOORD, BRONNEN, CTX);
    assert.ok(payload.bytes.length > 0);
    // PK-zip-magic.
    assert.equal(payload.bytes[0], 0x50);
    assert.equal(payload.bytes[1], 0x4b);
    const zip = await JSZip.loadAsync(payload.bytes);
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/_rels/document.xml.rels",
      "word/styles.xml",
    ]) {
      assert.ok(zip.file(part), `part ontbreekt in de zip: ${part}`);
    }
    assert.equal(payload.bestandsnaam.endsWith(".docx"), true);
  });

  check("XML-metatekens worden geescaped en control-tekens gestript", () => {
    const vies = "Marge < 5% & \"risico\" 'x' > nul" + String.fromCharCode(0) + String.fromCharCode(11);
    const xml2 = bouwDocxDocumentXml(parseerBlokken(vies), [], {
      titel: "T & <test>",
      datum: "05-08-2026",
      surface: "bureau",
      fondsnaam: null,
    });
    assert.ok(xml2.includes("&amp;"));
    assert.ok(xml2.includes("&lt;"));
    assert.ok(xml2.includes("&gt;"));
    // Control-tekens (NUL, verticale tab) zijn verdwenen -- anders corrupt Word-bestand.
    assert.equal(xml2.includes(String.fromCharCode(0)), false);
    assert.equal(xml2.includes(String.fromCharCode(11)), false);
  });

  await checkAsync("de schrijffunctie WEIGERT een document zonder herkomstanker", async () => {
    // surface !== "bureau" levert de klembord-herkomst (ander anker) → de
    // bureau-sluis moet dan gooien: geen export zonder de §6.4-herkomstregel.
    const foutCtx = { ...CTX, surface: "assistent" as const };
    assert.throws(
      () => bouwDocxDocumentXml(parseerBlokken(ANTWOORD), BRONNEN, foutCtx),
      /herkomstregel ontbreekt/
    );
  });

  console.log(`\n${n} sanity-tests geslaagd.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
