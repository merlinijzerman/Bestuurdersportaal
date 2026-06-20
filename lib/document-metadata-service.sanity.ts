// ============================================================
//  Sanity-tests voor de metadata-planner (Increment C).
//  Dekt: contextblokkers, ongeldige transities, redenplicht,
//  capability-gating, RAG-impact en per-veld auditrecords.
//
//  Uitvoeren: npx tsx lib/document-metadata-service.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  bouwMetadataPlan,
  type HuidigDocument,
  type GebruikerCapabilities,
} from "./document-metadata-service";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const ALLE_CAPS: GebruikerCapabilities = {
  metadataUpdate: true,
  statusChange: true,
  bronstatusChange: true,
};

function doc(overrides: Partial<HuidigDocument> = {}): HuidigDocument {
  return {
    status: "concept",
    bronstatus: "actief",
    context: "algemeen",
    procesinstantie_id: null,
    vergadering_id: null,
    agendapunt_id: null,
    documenttype: null,
    documentdatum: null,
    geldig_vanaf: null,
    geldig_tot: null,
    vervangt_document_id: null,
    vervangen_door_document_id: null,
    bronorganisatie: null,
    extern_url: null,
    normgewicht: null,
    ...overrides,
  };
}

console.log("document-metadata-service sanity-tests:");

test("context 'dossier' zonder procesinstantie levert blokker, niet ok", () => {
  const plan = bouwMetadataPlan(doc(), { context: "dossier" }, ALLE_CAPS);
  assert.equal(plan.ok, false);
  assert.ok(plan.blokkers.length >= 1);
});

test("geldige metadatawijziging zonder reden is ok (1 auditrecord)", () => {
  const plan = bouwMetadataPlan(doc(), { documenttype: "beleid" }, ALLE_CAPS);
  assert.equal(plan.ok, true);
  assert.equal(plan.wijzigingen.length, 1);
  assert.equal(plan.wijzigingen[0].veld, "documenttype");
  assert.equal(plan.ragImpact, true); // documenttype is RAG-impactveld
});

test("normgewicht buiten de enum wordt geweigerd (C+/B13)", () => {
  const plan = bouwMetadataPlan(doc(), { normgewicht: "zwaarwegend" }, ALLE_CAPS);
  assert.equal(plan.ok, false);
  assert.ok(plan.fouten.some((f) => f.includes("Ongeldig normgewicht")));
});

test("geldig normgewicht wordt geaccepteerd (beschrijvend, geen RAG-impact)", () => {
  const plan = bouwMetadataPlan(doc(), { normgewicht: "bindend" }, ALLE_CAPS);
  assert.equal(plan.ok, true);
  assert.equal(plan.wijzigingen.length, 1);
  assert.equal(plan.wijzigingen[0].veld, "normgewicht");
  assert.equal(plan.wijzigingen[0].rag_impact, false);
});

test("ongeldige statusovergang (sprong) wordt geweigerd", () => {
  const plan = bouwMetadataPlan(
    doc({ status: "concept" }),
    { status: "vastgesteld" },
    ALLE_CAPS
  );
  assert.equal(plan.ok, false);
  assert.ok(plan.fouten.some((f) => f.includes("Ongeldige statusovergang")));
});

test("vaststellen vereist een reden", () => {
  const zonder = bouwMetadataPlan(
    doc({ status: "ter_besluitvorming" }),
    { status: "vastgesteld" },
    ALLE_CAPS
  );
  assert.equal(zonder.ok, false);
  const met = bouwMetadataPlan(
    doc({ status: "ter_besluitvorming" }),
    { status: "vastgesteld", reden: "Bestuursbesluit 2026-06" },
    ALLE_CAPS
  );
  assert.equal(met.ok, true);
  assert.equal(met.wijzigingen[0].redenplicht, true);
});

test("van_kracht → vervangen vereist vervangen_door", () => {
  const zonder = bouwMetadataPlan(
    doc({ status: "van_kracht" }),
    { status: "vervangen", reden: "nieuwe versie" },
    ALLE_CAPS
  );
  assert.equal(zonder.ok, false);
  const met = bouwMetadataPlan(
    doc({ status: "van_kracht" }),
    {
      status: "vervangen",
      reden: "nieuwe versie",
      vervangen_door_document_id: "doc-2",
    },
    ALLE_CAPS
  );
  assert.equal(met.ok, true);
});

test("statuswijziging zonder capability wordt geweigerd", () => {
  const plan = bouwMetadataPlan(
    doc({ status: "concept" }),
    { status: "ter_bespreking" },
    { metadataUpdate: true, statusChange: false, bronstatusChange: false }
  );
  assert.equal(plan.ok, false);
  assert.ok(plan.fouten.some((f) => f.includes("documents.status.change")));
});

test("metadatawijziging zonder capability wordt geweigerd", () => {
  const plan = bouwMetadataPlan(
    doc(),
    { documenttype: "advies" },
    { metadataUpdate: false, statusChange: false, bronstatusChange: false }
  );
  assert.equal(plan.ok, false);
  assert.ok(plan.fouten.some((f) => f.includes("documents.metadata.update")));
});

test("bronstatus historisch → actief vereist reden + heeft RAG-impact", () => {
  const zonder = bouwMetadataPlan(
    doc({ bronstatus: "historisch" }),
    { bronstatus: "actief" },
    ALLE_CAPS
  );
  assert.equal(zonder.ok, false);
  const met = bouwMetadataPlan(
    doc({ bronstatus: "historisch" }),
    { bronstatus: "actief", reden: "weer relevant" },
    ALLE_CAPS
  );
  assert.equal(met.ok, true);
  assert.equal(met.wijzigingen[0].rag_impact, true);
});

test("governance-kritiek veld (geldig_tot) vereist reden", () => {
  const zonder = bouwMetadataPlan(doc(), { geldig_tot: "2027-01-01" }, ALLE_CAPS);
  assert.equal(zonder.ok, false);
  const met = bouwMetadataPlan(
    doc(),
    { geldig_tot: "2027-01-01", reden: "vervaldatum vastgesteld" },
    ALLE_CAPS
  );
  assert.equal(met.ok, true);
});

test("meerdere velden = meerdere auditrecords", () => {
  const plan = bouwMetadataPlan(
    doc(),
    { documenttype: "beleid", documentdatum: "2026-01-01" },
    ALLE_CAPS
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.wijzigingen.length, 2);
});

test("geen wijziging (zelfde waarde) levert geen auditrecord", () => {
  const plan = bouwMetadataPlan(
    doc({ documenttype: "beleid" }),
    { documenttype: "beleid" },
    ALLE_CAPS
  );
  assert.equal(plan.wijzigingen.length, 0);
});

console.log(`\n${n} sanity-tests geslaagd.`);
