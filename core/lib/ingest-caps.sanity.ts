// ============================================================
//  Sanity-tests voor lib/ingest-caps.ts (Fase 1 ingest-vangrails).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx lib/ingest-caps.sanity.ts
//  Verifieert: cap-grenzen, IngestCapError-vorm en de meldingen.
// ============================================================

import assert from "node:assert/strict";
import {
  IngestCapError,
  MAX_CHUNKS_PER_DOCUMENT,
  MAX_OCR_PAGINAS_SYNCHROON,
  MAX_XLSX_RIJEN_PER_TABBLAD,
  FOUTCODE_OCR_TE_VEEL_PAGINAS,
  FOUTCODE_TE_GROOT,
  STATUS_TEKSTHERKENNING_NODIG,
  overschrijdtChunkCap,
  chunkCapMelding,
  ocrPaginaCapMelding,
  tekstherkenningNodigMelding,
  xlsxRijenMelding,
  MAX_BESTAND_BYTES,
  toegestaneUploadExtensie,
  bestandTeGrootMelding,
} from "./ingest-caps";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("ingest-caps sanity-tests:");

check("chunk-cap: precies op de grens is toegestaan, één erboven niet", () => {
  assert.equal(overschrijdtChunkCap(MAX_CHUNKS_PER_DOCUMENT), false);
  assert.equal(overschrijdtChunkCap(MAX_CHUNKS_PER_DOCUMENT + 1), true);
  assert.equal(overschrijdtChunkCap(0), false);
});

check("IngestCapError draagt de juiste naam + default-foutcode", () => {
  const e = new IngestCapError("te groot");
  assert.equal(e.name, "IngestCapError");
  assert.equal(e.foutcode, FOUTCODE_TE_GROOT);
  assert.ok(e instanceof Error);
  assert.ok(e instanceof IngestCapError);
});

check("meldingen noemen de telling en de limiet", () => {
  const m1 = chunkCapMelding(9999);
  assert.ok(m1.includes("9999"));
  assert.ok(m1.includes(String(MAX_CHUNKS_PER_DOCUMENT)));

  const m2 = xlsxRijenMelding("Data", 59880);
  assert.ok(m2.includes("Data"));
  assert.ok(m2.includes("59880"));
  assert.ok(m2.includes(String(MAX_XLSX_RIJEN_PER_TABBLAD)));
});

// ── OCR-paginacap (besluit 0134) ──────────────────────────────────────────

check("OCR-paginacap past binnen het tijdbudget van maxDuration = 300 s", () => {
  // Geen kaal "> 0"-vinkje maar de eis die de cap bestáánsrecht geeft: de hele
  // keten moet binnen één request passen. Kostenmodel (besluit 0134):
  //   • OCR is ÉÉN call over het hele PDF, niet per pagina — worst case
  //     MAX_RETRIES (3) × OCR_TIMEOUT_MS (60 s) = 180 s, zie lib/ocr.ts;
  //   • daarna schaalt het wél per pagina: één context-prefix (Haiku) plus een
  //     embedding per chunk, en een scan levert grofweg één chunk per pagina.
  // Wordt de cap opgehoogd zonder dat het synchrone pad is vervangen door de
  // async ingest-worker, dan hoort deze test daarover te struikelen.
  const OCR_WORST_CASE_SECONDEN = 3 * 60;
  const NAVERWERKING_SECONDEN_PER_PAGINA = 1.5;
  const MAX_DURATION_SECONDEN = 300;
  const geschat =
    OCR_WORST_CASE_SECONDEN +
    MAX_OCR_PAGINAS_SYNCHROON * NAVERWERKING_SECONDEN_PER_PAGINA;
  assert.ok(
    geschat <= MAX_DURATION_SECONDEN,
    `cap ${MAX_OCR_PAGINAS_SYNCHROON} geeft een geschatte ${geschat}s, boven maxDuration ${MAX_DURATION_SECONDEN}s`
  );
});

check("OCR-cap-melding noemt de telling, de limiet en het handelingsperspectief", () => {
  const m = ocrPaginaCapMelding(180);
  assert.ok(m.includes("180"));
  assert.ok(m.includes(String(MAX_OCR_PAGINAS_SYNCHROON)));
  // Een weigering zonder uitweg is een doodlopende straat voor de gebruiker.
  assert.ok(/splits|asynchron/i.test(m));
});

check("tekstherkenning-melding is een BEWAAR-melding, geen foutmelding", () => {
  const m = tekstherkenningNodigMelding("Jaarverslag 2025");
  assert.ok(m.includes("Jaarverslag 2025"));
  // Kern van besluit 0134: het document is opgeslagen. Suggereert de tekst dat
  // het is geweigerd, dan gaat de gebruiker onnodig opnieuw uploaden.
  assert.ok(/opgeslagen/i.test(m));
  assert.ok(/Tekstherkenning/i.test(m));
});

check("statuscode tekstherkenning is stabiel (UI keyt hierop)", () => {
  assert.equal(STATUS_TEKSTHERKENNING_NODIG, "tekstherkenning_nodig");
  assert.equal(FOUTCODE_OCR_TE_VEEL_PAGINAS, "ocr_te_veel_paginas");
});

// ── F7 direct-to-storage: pad-extensie + groottegrens ──────────────────────
check("toegestaneUploadExtensie herkent de vier ondersteunde types (case-insensitief)", () => {
  assert.equal(toegestaneUploadExtensie("Jaarverslag 2025.pdf"), "pdf");
  assert.equal(toegestaneUploadExtensie("Notitie.DOCX"), "docx");
  assert.equal(toegestaneUploadExtensie("Deck.pptx"), "pptx");
  assert.equal(toegestaneUploadExtensie("Cijfers.xlsx"), "xlsx");
});

check("toegestaneUploadExtensie weigert onbekende/ontbrekende extensies", () => {
  assert.equal(toegestaneUploadExtensie("virus.exe"), null);
  assert.equal(toegestaneUploadExtensie("geen-extensie"), null);
  assert.equal(toegestaneUploadExtensie("archief.pdf.zip"), null);
  // Dubbel puntje mag niet meetellen als geldige extensie ergens middenin.
  assert.equal(toegestaneUploadExtensie("rapport.pdf.bak"), null);
});

check("toegestaneUploadExtensie werkt ook op een opslagpad (autoriteit in complete)", () => {
  assert.equal(
    toegestaneUploadExtensie("11111111-1111-1111-1111-111111111111/abc.pdf"),
    "pdf"
  );
});

check("MAX_BESTAND_BYTES is 25 MB en de te-groot-melding noemt de grens + handeling", () => {
  assert.equal(MAX_BESTAND_BYTES, 25 * 1024 * 1024);
  const m = bestandTeGrootMelding(30 * 1024 * 1024);
  assert.ok(m.includes("30,0"));
  assert.ok(m.includes("25,0"));
  // Geen doodlopende straat: bied een uitweg (splitsen/comprimeren).
  assert.ok(/splits|comprimeer/i.test(m));
});

console.log(`\n${n} sanity-tests geslaagd.`);
