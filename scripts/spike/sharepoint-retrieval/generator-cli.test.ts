// ============================================================================
//  #407 — regressie op de fail-closed argumentafhandeling van genereer-docx.py.
// ----------------------------------------------------------------------------
//  De generator herschrijft gepinde binaire fixtures. Een --only die stilletjes
//  terugvalt op "draai alles" laat daardoor precies de hashes driften die je met
//  --only wilde ontzien. Deze suite bewijst dat elke onbruikbare --only stopt
//  vóór er één byte wordt geschreven.
//
//  Vereist python3 met python-docx. Die is ook nodig om de fixtures te
//  regenereren en staat in de fixture-README; ontbreekt hij, dan faalt deze
//  suite luid in plaats van stil over te slaan.
// ============================================================================
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "../../..");
const generator = "tests/e2e/fixtures/pgb-sharepoint/bron/genereer-docx.py";

const GEPINDE_BESTANDEN = [
  "tests/e2e/fixtures/pgb-sharepoint/bibliotheek/01 Vergaderstukken/2026-09 Bestuursvergadering/PGB354-DOC-001-Agenda-en-besluitpunten-september.docx",
  "tests/e2e/fixtures/pgb-sharepoint/bibliotheek/02 Beleid en reglementen/PGB407-DOC-101-Zandloperbaken-hersteldossier.docx",
  "tests/e2e/fixtures/pgb-sharepoint/bibliotheek/02 Beleid en reglementen/PGB407-DOC-102-Nevelanker-zittingsdossier.docx",
];

function hashes(): string[] {
  return GEPINDE_BESTANDEN.map((pad) =>
    createHash("sha256").update(readFileSync(resolve(repoRoot, pad))).digest("hex"),
  );
}

function draai(...args: string[]) {
  return spawnSync("python3", [generator, ...args], { cwd: repoRoot, encoding: "utf8" });
}

test("python3 met python-docx is beschikbaar; anders is deze suite betekenisloos", () => {
  const probe = spawnSync("python3", ["-c", "import docx"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(
    probe.status,
    0,
    `python-docx ontbreekt, dus de fail-closed-regressie kan niet draaien: ${probe.stderr ?? ""}`,
  );
});

test("een ontbrekende --only-waarde stopt fail-closed en schrijft niets", () => {
  const voor = hashes();
  const uitkomst = draai("--only");
  assert.notEqual(uitkomst.status, 0, "--only zonder waarde hoort te stoppen");
  assert.match(uitkomst.stderr, /--only vereist een waarde/);
  assert.deepEqual(hashes(), voor, "er is toch geschreven");
});

test("een --only gevolgd door een andere vlag telt niet als waarde", () => {
  const voor = hashes();
  const uitkomst = draai("--only", "--iets-anders");
  assert.notEqual(uitkomst.status, 0);
  assert.match(uitkomst.stderr, /--only vereist een waarde/);
  assert.deepEqual(hashes(), voor);
});

test("een lege --only-waarde stopt fail-closed, in beide schrijfwijzen", () => {
  for (const args of [["--only="], ["--only", "   "], ["--only="], ["--only", ""]]) {
    const voor = hashes();
    const uitkomst = draai(...args);
    assert.notEqual(uitkomst.status, 0, `${args.join(" ")} hoort te stoppen`);
    assert.match(uitkomst.stderr, /--only vereist een niet-lege waarde/, args.join(" "));
    assert.deepEqual(hashes(), voor, `${args.join(" ")} heeft toch geschreven`);
  }
});

test("een onbekende --only-waarde stopt fail-closed en noemt de bekende codes", () => {
  for (const waarde of ["BOGUS", "PGB999", "pgb407", "PGB407-DOC-999", " PGB407"]) {
    const voor = hashes();
    const uitkomst = draai(`--only=${waarde}`);
    assert.notEqual(uitkomst.status, 0, `--only=${waarde} hoort te stoppen`);
    assert.match(uitkomst.stderr, /past op geen enkele fixturecode/, waarde);
    assert.match(uitkomst.stderr, /PGB407-DOC-101/, "de foutmelding noemt de bekende codes niet");
    assert.deepEqual(hashes(), voor, `--only=${waarde} heeft toch geschreven`);
  }
});

test("een onbekend argument wordt niet stil genegeerd", () => {
  const voor = hashes();
  const uitkomst = draai("--gekkigheid");
  assert.notEqual(uitkomst.status, 0);
  assert.match(uitkomst.stderr, /onbekend argument/);
  assert.deepEqual(hashes(), voor);
});

test("de foutmelding lekt geen pad of omgevingsdetail", () => {
  const uitkomst = draai("--only=BOGUS");
  assert.ok(!uitkomst.stderr.includes(repoRoot), "de foutmelding bevat het absolute repopad");
  assert.ok(!/Traceback/.test(uitkomst.stderr), "er lekt een Python-traceback naar de gebruiker");
});
