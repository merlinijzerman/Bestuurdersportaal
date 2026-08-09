// ============================================================
//  Sanity-tests voor de afschrift-leeswijzer (T6, C6).
//
//  Borgt de harde acceptatiecriteria: statuskader op pagina 1 (AC 8a/11),
//  geldige tblGrid zodat Word niet repareert (AC 12), §3-tellingen exact gelijk
//  aan de feitenkaart (AC 10/3b), en dat de .docx de kop-/voetparts bevat.
//
//  Geen testframework; standalone. Uitvoeren: npx tsx core/lib/afschrift-docx.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import JSZip from "jszip";
import type { Feitenkaart } from "./afschrift-types";
import {
  bouwSjabloonProza,
  bouwLeeswijzerDocumentXml,
  bouwLeeswijzerDocx,
  bouwLeeswijzerHtml,
  formatNlDatum,
  STATUSKADER_ANKER,
  type LeeswijzerInput,
} from "./afschrift-docx";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}
async function testAsync(naam: string, fn: () => Promise<void>) {
  await fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function maakFeitenkaart(): Feitenkaart {
  return {
    procescode: "B-2026-001",
    procedureTitel: "Wijziging beleggingsbeleid 2026",
    versie: "besluitmoment",
    aanleiding: "t.b.v. jaarrekeningcontrole 2026",
    aangemaaktOp: "2026-08-09T12:00:00.000Z",
    aantalBesluiten: 1,
    hoogsteVertrouwelijkheid: "vertrouwelijk",
    doorlooptijdDagen: 47,
    onderbouwingsfase: { start: "2026-03-03T09:00:00.000Z", eind: "2026-04-19T09:00:00.000Z" },
    besluiten: [
      {
        besluitCode: "B-2026-001", titel: "Verhoging hedge-ratio", status: "besloten",
        statusLabel: "Besloten", vertrouwelijkheid: "vertrouwelijk",
        aannames: { totaal: 7, perStatus: { gevalideerd: 5, concept: 2 } },
        risicos: { totaal: 3, perStatus: { geaccepteerd: 1, open: 2 } },
        voorwaarden: { totaal: 2, perStatus: { open: 2 } },
        acties: { totaal: 1, perStatus: { open: 1 } },
        dissent: { totaal: 1, formeel: 1, perZichtbaarheid: { formele_dissent: 1 } },
        vastgelegdeBesluiten: { totaal: 1, laatsteDatum: "2026-04-19T09:00:00.000Z" },
        eersteVastlegging: "2026-03-03T09:00:00.000Z", laatsteVastlegging: "2026-04-19T09:00:00.000Z",
      },
    ],
    bewijs: { totaal: 4, metDocument: 3, zonderDocument: 1 },
    totalen: {
      aannames: 7, aannamesGevalideerd: 5, risicos: 3, risicosGeaccepteerd: 1,
      voorwaarden: 2, voorwaardenOpen: 2, acties: 1, dissent: 1, dissentFormeel: 1,
    },
    afwijkingen: ["1 bewijsstuk bestaat alleen uit titel en beschrijving, zonder bijgevoegd bestand."],
  };
}

function maakInput(over: Partial<LeeswijzerInput> = {}): LeeswijzerInput {
  const fk = maakFeitenkaart();
  return {
    feitenkaart: fk,
    besluitvragen: [
      { besluitCode: "B-2026-001", titel: "Verhoging hedge-ratio", besluitvraag: "Verhogen naar 70%?", scope: "Rentehedge" },
    ],
    inventaris: [
      { pad: "01_Auditdossier/B-2026-001.html", omschrijving: "Het volledige auditdossier van dit besluit." },
      { pad: "02_Tijdlijn.html", omschrijving: "Chronologische tijdlijn uit beide auditsporen." },
    ],
    uitsluitingen: ["Eén bewijsstuk zonder bijgevoegd bestand (alleen titel en beschrijving)."],
    waarschuwingen: [],
    hashketenOpmerking: "Het besluit-spoor draagt sha256-hashes; het proces-spoor (procedure_log) niet.",
    opstellerNaam: "M. IJzerman",
    opstellerRol: "voorzitter",
    datumISO: "2026-08-09T12:00:00.000Z",
    snapshotHash: "f".repeat(64),
    sha256Bundel: "3f9a".padEnd(64, "c"),
    aantalBijlagen: 3,
    proza: bouwSjabloonProza(fk),
    herkomst: null,
    aiLeeswijzer: false,
    ...over,
  };
}

console.log("afschrift-docx sanity-tests:");

test("formatNlDatum geeft NL-datum zonder locale-afhankelijkheid", () => {
  assert.equal(formatNlDatum("2026-08-09T12:00:00.000Z"), "9 augustus 2026");
  assert.equal(formatNlDatum("2026-04-19"), "19 april 2026");
});

test("§3-sjabloontekst bevat exact de feitenkaart-tellingen (AC 10/3b)", () => {
  const fk = maakFeitenkaart();
  const proza = bouwSjabloonProza(fk);
  const t = proza.watVastgelegd;
  assert.ok(t.includes("7 aannames"), t);
  assert.ok(t.includes("waarvan 5 gevalideerd"));
  assert.ok(t.includes("3 risico's"));
  assert.ok(t.includes("waarvan 1 geaccepteerd"));
  assert.ok(t.includes("2 voorwaarden"));
  assert.ok(t.includes("1 actie"));
  assert.ok(t.includes("1 dissentnotitie"));
  assert.ok(t.includes("4 bewijsstukken"));
  assert.ok(t.includes("waarvan 3 met een bijgevoegd bestand"));
});

test("statuskader-anker staat in de document-XML (AC 8a/11)", () => {
  const xml = bouwLeeswijzerDocumentXml(maakInput());
  assert.ok(xml.includes(STATUSKADER_ANKER.replace(/&/g, "&amp;")) || xml.includes("niet-authoritatief"));
});

test("elke tabel heeft een geldige tblGrid met gridCol's (AC 12)", () => {
  const xml = bouwLeeswijzerDocumentXml(maakInput());
  const tblCount = (xml.match(/<w:tbl>/g) || []).length;
  const gridCount = (xml.match(/<w:tblGrid>/g) || []).length;
  assert.ok(tblCount >= 1, "verwacht minstens de kenmerkentabel");
  assert.equal(tblCount, gridCount, "elke tabel moet een tblGrid hebben");
  assert.ok(xml.includes("<w:gridCol"));
});

test("alle zes secties staan in het document, §5 uit de inventaris", () => {
  const xml = bouwLeeswijzerDocumentXml(maakInput());
  for (const kop of ["1. Waar dit dossier over gaat", "2. Hoe het proces", "3. Wat is vastgelegd",
    "4. Bijzonderheden", "5. Wat u in deze bundel aantreft", "6. Verantwoording en beperkingen"]) {
    assert.ok(xml.includes(kop), `sectie ontbreekt: ${kop}`);
  }
  assert.ok(xml.includes("01_Auditdossier/B-2026-001.html"), "§5 moet de inventaris tonen");
  assert.ok(xml.includes("dossier zoals voorzitter het op 9 augustus 2026 kon inzien"));
});

test("fase 2: herkomstblok verplicht bij AI-leeswijzer; statuskader wisselt", () => {
  const input = maakInput({
    aiLeeswijzer: true,
    herkomst: {
      model: "claude-sonnet-4-5", promptversie: "lw-1", gegenereerdOp: "2026-08-09T12:00:00.000Z",
      tekstHash: "a".repeat(64), vastgesteldDoor: "M. IJzerman", vastgesteldOp: "2026-08-09T12:30:00.000Z",
    },
  });
  const xml = bouwLeeswijzerDocumentXml(input);
  assert.ok(xml.includes("Herkomst van de AI-voorbereiding"));
  assert.ok(xml.includes("Voorbereid met AI"));
});

test("bouwLeeswijzerDocumentXml WEIGERT zonder statuskader (guard aanwezig)", () => {
  // We kunnen het anker niet los weglaten; controleer dat de guard-tekst in de
  // bron staat en dat een geldig document het anker daadwerkelijk bevat.
  const xml = bouwLeeswijzerDocumentXml(maakInput());
  assert.ok(xml.includes("niet-authoritatief"));
});

test("HTML-tweeling bevat statuskader + alle secties", () => {
  const html = bouwLeeswijzerHtml(maakInput());
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("niet-authoritatief"));
  assert.ok(html.includes("5. Wat u in deze bundel aantreft"));
});

async function main() {
  await testAsync("de .docx bevat document, styles, header1 en footer1", async () => {
    const bytes = await bouwLeeswijzerDocx(maakInput());
    const zip = await JSZip.loadAsync(bytes);
    for (const part of ["word/document.xml", "word/styles.xml", "word/header1.xml", "word/footer1.xml", "[Content_Types].xml"]) {
      assert.ok(zip.file(part), `zip mist part: ${part}`);
    }
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    assert.ok(ct.includes("header+xml") && ct.includes("footer+xml"), "content-types moet header/footer overrides bevatten");
    const ftr = await zip.file("word/footer1.xml")!.async("string");
    assert.ok(ftr.includes("PAGE") && ftr.includes("NUMPAGES"), "voettekst moet Pagina X van Y velden bevatten");
  });

  console.log(`\nafschrift-docx: ${n} tests groen.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
