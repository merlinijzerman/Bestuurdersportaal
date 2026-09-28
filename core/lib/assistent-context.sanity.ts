// ============================================================================
//  Sanity-tests op de contextlaag van de assistent (P1a C4, besluit 0201).
// ============================================================================

import assert from "node:assert/strict";
import {
  bepaalContextSoort,
  contextChip,
  contextChipLabels,
  leesScope,
  leesAgendapuntContext,
  leesSharePointScope,
} from "./assistent-context";

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
  assert.deepEqual(contextChipLabels(LEEG), []);
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

check("een live SharePoint-document heeft een eigen contextsoort", () => {
  assert.equal(
    bepaalContextSoort({
      ...LEEG,
      sharepointScope: {
        soort: "document",
        refs: ["7d5ef460-162e-4c34-a1bc-287337cbdf09"],
        labels: ["Bestuursverslag.docx"],
      },
    }),
    "sharepoint_document"
  );
  assert.equal(
    bepaalContextSoort({
      ...LEEG,
      sharepointScope: {
        soort: "map",
        refs: ["7d5ef460-162e-4c34-a1bc-287337cbdf09"],
        labels: ["Bestuur"],
      },
    }),
    "sharepoint_map"
  );
});

// ── Het chiplabel — op de letter, zoals /ai het vandaag toont ───────────────

check("chiplabels zijn woordelijk gelijk aan de huidige weergave", () => {
  const chip = (v: Parameters<typeof contextChipLabels>[0]) => contextChipLabels(v);
  assert.deepEqual(
    chip({ ...LEEG, moduleScope: { soort: "proces", procedure_id: "p1", label: "Invaren" } }),
    ["Proces: «Invaren»"]
  );
  assert.deepEqual(
    chip({ ...LEEG, moduleScope: { soort: "risico", risico_id: "r1", label: "Renterisico" } }),
    ["Risico: «Renterisico»"]
  );
  assert.deepEqual(
    chip({ ...LEEG, moduleScope: { soort: "risicomatrix", label: "de risicomatrix" } }),
    ["Risicomatrix"]
  );
  assert.deepEqual(chip({ ...LEEG, documentScope: DOC }), ["Onderwerp: «ABTN»"]);
  assert.deepEqual(
    chip({
      ...LEEG,
      documentScope: { document_ids: ["d1", "d2", "d3"], titels: ["ABTN", "b", "c"] },
    }),
    ["Onderwerp: «ABTN» +2"]
  );
  assert.deepEqual(
    chip({ ...LEEG, documentScope: { document_ids: ["d1"], titels: [] } }),
    ["Onderwerp: «dit document»"]
  );
});

check("de agendapuntchip telt de stukken, enkelvoud en meervoud", () => {
  const ap = { id: "a1", titel: "Vaststellen jaarrekening" };
  assert.deepEqual(contextChipLabels({ ...LEEG, agendapuntContext: ap }), [
    "Agendapunt: «Vaststellen jaarrekening» · geen stukken",
  ]);
  assert.deepEqual(
    contextChipLabels({ ...LEEG, agendapuntContext: ap, documentScope: DOC }),
    ["Agendapunt: «Vaststellen jaarrekening» · 1 stuk"]
  );
  assert.deepEqual(
    contextChipLabels({
      ...LEEG,
      agendapuntContext: ap,
      documentScope: { document_ids: ["d1", "d2"], titels: ["a", "b"] },
    }),
    ["Agendapunt: «Vaststellen jaarrekening» · 2 stukken"]
  );
});

