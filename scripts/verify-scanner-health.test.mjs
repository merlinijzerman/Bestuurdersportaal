import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, validateScannerHealth } from "./verify-scanner-health.mjs";

const NU = Date.parse("2026-09-05T12:00:00Z");
const GEZOND = {
  ready: true,
  eicarOk: true,
  engine: "clamav",
  engineVersion: "1.4.6",
  signatureVersion: "28114",
  signaturePublishedAt: "2026-09-05T06:23:00Z",
  imageBuiltAt: "2026-09-05T11:50:00Z",
  deploymentId: "dpl_test123",
};

test("accepteert een verse, gereedstaande productie-scanner", () => {
  const resultaat = validateScannerHealth(GEZOND, NU);
  assert.equal(resultaat.ok, true);
  assert.equal(resultaat.signatureVersion, "28114");
});

test("weigert verouderde signatures", () => {
  const resultaat = validateScannerHealth({
    ...GEZOND,
    signaturePublishedAt: "2026-09-02T00:00:00Z",
  }, NU);
  assert.deepEqual(resultaat, { ok: false, code: "signatures_verouderd" });
});

test("weigert een oude image ook wanneer signatures actueel lijken", () => {
  const resultaat = validateScannerHealth({
    ...GEZOND,
    imageBuiltAt: "2026-09-05T10:00:00Z",
  }, NU);
  assert.deepEqual(resultaat, { ok: false, code: "image_niet_ververst" });
});

test("weigert een scanner zonder geslaagde EICAR-poort", () => {
  const resultaat = validateScannerHealth({ ...GEZOND, eicarOk: false }, NU);
  assert.deepEqual(resultaat, { ok: false, code: "scanner_niet_gereed" });
});

test("accepteert uitsluitend de vaste HTTPS-healthvorm", () => {
  assert.equal(parseArgs(["https://project-pnkzy.vercel.app/health"]).url.pathname, "/health");
  assert.throws(() => parseArgs(["http://project-pnkzy.vercel.app/health"]));
  assert.throws(() => parseArgs(["https://example.com/health"]));
  assert.throws(() => parseArgs(["https://project-pnkzy.vercel.app/health?token=x"]));
});
