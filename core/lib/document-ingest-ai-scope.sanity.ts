import assert from "node:assert/strict";
import { bepaalDocumentIngestAiScope } from "./document-ingest-ai-scope";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

test("generieke ingest gebruikt het globale curatiebereik", () => {
  assert.deepEqual(bepaalDocumentIngestAiScope("generiek", null), {
    ingestActietype: "generiek_curatie",
    ocrActietype: "ocr_generiek",
    fondsId: null,
  });
});

test("generieke ingest kan nooit per ongeluk op een fondsquotum drukken", () => {
  assert.equal(
    bepaalDocumentIngestAiScope("generiek", "fonds-dat-niet-gebruikt-mag-worden").fondsId,
    null
  );
});

test("fondsdocumenten behouden het fondsgebonden ingest- en OCR-bereik", () => {
  assert.deepEqual(bepaalDocumentIngestAiScope("fonds", "fonds-123"), {
    ingestActietype: "document_ingest",
    ocrActietype: "ocr",
    fondsId: "fonds-123",
  });
});

test("onbekende bibliotheek zonder fonds blijft fail-closed", () => {
  assert.deepEqual(bepaalDocumentIngestAiScope(null, null), {
    ingestActietype: "document_ingest",
    ocrActietype: "ocr",
    fondsId: null,
  });
});

console.log(`\n${n} document-ingest-ai-scope sanity-tests geslaagd.`);