check("een SAMENGESTELDE context levert twee chips, zoals /ai vandaag toont", () => {
  // De module-chip in de weergave heeft géén `!agendapuntContext`-guard; de
  // documentchip wél. Eén enkel label zou hier de actieve documentscope
  // verzwijgen — precies de chip die moet zeggen waarop geantwoord wordt.
  // Bestaand gedrag, geen ontwerpkeuze: P1b beslist wat het paneel hiermee doet.
  assert.deepEqual(
    contextChipLabels({
      documentScope: DOC,
      agendapuntContext: null,
      moduleScope: { soort: "proces", procedure_id: "p1", label: "Invaren" },
    }),
    ["Proces: «Invaren»", "Onderwerp: «ABTN»"]
  );
  assert.deepEqual(
    contextChipLabels({
      documentScope: DOC,
      agendapuntContext: { id: "a1", titel: "Jaarrekening" },
      moduleScope: { soort: "risicomatrix", label: "de risicomatrix" },
    }),
    ["Risicomatrix", "Agendapunt: «Jaarrekening» · 1 stuk"]
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

check("leesSharePointScope herstelt alleen één lokale UUID-ref en nooit een label", () => {
  assert.equal(leesSharePointScope(null), null);
  assert.equal(leesSharePointScope({ sharepoint_scope: { soort: "document", refs: [] } }), null);
  assert.equal(
    leesSharePointScope({
      sharepoint_scope: { soort: "document", refs: ["geen-uuid"], labels: ["geheim.docx"] },
    }),
    null
  );
  assert.deepEqual(
    leesSharePointScope({
      sharepoint_scope: {
        soort: "document",
        refs: ["7D5EF460-162E-4C34-A1BC-287337CBDF09"],
        labels: ["geheim.docx"],
      },
    }),
    {
      soort: "document",
      refs: ["7d5ef460-162e-4c34-a1bc-287337cbdf09"],
      labels: [],
    }
  );
  assert.deepEqual(
    leesSharePointScope({
      sharepoint_scope: {
        soort: "map",
        refs: ["7D5EF460-162E-4C34-A1BC-287337CBDF09"],
      },
    }),
    {
      soort: "map",
      refs: ["7d5ef460-162e-4c34-a1bc-287337cbdf09"],
      labels: [],
    }
  );
});

// ── De ENE contextchip van het paneel (T1, besluit 0204) ────────────────────

check("fondsbreed is geen scope en heeft dus niets om los te laten", () => {
  const chip = contextChip(LEEG);
  assert.equal(chip.label, "Fondsbreed");
  assert.equal(chip.losTeLaten, false);
});

check("het label volgt dezelfde precedentie als bepaalContextSoort", () => {
  const alles = {
    documentScope: DOC,
    agendapuntContext: { id: "a1", titel: "Jaarrekening" },
    moduleScope: { soort: "proces" as const, procedure_id: "p1", label: "Invaren" },
  };
  assert.equal(contextChip(alles).label, "Agendapunt · «Jaarrekening»");
  assert.equal(
    contextChip({ ...alles, agendapuntContext: null }).label,
    "Proces · «Invaren»"
  );
  assert.equal(
    contextChip({ ...alles, agendapuntContext: null, moduleScope: null }).label,
    "Document · «ABTN»"
  );
});

check("een tweede scope wordt NIET verzwegen maar staat in het bronbereik", () => {
  // Dit is het hele punt van de indikking tot één chip: het label toont de
  // meest specifieke context, maar een documentscope die óók meegaat blijft
  // zichtbaar. Anders leest de bestuurder één scope en krijgt hij een antwoord
  // uit twee.
  const chip = contextChip({
    documentScope: { document_ids: ["d1", "d2"], titels: ["ABTN", "Jaarplan"] },
    agendapuntContext: null,
    moduleScope: { soort: "risicomatrix", label: "de risicomatrix" },
  });
  assert.equal(chip.label, "Risicomatrix");
  assert.match(chip.bronbereik, /daarnaast 2 stukken/);
});

check("een agendapunt zonder stukken zegt dát ook", () => {
  const chip = contextChip({
    documentScope: null,
    agendapuntContext: { id: "a1", titel: "Rondvraag" },
    moduleScope: null,
  });
  assert.match(chip.bronbereik, /geen gekoppelde stukken/);
});

check("de documentchip telt de rest mee in het label", () => {
  const chip = contextChip({
    documentScope: { document_ids: ["d1", "d2", "d3"], titels: ["ABTN"] },
    agendapuntContext: null,
    moduleScope: null,
  });
  assert.match(chip.label, /\+2$/);
  assert.equal(chip.bronbereik, "alleen 3 stukken");
});

check("de SharePoint-chip toont alleen het live opgeloste label", () => {
  const chip = contextChip({
    ...LEEG,
    sharepointScope: {
      soort: "document",
      refs: ["7d5ef460-162e-4c34-a1bc-287337cbdf09"],
      labels: ["Bestuursverslag.docx"],
    },
  });
  assert.equal(chip.label, "SharePoint-document · «Bestuursverslag.docx»");
  assert.match(chip.bronbereik, /live gecontroleerde SharePoint-document/);
  assert.equal(chip.losTeLaten, true);
});


console.log(`\n${n} sanity-tests geslaagd.`);
