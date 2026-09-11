// ============================================================================
//  Releasegrendel #358/#359 — scope en idempotentie van de ingestworker.
// ----------------------------------------------------------------------------
//  main begrensde generieke documenten terecht globaal, maar reserveerde een
//  nieuwe ingestactie bij iedere technische retry. Preview bracht de hele
//  ingest onder de centrale gateway en koos bewust voor één reservering per
//  logische job. Deze test borgt beide kanten van de reconciliatie:
//    - generieke ingest/OCR is globaal; fondsdocumenten blijven fondsgebonden;
//    - yield/backoff van ingest hergebruikt poging 1;
//    - betaalde OCR-pogingen houden hun eigen pogingnummer.
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bepaalDocumentIngestAiScope } from "../../core/lib/document-ingest-ai-scope";

const hier = dirname(fileURLToPath(import.meta.url));
const wortel = join(hier, "..", "..");
const orchestrator = readFileSync(
  join(wortel, "platform/lib/ingest-orchestrator.ts"),
  "utf8"
);

test("generieke ingest en OCR tellen globaal; fondsdocumenten per fonds", () => {
  assert.deepEqual(bepaalDocumentIngestAiScope("generiek", "fonds-negeren"), {
    ingestActietype: "generiek_curatie",
    ocrActietype: "ocr_generiek",
    fondsId: null,
  });
  assert.deepEqual(bepaalDocumentIngestAiScope("fonds", "fonds-123"), {
    ingestActietype: "document_ingest",
    ocrActietype: "ocr",
    fondsId: "fonds-123",
  });
});

test("één logische ingestjob houdt één reservering over yield en backoff", () => {
  assert.match(
    orchestrator,
    /idempotentie:\s*systeemSleutel\(job\.id,\s*actietype,\s*1\)/,
    "ingest moet poging 1 hergebruiken voor dezelfde logische job"
  );
  assert.doesNotMatch(
    orchestrator,
    /systeemSleutel\(job\.id,[^\n]*retry_count/,
    "een technische retry mag geen nieuwe ingestreservering maken"
  );
});

test("iedere betaalde OCR-poging houdt een afzonderlijke reservering", () => {
  assert.match(
    orchestrator,
    /idempotentie:\s*systeemSleutel\(job\.id,\s*ocrActietype,\s*poging\)/,
    "OCR moet het providerpogingnummer in de idempotentiesleutel behouden"
  );
});
