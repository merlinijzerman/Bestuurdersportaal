// ============================================================
//  Sanity-tests voor lib/bestand-validatie.ts (uploadsecurity, FO §8.2).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/bestand-validatie.sanity.ts
//  Verifieert de fail-closed kern (criterium #5): magic-bytes-mismatch en
//  OOXML-subtype-mismatch worden geweigerd, geldige bestanden geaccepteerd,
//  plus naam-normalisatie/traversal-preventie, hash-determinisme en grenzen.
// ============================================================

import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  valideerUpload,
  normaliseerBestandsnaam,
  containerVanMagicBytes,
  bestandHash,
  MAX_BESTAND_BYTES,
} from "./bestand-validatie";

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function pdfBuffer(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n", "latin1");
}

// Bouw een minimale OOXML-zip met precies de gegeven markerentry.
async function ooxmlBuffer(marker: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types/>'
  );
  zip.file(marker, "<xml/>");
  const u8 = await zip.generateAsync({ type: "uint8array" });
  return Buffer.from(u8);
}

let n = 0;
async function check(naam: string, fn: () => void | Promise<void>) {
  await fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

async function main() {
  console.log("bestand-validatie sanity-tests:");

  const pdf = pdfBuffer();
  const docx = await ooxmlBuffer("word/document.xml");
  const pptx = await ooxmlBuffer("ppt/presentation.xml");
  const xlsx = await ooxmlBuffer("xl/workbook.xml");

  // ── Containerdetectie ────────────────────────────────────────────────────
  await check("magic bytes herkennen PDF en ZIP", () => {
    assert.equal(containerVanMagicBytes(pdf), "pdf");
    assert.equal(containerVanMagicBytes(pptx), "zip");
    assert.equal(containerVanMagicBytes(Buffer.from("MZ\x00\x00")), "onbekend");
  });

  // ── Geldige bestanden ────────────────────────────────────────────────────
  await check("geldige PDF wordt geaccepteerd", async () => {
    const r = await valideerUpload({ naam: "beleid.pdf", mimeType: MIME.pdf, buffer: pdf });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.bestandstype, "pdf");
      assert.equal(r.mimeGedetecteerd, MIME.pdf);
      assert.equal(r.hash.length, 64);
    }
  });

  await check("geldige PPTX/DOCX/XLSX worden geaccepteerd op subtype", async () => {
    const rp = await valideerUpload({ naam: "deck.pptx", mimeType: MIME.pptx, buffer: pptx });
    const rd = await valideerUpload({ naam: "brief.docx", mimeType: MIME.docx, buffer: docx });
    const rx = await valideerUpload({ naam: "cijfers.xlsx", mimeType: MIME.xlsx, buffer: xlsx });
    assert.equal(rp.ok, true);
    assert.equal(rd.ok, true);
    assert.equal(rx.ok, true);
  });

  // ── Fail-closed: magic-bytes mismatch (criterium #5) ─────────────────────
  await check("PDF-inhoud met .docx-extensie → magic_bytes_mismatch", async () => {
    const r = await valideerUpload({ naam: "vermomd.docx", mimeType: MIME.docx, buffer: pdf });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.foutcode, "magic_bytes_mismatch");
  });

  await check("ZIP-inhoud met .pdf-extensie → magic_bytes_mismatch", async () => {
    const r = await valideerUpload({ naam: "vermomd.pdf", mimeType: MIME.pdf, buffer: pptx });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.foutcode, "magic_bytes_mismatch");
  });

  // ── Fail-closed: OOXML-subtype mismatch ──────────────────────────────────
  await check("DOCX-zip met .pptx-extensie → ooxml_subtype_mismatch", async () => {
    const r = await valideerUpload({ naam: "fout.pptx", mimeType: MIME.pptx, buffer: docx });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.foutcode, "ooxml_subtype_mismatch");
  });

  // ── Type, grootte, leeg ──────────────────────────────────────────────────
  await check("onbekende extensie → type_niet_ondersteund", async () => {
    const r = await valideerUpload({ naam: "macro.exe", mimeType: "application/octet-stream", buffer: pdf });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.foutcode, "type_niet_ondersteund");
  });

  await check("leeg bestand → leeg_bestand", async () => {
    const r = await valideerUpload({ naam: "leeg.pdf", mimeType: MIME.pdf, buffer: Buffer.alloc(0) });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.foutcode, "leeg_bestand");
  });

  await check("te groot bestand → te_groot", async () => {
    const groot = Buffer.alloc(MAX_BESTAND_BYTES + 1);
    groot[0] = 0x25; groot[1] = 0x50; groot[2] = 0x44; groot[3] = 0x46; // %PDF
    const r = await valideerUpload({ naam: "groot.pdf", mimeType: MIME.pdf, buffer: groot });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.foutcode, "te_groot");
  });

  // ── Naam-normalisatie + traversal ────────────────────────────────────────
  await check("path-stripping en traversal-preventie", () => {
    assert.equal(normaliseerBestandsnaam("../../etc/passwd"), "passwd");
    assert.equal(normaliseerBestandsnaam("C:\\map\\Beleid 2026.pdf"), "Beleid 2026.pdf");
    assert.equal(normaliseerBestandsnaam("..\\..\\geheim.docx"), "geheim.docx");
    // geen leidende dotfile; rare tekens → underscore
    assert.equal(normaliseerBestandsnaam(".env"), "env");
    assert.equal(normaliseerBestandsnaam("rapport<>:|.pdf"), "rapport_.pdf");
    assert.equal(normaliseerBestandsnaam(""), "document");
  });

  await check("hash is deterministisch en inhoudsgevoelig", () => {
    assert.equal(bestandHash(pdf), bestandHash(pdfBuffer()));
    assert.notEqual(bestandHash(pdf), bestandHash(docx));
  });

  console.log(`\n${n} sanity-tests geslaagd.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
