// ============================================================================
//  Sanity-tests voor de pure vergelijk-orchestratie (T5).
// ----------------------------------------------------------------------------
//  Borgt de kernbeslissingen programmatisch met injecteerbare fakes (geen DB/SDK):
//   • deterministisch-vs-LLM-routing + de vertrouwens-poort (self-gating);
//   • verschil_type_ruw (gelijk/verschilt/alleen_bron/alleen_doel);
//   • geen finding wanneer geen enkele zijde een waarde heeft;
//   • dimensie-samenstelling (catalogus + llm + aangevuld, dedup);
//   • stabiele, koppelbare finding_key (via mintFindingKey).
//
//  Uitvoeren: npx tsx core/lib/vergelijk-kern.sanity.ts  (of npm run sanity)
// ============================================================================

import assert from "node:assert/strict";
import {
  bepaalVerschilTypeRuw,
  bouwCatalogusDimensies,
  dedupDimensies,
  deterministischeVergelijking,
  voerVergelijkingUit,
  type ConceptLite,
  type LLMVergelijkUitkomst,
  type SemanticUnitLite,
  type VergelijkDeps,
  type VergelijkParams,
} from "./vergelijk-kern";
import { mintFindingKey } from "./vergelijk-findingkey";

let n = 0;
function test(naam: string, fn: () => void | Promise<void>) {
  const r = fn();
  if (r instanceof Promise) {
    // De runner is sync; we await via .then in een micro-harnas.
    throw new Error(`test '${naam}' is async — gebruik testAsync`);
  }
  n++;
  console.log(`  ✓ ${naam}`);
}
const asyncTests: { naam: string; fn: () => Promise<void> }[] = [];
function testAsync(naam: string, fn: () => Promise<void>) {
  asyncTests.push({ naam, fn });
}

// ── Fixtures ────────────────────────────────────────────────────────────────
const CONCEPTEN: ConceptLite[] = [
  { id: "c-boven", key: "solidariteitsreserve.bovengrens", label: "Bovengrens", type: "percentage", status: "actief" },
  { id: "c-franchise", key: "franchise", label: "Franchise", type: "amount", status: "actief" },
  { id: "c-transitie", key: "transitiedatum", label: "Transitiedatum", type: "date", status: "uitgesteld" },
];

function unit(concept_id: string, over: Partial<SemanticUnitLite>): SemanticUnitLite {
  return {
    concept_id,
    type: "percentage",
    value_num: null,
    value_date: null,
    value_text: null,
    value_raw: "",
    value_unit: null,
    page: null,
    evidence: "bron",
    ...over,
  };
}

const VERSIES = { model: "opus", promptVersion: "pv1", comparatorVersion: "cmp1" };
const PARAMS: VergelijkParams = {
  mode: "symmetrisch",
  bronDocumentId: "doc-v3",
  doelDocumentId: "doc-v4",
  versies: VERSIES,
};

