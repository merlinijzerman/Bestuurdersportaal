// ============================================================================
//  #407 — borging van het spike-eigen statusregister en van de semantische
//  fixtures. Geen netwerk, geen database, geen Microsoft-permission.
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { extractTekst } from "../../../core/lib/document-extractie";
import {
  SHAREPOINT_RETRIEVAL_FIXTURE_CODES,
  sharePointRetrievalFixtureStatus,
} from "../../../core/lib/microsoft-sharepoint-retrieval-smoke-core";
import { SPIKE_EXTRA_FIXTURE_CODES, spikeFixtureStatus } from "./fixturestatus";
import { zoektermen } from "./prototype";
import {
  SEMANTISCHE_FIXTURES_VEREIST,
  SEMANTISCHE_SCENARIO_CODES,
  VERGELIJK_SCENARIO_CODES,
  vergelijkScenario,
} from "./vergelijking-scenarios";

const repoRoot = resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(
  readFileSync(resolve(repoRoot, "tests/e2e/fixtures/pgb-sharepoint/manifest.json"), "utf8"),
) as {
  fixtures: Array<{
    code: string;
    relative_path: string;
    file_type: string;
    search_terms: string[];
    expected_fact?: string;
    semantisch?: boolean;
    status: string;
  }>;
};

// ===========================================================================
//  F-3b — het statusregister vertrouwt exact twee extra codes
// ===========================================================================

test("de spike vertrouwt bovenop de core exact PGB407-DOC-101 en PGB407-DOC-102", () => {
  assert.deepEqual([...SPIKE_EXTRA_FIXTURE_CODES], ["PGB407-DOC-101", "PGB407-DOC-102"]);
  for (const code of SPIKE_EXTRA_FIXTURE_CODES) {
    assert.equal(spikeFixtureStatus(code), "actueel", code);
    // De core kent ze bewust NIET; anders zou dit productiecode raken.
    assert.equal(sharePointRetrievalFixtureStatus(code), null, `${code} staat ten onrechte in de core`);
  }
});

test("bestaande fixtures blijven de core-lookup gebruiken, ongewijzigd", () => {
  for (const code of SHAREPOINT_RETRIEVAL_FIXTURE_CODES) {
    assert.equal(spikeFixtureStatus(code), sharePointRetrievalFixtureStatus(code), code);
  }
  // De enige historische fixture blijft historisch — geen stille promotie.
  assert.equal(spikeFixtureStatus("PGB354-PDF-002"), "historisch");
});

test("elke andere code levert null; er wordt nooit een status geraden", () => {
  for (const onbekend of [
    "PGB407-DOC-103",
    "PGB354-DOC-999",
    "pgb407-doc-101",
    "PGB407-DOC-101 ",
    " PGB407-DOC-101",
    "",
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
  ]) {
    assert.equal(spikeFixtureStatus(onbekend), null, `onverwacht vertrouwd: ${JSON.stringify(onbekend)}`);
  }
});

test("de status komt uit de gesloten map, niet uit het manifest", () => {
  // Een manifest dat iets anders beweert, mag de uitkomst niet kunnen kantelen.
  // Deze test bewijst dat door een afwijkende manifestwaarde te simuleren en
  // vast te stellen dat de functie er niet naar kijkt.
  const uitManifest = manifest.fixtures.find((fixture) => fixture.code === "PGB407-DOC-101");
  assert.ok(uitManifest, "fixture ontbreekt in het manifest");
  const vervalst = { ...uitManifest, status: "historisch" };
  assert.equal(vervalst.status, "historisch");
  assert.equal(spikeFixtureStatus("PGB407-DOC-101"), "actueel", "manifestinvoer heeft de status beïnvloed");
});

// ===========================================================================
//  Contaminatieguard op de DAADWERKELIJK gegenereerde DOCX-inhoud
// ===========================================================================

/**
 * Alle termen uit de vaste vergelijkingsset, getokeniseerd met exact dezelfde
 * functie als de lexicale passagekeuze. Bewust álle scenario's, niet alleen de
 * semantische: een semantische fixture die een term uit S02/S03/S04 bevat, kan
 * de bronset van díé scenario's vervuilen — precies de fout die #401 opleverde.
 */
function verbodenTermen(): Set<string> {
  const termen = new Set<string>();
  for (const code of VERGELIJK_SCENARIO_CODES) {
    const scenario = vergelijkScenario(code);
    const bronnen = [
      scenario.vraag,
      scenario.copilotVraag ?? "",
      ...(scenario.driveZoektermen ?? []),
      ...(scenario.microsoftZoektermen ?? []),
    ];
    for (const bron of bronnen) for (const term of zoektermen(bron)) termen.add(term);
  }
  return termen;
}

async function fixtureTekst(relativePath: string): Promise<string> {
  const bytes = readFileSync(resolve(repoRoot, "tests/e2e/fixtures/pgb-sharepoint", relativePath));
  const extractie = await extractTekst(bytes, "docx");
  return extractie.tekst;
}

test("de semantische fixtures bestaan en staan in manifest, scenarioset en statusregister", () => {
  const semantisch = manifest.fixtures.filter((fixture) => fixture.semantisch === true);
  assert.deepEqual(semantisch.map((fixture) => fixture.code).sort(), [...SEMANTISCHE_FIXTURES_VEREIST].sort());
  assert.deepEqual([...SEMANTISCHE_FIXTURES_VEREIST].sort(), [...SPIKE_EXTRA_FIXTURE_CODES].sort());
  assert.equal(SEMANTISCHE_SCENARIO_CODES.length, 2);
  for (const fixture of semantisch) assert.equal(fixture.status, "actueel", fixture.code);
});

