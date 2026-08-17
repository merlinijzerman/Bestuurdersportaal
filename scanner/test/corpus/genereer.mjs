// ============================================================================
//  scanner/test/corpus/genereer.mjs — bouwt het W0-testcorpus.
// ----------------------------------------------------------------------------
//  Dit corpus moet twee dingen tegelijk bewijzen, en dat onderscheid is de
//  hele reden dat het bestaat:
//
//   1. De dragers zijn VALIDATOR-GELDIG. Een rauw EICAR-bestand met een
//      .pdf-naam wordt al door core/lib/bestand-validatie.ts geweigerd op
//      magic bytes en bereikt de scanner nooit. Zo'n test bewijst dus niets
//      over de scanner. De dragers hier zijn echte PDF's en echte OOXML-zips
//      met een geldige markerentry, die de uploadvalidatie passeren.
//
//   2. Elke limietdrager moet aantoonbaar NIET als `clean` eindigen. ClamAV
//      slaat bestanden boven MaxFileSize over "and assumed clean" — dat is de
//      fail-open die de Alert-opties in clamd.conf dichtzetten.
//
//  Dev-only. Gebruikt jszip uit de hoofdrepo (mvp/node_modules) omdat dit
//  gereedschap is, geen productiecode; de scanner zelf heeft die dependency niet.
//
//  Gebruik:  node test/corpus/genereer.mjs [doelmap]
// ============================================================================

import { mkdir, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createRequire } from "node:module";

const uitvoeren = promisify(execFile);
const require = createRequire(import.meta.url);
// jszip leeft in de hoofdrepo; dit script draait vanuit mvp/scanner.
const JSZip = require(path.resolve(import.meta.dirname, "../../../node_modules/jszip"));

const DOEL = process.argv[2] ?? path.resolve(import.meta.dirname, "bestanden");

// De EICAR-teststring staat base64 zodat de letterlijke handtekening niet in de
// repository staat — anders slaan virusscanners van ontwikkelaars aan op de
// broncode zelf.
const EICAR = Buffer.from(
  "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=",
  "base64"
).toString("ascii");

// ── PDF ─────────────────────────────────────────────────────────────────────

/** Bouwt een minimale, structureel geldige PDF. Begint met %PDF- (magic bytes)
 *  en eindigt met %%EOF, dus valideerUpload herkent hem als PDF.
 *
 *  `bijlage` wordt als RAUWE, ongecomprimeerde streaminhoud toegevoegd — de
 *  realistische vorm van malware in een PDF (een ingesloten bestand). Dat moet
 *  rauw, want de tekststream-variant ontkomt niet aan PDF-escaping van `\`,
 *  `(` en `)`, en juist die tekens zitten in de EICAR-string: het escapen
 *  vernielt de handtekening, waarna de scanner terecht niets vindt. Die val
 *  kostte een testronde en staat daarom hier vastgelegd. */
