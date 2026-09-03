// ============================================================================
//  Sanity-tests op de contextlaag van de assistent (P1a C4, besluit 0201).
// ============================================================================

import assert from "node:assert/strict";
import { bepaalContextSoort, contextChipLabel, leesScope, leesAgendapuntContext } from "./assistent-context";

let n = 0;
const check = (naam: string, fn: () => void) => {
  fn();
  n += 1;
  console.log(`  ✓ ${naam}`);
};

console.log("assistent-context sanity-tests:");

const LEEG = { documentScope: null, agendapuntContext: null, moduleScope: null };
const DOC = { document_ids: ["d1"], titels: ["ABTN"] };

// ── De afgeleide soort ──────────────────────────────────────────────────────

check("zonder scope is de context fondsbreed", () => {
  assert.equal(bepaalContextSoort(LEEG), "fondsbreed");
  assert.equal(contextChipLabel(LEEG), null);
});

check("de precedentie is agendapunt → module → document", () => {
  // Een agendapunt draagt zijn stukken als documentscope: dan is het nog steeds
  // een agendapuntgesprek. En een module-scope wint van een losse documentscope,
  // gelijk aan de server, die bij een module-scope de intent-heuristiek uitzet.
  assert.equal(
    bepaalContextSoort({
      documentScope: DOC,
      agendapuntContext: { id: "a1", titel: "Jaarrekening" },
      moduleScope: { soort: "proces", procedure_id: "p1", label: "Invaren" },
    }),
    "agendapunt"
  );
  assert.equal(
    bepaalContextSoort({
      documentScope: DOC,
      agendapuntContext: null,
      moduleScope: { soort: "proces", procedure_id: "p1", label: "Invaren" },
    }),
    "proces"
  );
  assert.equal(
    bepaalContextSoort({ ...LEEG, documentScope: DOC }),
    "document"
  );
});

check("risicomatrix en risico zijn ECHT verschillende soorten", () => {
  // Zij zijn de reden dat het er zes zijn en niet vijf: alleen bij één risico
  // bestaat de chip "← hele risicomatrix" (besluit 0151).
  assert.equal(
    bepaalContextSoort({ ...LEEG, moduleScope: { soort: "risicomatrix", label: "de risicomatrix" } }),
    "risicomatrix"
  );
  assert.equal(
    bepaalContextSoort({ ...LEEG, moduleScope: { soort: "risico", risico_id: "r1", label: "Renterisico" } }),
    "risico"
  );
});

// ── Het chiplabel — op de letter, zoals /ai het vandaag toont ───────────────

check("chiplabels zijn woordelijk gelijk aan de huidige weergave", () => {
  assert.equal(
    contextChipLabel({ ...LEEG, moduleScope: { soort: "proces", procedure_id: "p1", label: "Invaren" } }),
    "Proces: «Invaren»"
  );
  assert.equal(
    contextChipLabel({ ...LEEG, moduleScope: { soort: "risico", risico_id: "r1", label: "Renterisico" } }),
    "Risico: «Renterisico»"
  );
  assert.equal(
    contextChipLabel({ ...LEEG, moduleScope: { soort: "risicomatrix", label: "de risicomatrix" } }),
    "Risicomatrix"
  );
  assert.equal(contextChipLabel({ ...LEEG, documentScope: DOC }), "Onderwerp: «ABTN»");
  assert.equal(
    contextChipLabel({
      ...LEEG,
      documentScope: { document_ids: ["d1", "d2", "d3"], titels: ["ABTN", "b", "c"] },
    }),
    "Onderwerp: «ABTN» +2"
  );
  assert.equal(
    contextChipLabel({ ...LEEG, documentScope: { document_ids: ["d1"], titels: [] } }),
    "Onderwerp: «dit document»"
  );
});

check("de agendapuntchip telt de stukken, enkelvoud en meervoud", () => {
  const ap = { id: "a1", titel: "Vaststellen jaarrekening" };
  assert.equal(
    contextChipLabel({ ...LEEG, agendapuntContext: ap }),
    "Agendapunt: «Vaststellen jaarrekening» · geen stukken"
  );
  assert.equal(
    contextChipLabel({ ...LEEG, agendapuntContext: ap, documentScope: DOC }),
    "Agendapunt: «Vaststellen jaarrekening» · 1 stuk"
  );
  assert.equal(
    contextChipLabel({
      ...LEEG,
      agendapuntContext: ap,
      documentScope: { document_ids: ["d1", "d2"], titels: ["a", "b"] },
    }),
    "Agendapunt: «Vaststellen jaarrekening» · 2 stukken"
  );
});

// ── Teruglezen uit een opgeslagen gesprek ───────────────────────────────────

check("leesScope negeert onzin en een scope zonder ids", () => {
  assert.equal(leesScope(null), null);
  assert.equal(leesScope("tekst"), null);
  assert.equal(leesScope({ document_ids: [] }), null);
  assert.equal(leesScope({ titels: ["a"] }), null);
  assert.deepEqual(leesScope({ document_ids: ["d1", 7], titels: ["ABTN", null] }), {
    document_ids: ["d1"],
    titels: ["ABTN"],
    algemene_kennis: false,
  });
  assert.equal(
    leesScope({ document_ids: ["d1"], algemene_kennis: true })?.algemene_kennis,
    true
  );
});

check("leesAgendapuntContext vereist een id en valt terug op een nette titel", () => {
  assert.equal(leesAgendapuntContext(null), null);
  assert.equal(leesAgendapuntContext({}), null);
  assert.equal(leesAgendapuntContext({ agendapunt_context: { titel: "x" } }), null);
  assert.deepEqual(leesAgendapuntContext({ agendapunt_context: { id: "a1" } }), {
    id: "a1",
    titel: "dit agendapunt",
  });
  assert.deepEqual(
    leesAgendapuntContext({ agendapunt_context: { id: "a1", titel: "Rondvraag" } }),
    { id: "a1", titel: "Rondvraag" }
  );
});

console.log(`\n${n} sanity-tests geslaagd.`);
