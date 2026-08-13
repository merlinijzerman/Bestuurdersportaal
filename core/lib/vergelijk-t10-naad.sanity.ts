// ============================================================================
//  Integratietest T5 ↔ T10 op finding_key (de gevlagde integratienaad).
// ----------------------------------------------------------------------------
//  T5 schrijft comparison_results.finding_key; T10 hangt difference_judgements.
//  finding_key aan dezelfde bevinding. De JOIN werkt alleen als beide kanten exact
//  dezelfde sleutel produceren. Deze test simuleert die naad: de sleutel die de
//  vergelijk-service (T5) uit een finding haalt, moet identiek zijn aan de sleutel
//  die T10 mint voor het oordeel over diezelfde finding — en verschillend zodra de
//  logische bevinding verschilt (ander document, andere dimensie/concept).
//
//  Uitvoeren: npx tsx core/lib/vergelijk-t10-naad.sanity.ts  (of npm run sanity)
// ============================================================================

import assert from "node:assert/strict";
import { mintFindingKey } from "./vergelijk-findingkey";
import { voerVergelijkingUit, type SemanticUnitLite, type VergelijkDeps } from "./vergelijk-kern";
import type { Finding } from "./vergelijk-types";

let n = 0;
const asyncTests: { naam: string; fn: () => Promise<void> }[] = [];
function testAsync(naam: string, fn: () => Promise<void>) {
  asyncTests.push({ naam, fn });
}

function unit(concept_id: string, over: Partial<SemanticUnitLite>): SemanticUnitLite {
  return {
    concept_id, type: "percentage", value_num: null, value_date: null, value_text: null,
    value_raw: "", value_unit: null, page: null, evidence: "bron", ...over,
  };
}

// T5-productie mint de finding_key in de kern; hier draaien we de kern met fakes en
// nemen de finding_key die T5 zou wegschrijven.
async function findingUitT5(): Promise<Finding> {
  const deps: VergelijkDeps = {
    leesConcepten: async () => [
      { id: "c-boven", key: "solidariteitsreserve.bovengrens", label: "Bovengrens", type: "percentage", status: "actief" },
    ],
    leesSemanticUnits: async (id) =>
      id === "doc-v3"
        ? [unit("c-boven", { value_num: 0.075, value_raw: "7,5%", page: 37 })]
        : [unit("c-boven", { value_num: 0.06, value_raw: "6,0%", page: 37 })],
    bepaalExtraDimensies: async () => [],
    retrieveerPassages: async () => [],
    vergelijkWaardeLLM: async () => ({
      bron_value: null, bron_evidence: null, bron_page: null,
      doel_value: null, doel_evidence: null, doel_page: null, gelijk: false,
    }),
    persisteer: async () => "run-1",
    deterministischVertrouwd: true,
  };
  const r = await voerVergelijkingUit(
    { mode: "symmetrisch", bronDocumentId: "doc-v3", doelDocumentId: "doc-v4", versies: { model: "opus", promptVersion: "p", comparatorVersion: "c" } },
    deps
  );
  const f = r.findings.find((x) => x.dimensie === "solidariteitsreserve.bovengrens");
  assert.ok(f, "T5 leverde geen bovengrens-finding");
  return f!;
}

// T10 mint de sleutel voor een oordeel over dezelfde bevinding uit de context die het
// dan heeft (mode + de twee document-ids + concept_id/dimensie).
function findingKeyBijT10(over: { bron: string; doel: string; conceptId?: string | null; dimensie: string }): string {
  return mintFindingKey({
    mode: "symmetrisch",
    bronDocumentId: over.bron,
    doelDocumentId: over.doel,
    conceptId: over.conceptId ?? null,
    dimensie: over.dimensie,
  });
}

testAsync("T5-finding_key == T10-finding_key voor dezelfde bevinding (JOIN werkt)", async () => {
  const f = await findingUitT5();
  const t10 = findingKeyBijT10({ bron: "doc-v3", doel: "doc-v4", conceptId: "c-boven", dimensie: "solidariteitsreserve.bovengrens" });
  assert.equal(f.finding_key, t10);
});

testAsync("andere doelbron → andere finding_key (geen valse JOIN)", async () => {
  const f = await findingUitT5();
  const ander = findingKeyBijT10({ bron: "doc-v3", doel: "doc-v5", conceptId: "c-boven", dimensie: "solidariteitsreserve.bovengrens" });
  assert.notEqual(f.finding_key, ander);
});

testAsync("ander concept → andere finding_key", async () => {
  const f = await findingUitT5();
  const ander = findingKeyBijT10({ bron: "doc-v3", doel: "doc-v4", conceptId: "c-franchise", dimensie: "franchise" });
  assert.notEqual(f.finding_key, ander);
});

(async () => {
  for (const t of asyncTests) {
    await t.fn();
    n++;
    console.log(`  ✓ ${t.naam}`);
  }
  console.log(`\nvergelijk-t10-naad.sanity: ${n} tests groen.`);
})().catch((e) => {
  console.error("vergelijk-t10-naad.sanity ROOD:", e);
  process.exit(1);
});
