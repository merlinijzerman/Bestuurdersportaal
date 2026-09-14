import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { parseArgs, validateScannerHealth } from "./verify-scanner-health.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

test("weigert health zonder expliciete ClamAV-engine", () => {
  const { engine: _engine, ...zonderEngine } = GEZOND;
  assert.deepEqual(
    validateScannerHealth(zonderEngine, NU),
    { ok: false, code: "scanner_niet_gereed" }
  );
});

test("accepteert uitsluitend de vaste HTTPS-healthvorm", () => {
  assert.equal(parseArgs(["https://project-pnkzy.vercel.app/health"]).url.pathname, "/health");
  assert.throws(() => parseArgs(["http://project-pnkzy.vercel.app/health"]));
  assert.throws(() => parseArgs(["https://example.com/health"]));
  assert.throws(() => parseArgs(["https://project-pnkzy.vercel.app/health?token=x"]));
});

test("scannerendpoint en dagelijkse refresh voldoen aan hetzelfde health-contract", () => {
  const server = readFileSync(resolve(ROOT, "scanner/src/server.mjs"), "utf8");
  const workflow = load(readFileSync(
    resolve(ROOT, ".github/workflows/scanner-signatures-production.yml"),
    "utf8"
  ));
  const stappen = workflow?.jobs?.refresh?.steps ?? [];
  const deploy = stappen.find((stap) => String(stap?.run ?? "").includes("vercel@59.11.7 deploy"));
  const health = stappen.find((stap) => String(stap?.run ?? "").includes("verify-scanner-health.mjs"));

  assert.match(server, /return\s*{[\s\S]*?engine:\s*"clamav",[\s\S]*?engineVersion/);
  assert.ok(deploy, "dagelijkse productiedeploystap ontbreekt");
  assert.match(deploy.run, /--prod/);
  assert.match(deploy.run, /--force/);
  assert.match(deploy.run, /--archive=tgz/);
  assert.doesNotMatch(
    deploy.run,
    /--meta\b/,
    "Vercel accepteert voor deze containerdeployment geen vrije metadata"
  );
  assert.ok(health, "healthverificatie na de deployment ontbreekt");
  assert.equal(deploy["continue-on-error"], undefined);
  assert.equal(health["continue-on-error"], undefined);
});

test("onafhankelijke watchdog alarmeert duurzaam en blijft fail-closed", () => {
  const workflow = load(readFileSync(
    resolve(ROOT, ".github/workflows/scanner-signatures-watchdog.yml"),
    "utf8"
  ));
  const job = workflow?.jobs?.watchdog;
  const stappen = job?.steps ?? [];
  const health = stappen.find((stap) => stap?.id === "health");
  const incident = stappen.find((stap) => String(stap?.run ?? "").includes("gh issue create"));
  const recovery = stappen.find((stap) => String(stap?.run ?? "").includes("gh issue close"));
  const failClosed = stappen.find((stap) => String(stap?.run ?? "").includes("exit 1"));

  assert.equal(workflow?.permissions?.issues, "write");
  assert.ok(workflow?.on?.schedule?.length > 0, "watchdog heeft geen eigen schema");
  assert.equal(health?.["continue-on-error"], true);
  assert.ok(incident, "watchdog opent geen duurzaam incident");
  assert.ok(recovery, "watchdog sluit een hersteld incident niet automatisch");
  assert.ok(failClosed, "ongezonde scanner maakt de watchdog niet rood");
});
