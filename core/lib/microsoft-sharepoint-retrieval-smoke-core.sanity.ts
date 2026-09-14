import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  borgIntrekkingsUitkomst,
  SHAREPOINT_RETRIEVAL_FIXTURE_CODES,
  SHAREPOINT_RETRIEVAL_SMOKE_ROUTES,
  SHAREPOINT_RETRIEVAL_SMOKE_SCENARIOS,
  fixtureCodeUitBestandsnaam,
  isSharePointRetrievalSmokePreview,
  sharePointRetrievalSmokeVraag,
  veiligeSmokeFoutcategorie,
} from "./microsoft-sharepoint-retrieval-smoke-core";

test("#353: Preview-grendel vereist beide exacte omgevingswaarden", () => {
  assert.equal(isSharePointRetrievalSmokePreview({ seedDoelomgeving: "preview", vercelEnv: "preview" }), true);
  for (const waarden of [
    { seedDoelomgeving: "production", vercelEnv: "preview" },
    { seedDoelomgeving: "preview", vercelEnv: "production" },
    { seedDoelomgeving: "Preview", vercelEnv: "preview" },
    { seedDoelomgeving: undefined, vercelEnv: "preview" },
  ]) assert.equal(isSharePointRetrievalSmokePreview(waarden), false);
});

test("#353: alleen vaste routes, vragen en fixturecodes uit #385 zijn inzetbaar", () => {
  assert.deepEqual(SHAREPOINT_RETRIEVAL_SMOKE_ROUTES, ["drive_search_extract", "microsoft_search"]);
  assert.deepEqual(SHAREPOINT_RETRIEVAL_SMOKE_SCENARIOS, ["S00", "S02", "S03", "S04", "S08", "S09", "S08R"]);
  assert.equal(sharePointRetrievalSmokeVraag("S00").vraag, "m365-permission-probe-7f4c1d9e-no-match");
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "tests/e2e/fixtures/pgb-sharepoint/manifest.json"), "utf8"));
  for (const scenario of ["S02", "S03", "S04", "S08", "S09"] as const) {
    assert.equal(sharePointRetrievalSmokeVraag(scenario).vraag, manifest.scenarios.find((x: { code: string }) => x.code === scenario)?.question);
  }
  const manifestCodes = new Set(manifest.fixtures.map((x: { code: string }) => x.code));
  for (const code of SHAREPOINT_RETRIEVAL_FIXTURE_CODES) assert.ok(manifestCodes.has(code));
  assert.equal(fixtureCodeUitBestandsnaam("PGB354-DOC-001-Agenda-en-besluitpunten-september.docx"), "PGB354-DOC-001");
  assert.equal(fixtureCodeUitBestandsnaam("ander-document.docx"), null);
});

test("#353: foutprojectie lekt geen vrije fouttekst", () => {
  assert.equal(veiligeSmokeFoutcategorie({ categorie: "toestemming_geweigerd", geheim: "token" }), "toestemming_geweigerd");
  assert.equal(veiligeSmokeFoutcategorie(new Error("private Graph-url")), "providerfout");
  assert.equal(veiligeSmokeFoutcategorie({ categorie: "niet-veilig!" }), "providerfout");
});

test("#353: negatieve intrekkingsscenario's falen hard zodra een fixture terugkomt", () => {
  const basis = {
    ronde: 1,
    vraagcode: "S08",
    route: "drive_search_extract" as const,
    resultaat: "geslaagd" as const,
    foutcategorie: null,
    foutcode: null,
    gevondenFixtures: ["PGB354-DOC-005"],
    recall: 1,
    locatorDekking: 1,
    versieDekking: 1,
    previewDekking: 1,
    latencyMs: 100,
    microsoftCalls: 3,
    responseBytes: 100,
    contentBytes: 100,
    throttles: 0,
    retries: 0,
    versieVingerafdrukken: ["123456789abc"],
  };
  assert.deepEqual(borgIntrekkingsUitkomst("S08", basis), {
    ...basis,
    resultaat: "mislukt",
    foutcategorie: "intrekking_niet_effectief",
    foutcode: "INTREKKING_NIET_EFFECTIEF",
  });
  assert.equal(borgIntrekkingsUitkomst("S09", { ...basis, gevondenFixtures: [] }).resultaat, "geslaagd");
  assert.equal(borgIntrekkingsUitkomst("S08R", basis).resultaat, "geslaagd");
});