function maakPdf(tekst, bijlage = null) {
  const stream = `BT /F1 12 Tf 72 720 Td (${tekst.replace(/([()\\])/g, "\\$1")}) Tj ET`;

  // De bijlage moet vanuit de CATALOGUS gerefereerd zijn (/Names /EmbeddedFiles
  // → /Filespec → /EmbeddedFile), anders haalt de PDF-ontleder van ClamAV hem
  // niet als los bestand naar boven en blijft de handtekening onzichtbaar. Een
  // losse, ongerefereerde stream is aantoonbaar NIET genoeg — dat is gemeten.
  const catalogus =
    bijlage !== null
      ? "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(bijlage.bin) 6 0 R] >> >> >>"
      : "<< /Type /Catalog /Pages 2 0 R >>";

  const objecten = [
    catalogus,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R " +
      "/Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  if (bijlage !== null) {
    // 6 0 obj — de bestandsspecificatie die de catalogus noemt.
    objecten.push("<< /Type /Filespec /F (bijlage.bin) /EF << /F 7 0 R >> >>");
    // 7 0 obj — het ingesloten bestand zelf, ongecomprimeerd.
    objecten.push(
      `<< /Type /EmbeddedFile /Subtype /application#2Foctet-stream ` +
        `/Params << /Size ${bijlage.length} >> /Length ${bijlage.length} >>\n` +
        `stream\n${bijlage}\nendstream`
    );
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objecten.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objecten.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objecten.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// ── OOXML ───────────────────────────────────────────────────────────────────

/** Bouwt een geldige DOCX. `extra` voegt aanvullende entries toe — zo maken we
 *  een drager die de OOXML-markerentrycheck van valideerUpload passeert. */
async function maakDocx(extra = {}) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>"
  );
  zip.folder("_rels").file(
    ".rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>"
  );
  zip.folder("word").file(
    "document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body><w:p><w:r><w:t>Testdocument voor de WP3-scannerpoort.</w:t></w:r></w:p></w:body>" +
      "</w:document>"
  );
  for (const [naam, inhoud] of Object.entries(extra)) zip.file(naam, inhoud);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ── Corpus ──────────────────────────────────────────────────────────────────

async function main() {
  await rm(DOEL, { recursive: true, force: true });
  await mkdir(DOEL, { recursive: true });

  const schrijf = async (naam, data) => {
    await writeFile(path.join(DOEL, naam), data);
    const mb = (data.length / 1024 / 1024).toFixed(2);
    console.log(`  ${naam.padEnd(28)} ${String(data.length).padStart(10)} bytes (${mb} MB)`);
  };

  console.log("Schone dragers (moeten `clean` opleveren):");
  await schrijf("schoon.pdf", maakPdf("Dit is een schoon testdocument."));
  await schrijf("schoon.docx", await maakDocx());

  console.log("\nEICAR-dragers (moeten `infected` opleveren):");
  // De teststring als ingesloten bestandsstream in een verder normale PDF:
  // structureel geldig, dus de uploadvalidatie laat hem door — precies de
  // situatie die we willen toetsen.
  await schrijf("eicar-drager.pdf", maakPdf("Onschuldig ogende brief.", EICAR));
  // In een OOXML-zip als losse entry; de markerentry word/document.xml blijft
  // geldig, dus ook deze passeert de uploadvalidatie.
  await schrijf("eicar-drager.docx", await maakDocx({ "word/embeddings/bijlage.bin": EICAR }));

  console.log("\nLimietdragers (mogen NOOIT `clean` opleveren):");
  // Zip-bom: sterk samendrukbare inhoud die na uitpakken boven MaxFileSize
  // (64 MB) uitkomt, terwijl het bestand zelf enkele tientallen kB blijft.
  // Buffer in plaats van string: een JS-string van deze omvang kost het dubbele
  // aan geheugen (UTF-16) en laat de generator omvallen.
  await schrijf(
    "zipbom.docx",
    await maakDocx({ "word/embeddings/groot.bin": Buffer.alloc(70 * 1024 * 1024, 0x41) })
  );
  // Kapotte OOXML: geldige magic bytes, afgekapte centrale directory.
  const heel = await maakDocx();
  await schrijf("kapot.docx", heel.subarray(0, Math.floor(heel.length * 0.6)));
  // Bestand boven de bytecap van de scanner (64 MB).
  await schrijf("te-groot.bin", Buffer.alloc(70 * 1024 * 1024, 0x41));

  // Versleuteld archief met OOXML-vorm: de centrale directory blijft leesbaar
  // (dus de markerentrycheck slaagt), maar de inhoud is niet te ontleden.
  // AlertEncryptedArchive moet hierop aanslaan. Gebouwd met de zip-CLI omdat
  // jszip geen versleuteling kent.
  try {
    const tmp = path.join(DOEL, "_versleuteld");
    await mkdir(path.join(tmp, "word"), { recursive: true });
    await writeFile(path.join(tmp, "[Content_Types].xml"), "<Types/>");
    await writeFile(path.join(tmp, "word", "document.xml"), "<w:document/>");
    await uitvoeren("zip", ["-r", "-P", "geheimwachtwoord", "../versleuteld.docx", "."], { cwd: tmp });
    await rm(tmp, { recursive: true, force: true });
    console.log("  versleuteld.docx             (via zip-CLI, wachtwoordbeveiligd)");
  } catch (e) {
    console.warn(`  versleuteld.docx OVERGESLAGEN — zip-CLI niet beschikbaar (${e.code ?? e.message})`);
  }

  console.log(`\nCorpus staat in ${DOEL}`);
}

await main();
