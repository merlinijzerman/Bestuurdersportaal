import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(fixtureRoot, "../../../..");
const manifest = JSON.parse(readFileSync(resolve(fixtureRoot, "manifest.json"), "utf8"));

const requiredFolders = [
  "01 Vergaderstukken",
  "01 Vergaderstukken/2026-09 Bestuursvergadering",
  "01 Vergaderstukken/2026-10 Bestuursvergadering",
  "02 Beleid en reglementen",
  "03 Historisch en vervallen",
  "04 Beperkt bestuur",
  "99 Mutatie- en intrekkingstests",
];

test("PGB354 manifest bevat de vaste veilige setmetadata en mappen", () => {
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.set_code, "PGB354");
  assert.equal(manifest.purpose, "PGB Preview-pilot");
  assert.equal(manifest.owner, "M365 pilotteam");
  assert.equal(manifest.library_root, "PGB");
  assert.match(manifest.review_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(manifest.folders.map((folder) => folder.path), requiredFolders);
  assert.deepEqual(manifest.folders.find((folder) => folder.path === "04 Beperkt bestuur").access, ["rol_a"]);
});

test("PGB354 corpus dekt Office, digitaal PDF, historie, mutaties, intrekking en moeilijke bestanden", () => {
  const fixtures = manifest.fixtures;
  assert.equal(fixtures.length, 10);
  assert.equal(new Set(fixtures.map((fixture) => fixture.code)).size, fixtures.length);
  assert.ok(fixtures.some((fixture) => fixture.file_type === "docx"));
  assert.ok(fixtures.some((fixture) => fixture.file_type === "pdf" && fixture.status === "actueel"));
  assert.ok(fixtures.some((fixture) => fixture.file_type === "pptx"));
  assert.ok(fixtures.some((fixture) => fixture.status === "vervallen"));
  assert.ok(fixtures.some((fixture) => fixture.replacement_path));
  assert.ok(fixtures.some((fixture) => fixture.scenarios.includes("S06")));
  assert.ok(fixtures.some((fixture) => fixture.scenarios.includes("S08")));
  assert.ok(fixtures.some((fixture) => fixture.file_type === "pdf_scan" && fixture.retrieval_error === "tekstlaag_ontbreekt"));
  assert.ok(fixtures.some((fixture) => fixture.retrieval_error === "bestandstype_niet_ondersteund"));
});

test("PGB354 acceptatievragen hebben vooraf bepaalde bronnen en uitkomsten", () => {
  assert.deepEqual(manifest.scenarios.map((scenario) => scenario.code), ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10"]);
  for (const scenario of manifest.scenarios) {
    assert.ok(Array.isArray(scenario.expected_sources));
    assert.ok(typeof scenario.expected_result === "string" && scenario.expected_result.length > 12);
  }
  assert.deepEqual(manifest.scenarios.find((scenario) => scenario.code === "S05").forbidden_sources, ["PGB354-DOC-002"]);
  assert.deepEqual(manifest.scenarios.find((scenario) => scenario.code === "S09").forbidden_sources, ["PGB354-DOC-005"]);
});

test("PGB354 bestanden bestaan, blijven binnen de fixturemap en matchen de gepinde hashes", () => {
  const checksumLines = readFileSync(resolve(fixtureRoot, "checksums.sha256"), "utf8").trim().split("\n");
  const checksums = new Map(checksumLines.map((line) => {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    assert.ok(match, `ongeldige checksumregel: ${line}`);
    return [match[2], match[1]];
  }));
  const referenced = manifest.fixtures.flatMap((fixture) => [fixture.relative_path, fixture.replacement_path].filter(Boolean));
  assert.equal(checksums.size, referenced.length);
  for (const relativePath of referenced) {
    assert.ok(!relativePath.startsWith("/") && !relativePath.split("/").includes(".."));
    const absolutePath = resolve(fixtureRoot, relativePath);
    assert.ok(absolutePath.startsWith(fixtureRoot + "/"));
    assert.ok(existsSync(absolutePath), `bestand ontbreekt: ${relativePath}`);
    assert.ok(statSync(absolutePath).size > 100, `bestand is leeg of te klein: ${relativePath}`);
    const digest = createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
    assert.equal(digest, checksums.get(relativePath), `hashdrift in ${relativePath}`);
  }
});

test("PGB354 canarytermen zijn uniek en staan in de leesbare bronbestanden", () => {
  const canaries = manifest.fixtures.map((fixture) => fixture.search_terms[0]);
  assert.equal(new Set(canaries).size, canaries.length);
  const sources = [
    "bron/genereer-docx.py",
    "bron/genereer-pdf.py",
    "bron/genereer-pptx.mjs",
    "bibliotheek/99 Mutatie- en intrekkingstests/PGB354-UNS-001-Onbekend-formaat.bin",
  ].map((relativePath) => readFileSync(resolve(fixtureRoot, relativePath), "utf8")).join("\n");
  for (const canary of canaries) assert.ok(sources.includes(canary), `canary ontbreekt in bron: ${canary}`);
});

test("PGB354 gevolgde configuratie bevat geen private Microsoft-waarden of accountnamen", () => {
  const tracked = [
    readFileSync(resolve(fixtureRoot, "manifest.json"), "utf8"),
    readFileSync(resolve(fixtureRoot, "private-mapping.example.json"), "utf8"),
    readFileSync(resolve(fixtureRoot, "rechtenmatrix.md"), "utf8"),
    readFileSync(resolve(repoRoot, "security/MICROSOFT-365-PGB-RETRIEVAL-ACCEPTATIESET.md"), "utf8"),
  ].join("\n");
  assert.doesNotMatch(tracked, /https?:\/\/[^\s<]+\.sharepoint\.com/i);
  assert.doesNotMatch(tracked, /@[a-z0-9.-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(tracked, /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
  const example = JSON.parse(readFileSync(resolve(fixtureRoot, "private-mapping.example.json"), "utf8"));
  assert.equal(example.site.site_id, null);
  assert.equal(example.site.drive_id, null);
  assert.equal(example.accounts.rol_a.user_principal_name, null);
  for (const mapping of Object.values(example.fixtures)) {
    assert.deepEqual(Object.values(mapping), [null, null, null, null]);
  }
});