// Basis-deps: geen semantic_units, geen extra dimensies, LLM geeft niets terug,
// persisteren geeft een vaste run-id. Tests overschrijven wat ze nodig hebben.
function baseDeps(over: Partial<VergelijkDeps> = {}): VergelijkDeps {
  return {
    leesConcepten: async () => CONCEPTEN,
    leesSemanticUnits: async () => [],
    bepaalExtraDimensies: async () => [],
    retrieveerPassages: async () => [],
    vergelijkWaardeLLM: async (): Promise<LLMVergelijkUitkomst> => ({
      bron_value: null, bron_evidence: null, bron_page: null,
      doel_value: null, doel_evidence: null, doel_page: null, gelijk: false,
    }),
    persisteer: async () => "run-1",
    deterministischVertrouwd: false,
    ...over,
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────
test("bepaalVerschilTypeRuw: alle vier de uitkomsten", () => {
  assert.equal(bepaalVerschilTypeRuw(true, true, true), "gelijk");
  assert.equal(bepaalVerschilTypeRuw(true, true, false), "verschilt");
  assert.equal(bepaalVerschilTypeRuw(true, false, false), "alleen_bron");
  assert.equal(bepaalVerschilTypeRuw(false, true, false), "alleen_doel");
});

test("bouwCatalogusDimensies: 'uitgesteld' valt weg, actieve blijven", () => {
  const dims = bouwCatalogusDimensies(CONCEPTEN);
  assert.deepEqual(dims.map((d) => d.key).sort(), ["franchise", "solidariteitsreserve.bovengrens"]);
  assert.equal(dims.every((d) => d.herkomst === "catalogus"), true);
});

test("dedupDimensies: eerste voorkomen wint, case-insensitief", () => {
  const dims = dedupDimensies([
    { key: "franchise", label: "A", herkomst: "catalogus" },
    { key: "Franchise", label: "B", herkomst: "llm" },
  ]);
  assert.equal(dims.length, 1);
  assert.equal(dims[0].label, "A");
});

test("deterministischeVergelijking: percentage gelijk/ongelijk", () => {
  const g = deterministischeVergelijking(unit("c", { value_num: 0.06 }), unit("c", { value_num: 0.06 }), "percentage");
  assert.equal(g.gelijk, true);
  const o = deterministischeVergelijking(unit("c", { value_num: 0.075 }), unit("c", { value_num: 0.06 }), "percentage");
  assert.equal(o.gelijk, false);
  assert.equal(o.bronNorm, "0.075");
});

test("deterministischeVergelijking: datum + policy_choice", () => {
  const d = deterministischeVergelijking(
    unit("c", { value_date: "2027-01-01" }), unit("c", { value_date: "2028-01-01" }), "date");
  assert.equal(d.gelijk, false);
  const p = deterministischeVergelijking(
    unit("c", { value_text: "Standaard" }), unit("c", { value_text: "standaard" }), "policy_choice");
  assert.equal(p.gelijk, true); // trim+lowercase
});

// ── Orchestratie (async) ─────────────────────────────────────────────────────

testAsync("deterministisch pad vuurt alleen als de poort open is (self-gating)", async () => {
  const units = {
    "doc-v3": [unit("c-boven", { type: "percentage", value_num: 0.075, value_raw: "7,5%", page: 37 })],
    "doc-v4": [unit("c-boven", { type: "percentage", value_num: 0.06, value_raw: "6,0%", page: 37 })],
  } as Record<string, SemanticUnitLite[]>;

  // Poort DICHT → ondanks units aan beide zijden valt het terug op LLM.
  const dicht = await voerVergelijkingUit(
    PARAMS,
    baseDeps({
      leesSemanticUnits: async (id) => units[id] ?? [],
      deterministischVertrouwd: false,
      vergelijkWaardeLLM: async () => ({
        bron_value: "7,5%", bron_evidence: "…7,5%", bron_page: 37,
        doel_value: "6,0%", doel_evidence: "…6,0%", doel_page: 37, gelijk: false,
      }),
    })
  );
  const bovenDicht = dicht.findings.find((f) => f.dimensie === "solidariteitsreserve.bovengrens");
  assert.equal(bovenDicht?.method, "llm");

  // Poort OPEN → deterministisch, verschilt, genormaliseerde waarden.
  const open = await voerVergelijkingUit(
    PARAMS,
    baseDeps({ leesSemanticUnits: async (id) => units[id] ?? [], deterministischVertrouwd: true })
  );
  const bovenOpen = open.findings.find((f) => f.dimensie === "solidariteitsreserve.bovengrens");
  assert.equal(bovenOpen?.method, "deterministisch");
  assert.equal(bovenOpen?.verschil_type_ruw, "verschilt");
  assert.equal(bovenOpen?.bron.value_normalized, "0.075");
  assert.equal(bovenOpen?.doel.value_normalized, "0.06");
});

testAsync("één zijde een unit → LLM-pad (niet 'beide zijden'), alleen_bron mogelijk", async () => {
  const units = {
    "doc-v3": [unit("c-boven", { type: "percentage", value_num: 0.06, value_raw: "6,0%" })],
    "doc-v4": [],
  } as Record<string, SemanticUnitLite[]>;
  const r = await voerVergelijkingUit(
    PARAMS,
    baseDeps({
      leesSemanticUnits: async (id) => units[id] ?? [],
      deterministischVertrouwd: true, // poort open, maar doel mist de unit
      vergelijkWaardeLLM: async ({ dimensie }) =>
        dimensie.key === "solidariteitsreserve.bovengrens"
          ? { bron_value: "6,0%", bron_evidence: "…6,0%", bron_page: 1, doel_value: null, doel_evidence: null, doel_page: null, gelijk: false }
          : { bron_value: null, bron_evidence: null, bron_page: null, doel_value: null, doel_evidence: null, doel_page: null, gelijk: false },
    })
  );
  const boven = r.findings.find((f) => f.dimensie === "solidariteitsreserve.bovengrens");
  assert.equal(boven?.method, "llm");
  assert.equal(boven?.verschil_type_ruw, "alleen_bron");
});

testAsync("geen enkele zijde een waarde → geen finding", async () => {
  const r = await voerVergelijkingUit(PARAMS, baseDeps());
  assert.equal(r.findings.length, 0);
  // Dimensies zijn wél gerapporteerd (reikwijdte), ook zonder findings.
  assert.equal(r.dimensies.length >= 2, true);
});

testAsync("finding_key koppelt op mintFindingKey (T5↔T10-naad)", async () => {
  const units = {
    "doc-v3": [unit("c-franchise", { type: "amount", value_num: 17545, value_raw: "17.545" })],
    "doc-v4": [unit("c-franchise", { type: "amount", value_num: 17545, value_raw: "17.545" })],
  } as Record<string, SemanticUnitLite[]>;
  const r = await voerVergelijkingUit(
    PARAMS,
    baseDeps({ leesSemanticUnits: async (id) => units[id] ?? [], deterministischVertrouwd: true })
  );
  const fr = r.findings.find((f) => f.dimensie === "franchise");
  assert.equal(fr?.verschil_type_ruw, "gelijk");
  assert.equal(
    fr?.finding_key,
    mintFindingKey({ mode: "symmetrisch", bronDocumentId: "doc-v3", doelDocumentId: "doc-v4", conceptId: "c-franchise", dimensie: "franchise" })
  );
});

testAsync("aangevulde + LLM-dimensies verschijnen in de reikwijdte", async () => {
  const r = await voerVergelijkingUit(
    { ...PARAMS, extraDimensies: ["indexatieambitie"] },
    baseDeps({
      bepaalExtraDimensies: async () => [{ key: "premiedekkingsgraad", label: "Premiedekkingsgraad", herkomst: "llm" }],
    })
  );
  const keys = r.dimensies.map((d) => d.key);
  assert.equal(keys.includes("indexatieambitie"), true);
  assert.equal(keys.includes("premiedekkingsgraad"), true);
  assert.equal(r.dimensies.find((d) => d.key === "indexatieambitie")?.herkomst, "aangevuld");
});

testAsync("persisteer krijgt de findings en de run-id komt terug", async () => {
  let ontvangen = -1;
  const r = await voerVergelijkingUit(
    PARAMS,
    baseDeps({
      bepaalExtraDimensies: async () => [{ key: "x", label: "X", herkomst: "llm" }],
      vergelijkWaardeLLM: async () => ({
        bron_value: "a", bron_evidence: "e", bron_page: 1,
        doel_value: "b", doel_evidence: "e", doel_page: 1, gelijk: false,
      }),
      persisteer: async (inv) => { ontvangen = inv.findings.length; return "run-42"; },
    })
  );
  assert.equal(r.comparison_run_id, "run-42");
  assert.equal(ontvangen, r.findings.length);
  assert.equal(r.findings.length >= 1, true);
});

// ── Async runner ─────────────────────────────────────────────────────────────
(async () => {
  for (const t of asyncTests) {
    await t.fn();
    n++;
    console.log(`  ✓ ${t.naam}`);
  }
  console.log(`\nvergelijk-kern.sanity: ${n} tests groen.`);
})().catch((e) => {
  console.error("vergelijk-kern.sanity ROOD:", e);
  process.exit(1);
});
