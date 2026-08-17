// Controleert welke LAAG welke drager weigert. De scanner is niet de poort voor
// decompressiebommen of kapotte containers — valideerUpload is dat, en draait in
// de worker vóór de scan. Dit script legt dat vast met de echte productiecode.
import { readFileSync } from "node:fs";
import { beoordeelDecompressie, valideerUpload } from "../../../core/lib/bestand-validatie.ts";

const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAP = "scanner/test/corpus/bestanden";

async function main() {
  const zipbom = readFileSync(`${MAP}/zipbom.docx`);
  console.log(`zipbom.docx  ${zipbom.length} bytes op schijf`);
  console.log("  beoordeelDecompressie:", JSON.stringify(await beoordeelDecompressie(zipbom)));
  const vz = await valideerUpload({ naam: "zipbom.docx", mimeType: MIME_DOCX, buffer: zipbom });
  console.log("  valideerUpload:", vz.ok ? "TOEGELATEN" : `GEWEIGERD (${vz.foutcode})`);

  const kapot = readFileSync(`${MAP}/kapot.docx`);
  const vk = await valideerUpload({ naam: "kapot.docx", mimeType: MIME_DOCX, buffer: kapot });
  console.log(`kapot.docx   ${kapot.length} bytes op schijf`);
  console.log("  valideerUpload:", vk.ok ? "TOEGELATEN" : `GEWEIGERD (${vk.foutcode})`);
}

void main();