test("de gegenereerde DOCX-inhoud deelt geen enkel token met de vaste scenarioset", async () => {
  const verboden = verbodenTermen();
  // Zekerheid dat de set niet stilletjes leegloopt en de test betekenisloos maakt.
  assert.ok(verboden.size >= 30, `verwacht een gevulde termenset, kreeg ${verboden.size}`);

  for (const fixture of manifest.fixtures.filter((kandidaat) => kandidaat.semantisch === true)) {
    const tekst = await fixtureTekst(fixture.relative_path);
    assert.ok(tekst.length > 200, `${fixture.code} levert nauwelijks tekst op`);

    const gedeeld = [...new Set(zoektermen(tekst))].filter((term) => verboden.has(term));
    assert.deepEqual(gedeeld, [], `${fixture.code} deelt tokens met de scenarioset: ${gedeeld.join(", ")}`);
  }
});

test("de gegenereerde DOCX-inhoud bevat ook geen scenarioterm als deelreeks", async () => {
  // `passageUitSegmenten` toetst met includes(), niet op hele woorden. Een
  // fixture met "geen" zou daardoor alsnog scoren op het vraagwoord "een".
  // Tokengelijkheid alleen is dus niet genoeg om lexicale lekkage uit te sluiten.
  const verboden = verbodenTermen();
  for (const fixture of manifest.fixtures.filter((kandidaat) => kandidaat.semantisch === true)) {
    const tekst = await fixtureTekst(fixture.relative_path);
    const normaal = tekst.toLocaleLowerCase("nl").normalize("NFKD").replace(/\p{M}/gu, "");
    const gevonden = [...verboden].filter((term) => normaal.includes(term)).sort();
    assert.deepEqual(gevonden, [], `${fixture.code} bevat scenariotermen als deelreeks: ${gevonden.join(", ")}`);
  }
});

test("de canary dient uitsluitend voor indexgereedheid en staat in geen enkele vraag of zoekterm", async () => {
  const scenarioTekst = VERGELIJK_SCENARIO_CODES.map((code) => {
    const scenario = vergelijkScenario(code);
    return [
      scenario.vraag,
      scenario.copilotVraag ?? "",
      ...(scenario.driveZoektermen ?? []),
      ...(scenario.microsoftZoektermen ?? []),
    ].join(" ");
  }).join(" ").toLocaleLowerCase("nl");

  for (const fixture of manifest.fixtures.filter((kandidaat) => kandidaat.semantisch === true)) {
    const canary = fixture.search_terms[0];
    assert.ok(canary, `${fixture.code} mist een canaryterm`);
    for (const term of zoektermen(canary)) {
      assert.ok(!scenarioTekst.includes(term), `canaryterm "${canary}" lekt in de scenarioset via "${term}"`);
    }
    // En de canary moet wél in het document staan, anders is de indexprobe leeg.
    const tekst = (await fixtureTekst(fixture.relative_path)).toLocaleLowerCase("nl");
    assert.ok(tekst.includes(canary.toLocaleLowerCase("nl")), `${fixture.code} bevat de canary niet`);
  }
});

test("de semantische fixtures bevatten nergens een vraagregel", async () => {
  // De gedeelde make_simple_doc schrijft een metadatatabel met de letterlijke
  // vraag erin. Dat patroon mag hier niet terugkeren.
  for (const fixture of manifest.fixtures.filter((kandidaat) => kandidaat.semantisch === true)) {
    const tekst = (await fixtureTekst(fixture.relative_path)).toLocaleLowerCase("nl");
    assert.ok(!tekst.includes("vraag\t"), `${fixture.code} bevat een vraagrij`);
    assert.ok(!tekst.includes("?"), `${fixture.code} bevat een vraagteken`);
  }
});

// ===========================================================================
//  expected_fact moet letterlijk in het uitgepakte document staan
// ===========================================================================

/** Alleen witruimte normaliseren; woorden en leestekens blijven intact. */
function witruimte(tekst: string): string {
  return tekst.replace(/\s+/g, " ").trim();
}

test("elk manifest-antwoordfeit staat letterlijk in de uitgepakte broninhoud", async () => {
  const leesbaar = new Set(["docx", "pdf", "pptx"]);
  const gecontroleerd: string[] = [];

  for (const fixture of manifest.fixtures) {
    if (!fixture.expected_fact || !leesbaar.has(fixture.file_type)) continue;
    const bytes = readFileSync(
      resolve(repoRoot, "tests/e2e/fixtures/pgb-sharepoint", fixture.relative_path),
    );
    const extractie = await extractTekst(bytes, fixture.file_type as "docx" | "pdf" | "pptx");
    assert.ok(
      witruimte(extractie.tekst).includes(witruimte(fixture.expected_fact)),
      `${fixture.code}: expected_fact staat niet letterlijk in het document.\n`
        + `  manifest: ${witruimte(fixture.expected_fact)}`,
    );
    gecontroleerd.push(fixture.code);
  }

  // Zonder deze ondergrens zou een leeggelopen manifest de test groen houden.
  assert.ok(gecontroleerd.length >= 10, `verwacht minstens 10 gecontroleerde feiten, kreeg ${gecontroleerd.length}`);
  for (const code of SEMANTISCHE_FIXTURES_VEREIST) {
    assert.ok(gecontroleerd.includes(code), `${code} is niet op zijn antwoordfeit gecontroleerd`);
  }
});
