import assert from "node:assert/strict";
import test from "node:test";
import {
  MINIMAAL_COPILOT_PROFIEL,
  fataleCopilotRij,
  geplandeCopilotCalls,
  maakVergelijkMeetplan,
} from "./vergelijking-profielen";
import type { VeiligeVergelijkrij } from "./types";

test("het minimale meetprofiel kost hard maximaal vier Copilot-calls", () => {
  const plan = maakVergelijkMeetplan({ profiel: MINIMAAL_COPILOT_PROFIEL });
  assert.equal(plan.rondes, 2);
  assert.deepEqual(plan.scenarios, ["SEM01", "SEM02"]);
  assert.deepEqual(plan.armen, ["drive_search_extract", "microsoft_search", "copilot_retrieval", "candidate_union"]);
  assert.equal(plan.copilotRequestBudget, 1, "een 429 mag binnen de beslispoort geen betaalde retry starten");
  assert.equal(geplandeCopilotCalls(plan), 4);
  assert.equal(plan.maxCopilotCalls, 4);
  assert.equal(plan.stopNaCopilotFout, true);
});

test("het minimale meetprofiel kan niet via lokale JSON worden verruimd", () => {
  for (const override of [
    { rondes: 3 },
    { armen: ["copilot_retrieval"] },
    { scenarios: ["SEM01"] },
  ]) {
    assert.throws(
      () => maakVergelijkMeetplan({ profiel: MINIMAAL_COPILOT_PROFIEL, ...override }),
      /accepteert geen overrides/,
    );
  }
  assert.throws(() => maakVergelijkMeetplan({ profiel: "goedkoop-maar-ongespecificeerd" }), /onbekend vergelijkingsprofiel/);
});

test("het minimale meetprofiel stopt op echte Copilot-fouten maar meet een lege uitslag door", () => {
  const basis = {
    route: "copilot_retrieval" as const,
    resultaat: "geen_resultaten" as const,
    foutcategorie: "geen_resultaten" as const,
  };
  assert.equal(fataleCopilotRij([basis as VeiligeVergelijkrij]), null);
  const fout = { ...basis, resultaat: "mislukt" as const, foutcategorie: "toestemming_geweigerd" as const } as VeiligeVergelijkrij;
  assert.equal(fataleCopilotRij([fout]), fout);
});

test("een vrij meetplan houdt bestaand gedrag maar berekent zijn Copilot-plafond", () => {
  const plan = maakVergelijkMeetplan({
    rondes: 2,
    armen: ["drive_search_extract", "copilot_retrieval"],
    scenarios: ["S02", "SEM01"],
  });
  assert.equal(plan.profiel, null);
  assert.equal(plan.maxCopilotCalls, 4);
  assert.equal(plan.stopNaCopilotFout, false);

  const standaard = maakVergelijkMeetplan({ rondes: 2 });
  assert.deepEqual(standaard.armen, ["drive_search_extract", "microsoft_search", "copilot_retrieval", "candidate_union"]);
  assert.deepEqual(standaard.scenarios, ["S02", "S03", "S04", "S04H", "SEM01", "SEM02"]);
  assert.equal(standaard.maxCopilotCalls, 12);
});
