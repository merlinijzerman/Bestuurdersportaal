import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  borgIntrekkingsUitkomst,
  projecteerAuditAfwijzingen,
  sharePointRetrievalFixtureStatus,
  SHAREPOINT_RETRIEVAL_AUDIT_AFWIJZINGEN,
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
  assert.deepEqual(SHAREPOINT_RETRIEVAL_SMOKE_ROUTES, ["drive_search_extract", "microsoft_search", "candidate_union"]);
  assert.deepEqual(SHAREPOINT_RETRIEVAL_SMOKE_SCENARIOS, ["S00", "S02", "S03", "S04", "S04H", "S08", "S09", "S08R"]);
  assert.equal(sharePointRetrievalSmokeVraag("S00").vraag, "m365-permission-probe-7f4c1d9e-no-match");
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "tests/e2e/fixtures/pgb-sharepoint/manifest.json"), "utf8"));
  for (const scenario of ["S02", "S03", "S04", "S04H", "S08", "S09"] as const) {
    assert.equal(sharePointRetrievalSmokeVraag(scenario).vraag, manifest.scenarios.find((x: { code: string }) => x.code === scenario)?.question);
  }
  assert.deepEqual(sharePointRetrievalSmokeVraag("S02").driveZoektermen, ["Koraalmaat 47"]);
  assert.deepEqual(sharePointRetrievalSmokeVraag("S03").driveZoektermen, ["Koraalmaat 47", "IJsvogelkompas 73"]);
  assert.deepEqual(sharePointRetrievalSmokeVraag("S04").driveZoektermen, ["Maananker Actueel 61"]);
  assert.equal(sharePointRetrievalSmokeVraag("S04").actualiteitsbeleid, "alleen_actueel");
  assert.equal(sharePointRetrievalSmokeVraag("S04H").actualiteitsbeleid, "alleen_historisch");
  assert.deepEqual(sharePointRetrievalSmokeVraag("S04H").driveZoektermen, ["Maananker Historisch 61"]);
  const manifestCodes = new Set(manifest.fixtures.map((x: { code: string }) => x.code));
  for (const code of SHAREPOINT_RETRIEVAL_FIXTURE_CODES) assert.ok(manifestCodes.has(code));
  for (const code of SHAREPOINT_RETRIEVAL_FIXTURE_CODES) {
    const fixture = manifest.fixtures.find((x: { code: string; status?: string }) => x.code === code) as { status?: string } | undefined;
    const verwachteStatus = fixture?.status === "vervallen" ? "historisch" : fixture?.status;
    assert.equal(sharePointRetrievalFixtureStatus(code), verwachteStatus, `${code}: runtime-status wijkt af van manifest`);
  }
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
    exacteBronset: true,
    recall: 1,
    precision: 1,
    mrr: 1,
    ndcg: 1,
    locatorDekking: 1,
    versieDekking: 1,
    previewDekking: 1,
    latencyMs: 100,
    microsoftCalls: 3,
    downloads: 1,
    kandidatenVoorVerificatie: 1,
    responseBytes: 100,
    contentBytes: 100,
    throttles: 0,
    retries: 0,
    versieVingerafdrukken: ["123456789abc"],
    afwijzingMapping: 0,
    afwijzingBinding: 0,
    afwijzingRoot: 0,
    afwijzingRechtenConfiguratie: 0,
    afwijzingVersie: 0,
    afwijzingExtractie: 0,
    afwijzingPreview: 0,
    afwijzingActualiteit: 0,
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

test("#399: fixturestatus is uitsluitend een gesloten fixturecode-mapping", () => {
  assert.equal(sharePointRetrievalFixtureStatus("PGB354-PDF-001"), "actueel");
  assert.equal(sharePointRetrievalFixtureStatus("PGB354-PDF-002"), "historisch");
  assert.equal(sharePointRetrievalFixtureStatus("PGB354-PDF-002-Beleggingskader-vervallen.pdf"), null);
  assert.equal(sharePointRetrievalFixtureStatus("03 Historisch en vervallen"), null);
});

test("#399: auditprojectie heeft exact acht platte niet-negatieve gehele tellers", () => {
  assert.deepEqual(Object.keys(SHAREPOINT_RETRIEVAL_AUDIT_AFWIJZINGEN), [
    "afwijzing_mapping",
    "afwijzing_binding",
    "afwijzing_root",
    "afwijzing_rechten_configuratie",
    "afwijzing_versie",
    "afwijzing_extractie",
    "afwijzing_preview",
    "afwijzing_actualiteit",
  ]);
  const meting = {
    ronde: 1,
    vraagcode: "S04",
    route: "drive_search_extract" as const,
    resultaat: "geen_resultaten" as const,
    foutcategorie: "geen_resultaten",
    foutcode: null,
    gevondenFixtures: [],
    exacteBronset: false,
    recall: 0,
    precision: 1,
    mrr: 0,
    ndcg: 0,
    locatorDekking: 1,
    versieDekking: 1,
    previewDekking: 1,
    latencyMs: 1,
    microsoftCalls: 1,
    downloads: 0,
    kandidatenVoorVerificatie: 1,
    responseBytes: 1,
    contentBytes: 0,
    throttles: 0,
    retries: 0,
    versieVingerafdrukken: [],
    afwijzingMapping: 1,
    afwijzingBinding: 2,
    afwijzingRoot: 3,
    afwijzingRechtenConfiguratie: 4,
    afwijzingVersie: 5,
    afwijzingExtractie: 6,
    afwijzingPreview: 7,
    afwijzingActualiteit: 8,
  };
  assert.deepEqual(projecteerAuditAfwijzingen(meting), {
    afwijzing_mapping: 1,
    afwijzing_binding: 2,
    afwijzing_root: 3,
    afwijzing_rechten_configuratie: 4,
    afwijzing_versie: 5,
    afwijzing_extractie: 6,
    afwijzing_preview: 7,
    afwijzing_actualiteit: 8,
  });
  assert.throws(() => projecteerAuditAfwijzingen({ ...meting, afwijzingMapping: -1 }), /ongeldige_afwijstelling/);
  assert.throws(() => projecteerAuditAfwijzingen({ ...meting, afwijzingMapping: 1.5 }), /ongeldige_afwijstelling/);
});
