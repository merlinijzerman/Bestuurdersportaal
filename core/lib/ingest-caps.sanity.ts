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
  MAX_XLSX_RIJEN_PER_TABBLAD,
  FOUTCODE_TE_GROOT,
  overschrijdtChunkCap,
  chunkCapMelding,
  xlsxRijenMelding,
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

console.log(`\n${n} sanity-tests geslaagd.`);
