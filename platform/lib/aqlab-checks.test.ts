// ============================================================
//  Sanity-tests voor de AQLab evaluatie-pijplijn (AQL-2).
//
//  Toetst de risicovolle scoringslogica puur (geen DB/model):
//   - deterministische/heuristische auto-checks (lib/aqlab/checks/*)
//   - de blokkade-gate + kritieke-finding-regel (evaluation-engine)
//   - quality_score STRIKT gescheiden van gate_status + dimensievloeren
//   - judge ADVISEREND (nooit auto-blokkade) + JSON-schema-validatie
//
//  Vitest-suite met node:assert voor bestaande assertionpariteit.
//  Uitvoeren: npx vitest run platform/lib/aqlab-checks.test.ts
// ============================================================

import assert from "node:assert/strict";
import { test } from "vitest";
import {
  exactNumericFactMatch,
  forbiddenPhraseAbsent,
  requiredSectionPresent,
  excludedSourceNotLeaked,
  herkomstlabelScheiding,
  bronMarkerAanwezig,
  sourceIdExists,
} from "./aqlab/checks/auto-checks";
import type { CheckInput, TestcaseSpec } from "./aqlab/checks/types";
import { evalueerOutput } from "./aqlab/evaluation-engine";
import {
  normaliseerJudgeOutput,
  type JudgeCriterium,
  type JudgeResultaat,
} from "./aqlab/judge";

function input(antwoord: string, bronnenAantal: number, spec: TestcaseSpec, snapshotRefs?: string[]): CheckInput {
  return { antwoord, bronnenAantal, spec, snapshotRefs };
}

console.log("AQLab evaluatie-pijplijn sanity-tests:");

// ── Auto-checks ─────────────────────────────────────────────────────────────
test("exactNumericFactMatch: alle cijfers aanwezig → pass", () => {
  const spec: TestcaseSpec = { expected_answer_outline: { exact_facts: ["beleidsdekkingsgraad 112,4%", "premie 28,6%"] } };
  const r = exactNumericFactMatch(input("De beleidsdekkingsgraad is 112,4% en de premie wordt 28,6%.", 1, spec));
  assert.equal(r.pass, true);
  assert.equal(r.score, 100);
});

test("exactNumericFactMatch: verkeerd cijfer → fail + hallucinatie-finding", () => {
  const spec: TestcaseSpec = { expected_answer_outline: { exact_facts: ["beleidsdekkingsgraad 112,4%"] } };
  const r = exactNumericFactMatch(input("De beleidsdekkingsgraad is 99,9%.", 1, spec));
  assert.equal(r.pass, false);
  assert.equal(r.findings[0].type, "hallucinatie");
});

test("forbiddenPhraseAbsent: verboden claim aanwezig → fail", () => {
  const spec: TestcaseSpec = { forbidden_claims: ["besluit reeds genomen"] };
  const ok = forbiddenPhraseAbsent(input("Het bestuur moet dit nog wegen.", 1, spec));
  assert.equal(ok.pass, true);
  const fout = forbiddenPhraseAbsent(input("Het besluit reeds genomen door het bestuur.", 1, spec));
  assert.equal(fout.pass, false);
});

test("requiredSectionPresent: ontbrekende sectie → fail + format-finding", () => {
  const spec: TestcaseSpec = { required_sections: ["aanleiding", "voorstel"] };
  const r = requiredSectionPresent(input("Aanleiding: de dekkingsgraad daalt.", 1, spec));
  assert.equal(r.pass, false);
  assert.equal(r.findings[0].type, "format");
});

test("excludedSourceNotLeaked: uitgesloten ID gelekt → kritieke autorisatie-finding", () => {
  const spec: TestcaseSpec = { excluded_source_ids: ["HORIZON-GEHEIM-009"] };
  const r = excludedSourceNotLeaked(input("Zie HORIZON-GEHEIM-009 voor details.", 1, spec));
  assert.equal(r.pass, false);
  assert.equal(r.findings[0].ernst, "kritiek");
  assert.equal(r.findings[0].type, "autorisatie");
});

test("herkomstlabelScheiding / sourceIdExists: dangling [Bron] → kritieke finding", () => {
  const spec: TestcaseSpec = {};
  const scheiding = herkomstlabelScheiding(input("Dit blijkt uit [Bron 5].", 2, spec));
  assert.equal(scheiding.pass, false);
  assert.equal(scheiding.findings[0].ernst, "kritiek");
  const idcheck = sourceIdExists(input("Dit blijkt uit [Bron 5].", 2, spec));
  assert.equal(idcheck.pass, false);
});

test("bronMarkerAanwezig: bronnen aanwezig maar geen marker → fail (heuristisch)", () => {
  const r = bronMarkerAanwezig(input("Een antwoord zonder enige bronverwijzing.", 3, {}));
  assert.equal(r.pass, false);
  assert.equal(r.methode, "heuristisch");
});

// ── Judge-JSON-schema-validatie (puur) ──────────────────────────────────────
test("normaliseerJudgeOutput: geldige score-variant", () => {
  const r = normaliseerJudgeOutput("claim_matches_source_semantic", {
    score_0_100: 88, motivation: "Sluit aan op de bron.", evidence: "112,4%",
  });
  assert.equal(r.score, 88);
  assert.equal(r.pass, true);
  assert.equal(r.methode, "llm_judge");
  assert.equal(r.judge_model, "claude-opus-4-8");
});

test("normaliseerJudgeOutput: boolean-variant no_forbidden_claim", () => {
  const r = normaliseerJudgeOutput("no_forbidden_claim", { pass: false, violated: ["verzonnen cijfer 42%"] });
  assert.equal(r.pass, false);
  assert.equal(r.score, null);
  assert.deepEqual(r.bewijs, ["verzonnen cijfer 42%"]);
});

test("normaliseerJudgeOutput: ongeldig/ontbrekend schema → onbetrouwbaar (geen schijnzekerheid)", () => {
  const leeg = normaliseerJudgeOutput("risk_duiding_correct", null);
  assert.equal(leeg.onbetrouwbaar, true);
  assert.equal(leeg.pass, false);
  const kapot = normaliseerJudgeOutput("risk_duiding_correct", { motivation: "x" }); // score ontbreekt
  assert.equal(kapot.onbetrouwbaar, true);
});

// ── Engine: gate / quality / floors / judge-advies ──────────────────────────
const baseInput = {
  vraag: "Wat is de dekkingsgraad?",
  bronContext: "[Bron 1] De beleidsdekkingsgraad is 112,4%.",
  bronnenAantal: 1,
  reviewVerplicht: false,
};

test("engine: schone deterministische output → gate pass, quality hoog", async () => {
  const spec: TestcaseSpec = {
    expected_answer_outline: { exact_facts: ["112,4%"] },
    required_sections: ["aanleiding"],
    min_quality_score: 80,
  };
  const r = await evalueerOutput({
    ...baseInput,
    antwoord: "Aanleiding: de beleidsdekkingsgraad is 112,4% [Bron 1].",
    spec,
    criteria: ["exact_numeric_fact_match", "required_section_present", "source_label_present"],
  });
  assert.equal(r.gate_status, "pass");
  assert.ok(r.quality_score >= 80, `quality ${r.quality_score}`);
  assert.equal(r.kwaliteitPass, true);
});

test("engine: dangling [Bron] → GEBLOKKEERD ongeacht hoge score", async () => {
  const spec: TestcaseSpec = { expected_answer_outline: { exact_facts: ["112,4%"] }, min_quality_score: 80 };
  const r = await evalueerOutput({
    ...baseInput,
    antwoord: "De beleidsdekkingsgraad is 112,4% [Bron 9].", // [Bron 9] bestaat niet (1 bron)
    spec,
    criteria: ["exact_numeric_fact_match"],
  });
  assert.equal(r.gate_status, "geblokkeerd");
  // Kritieke finding blokkeert ondanks dat de exacte-feit-check slaagt.
  assert.ok(r.findings.some((f) => f.ernst === "kritiek"));
  assert.equal(r.kwaliteitPass, false);
});

test("engine: judge is ADVISEREND — judge-fail zonder harde blokkade → review_vereist, niet geblokkeerd", async () => {
  const spec: TestcaseSpec = { forbidden_claims: ["verzonnen"], min_quality_score: 80 };
  const nepJudge = async (c: JudgeCriterium): Promise<JudgeResultaat> => ({
    criterium_code: c, score: null, pass: false, motivatie: "Judge keurt af.",
    bewijs: [], judge_model: "claude-opus-4-8", methode: "llm_judge",
  });
  const r = await evalueerOutput(
    {
      ...baseInput,
      antwoord: "Een net antwoord [Bron 1].",
      spec,
      criteria: ["no_forbidden_claim"],
    },
    { judge: nepJudge }
  );
  assert.equal(r.gate_status, "review_vereist"); // NIET geblokkeerd op judge alleen
});

test("engine: geen judge-runner → judge-criterium levert review_vereist (geen groen vinkje)", async () => {
  const r = await evalueerOutput({
    ...baseInput,
    antwoord: "Een net antwoord [Bron 1].",
    spec: { min_quality_score: 80 },
    criteria: ["claim_matches_source_semantic"],
  });
  assert.equal(r.gate_status, "review_vereist");
});

test("engine: dimensievloer niet gehaald → kwaliteitPass=false ook al is het gemiddelde hoog", async () => {
  const spec: TestcaseSpec = {
    expected_answer_outline: { exact_facts: ["112,4%"], forbidden: [] },
    dimension_floors: { format_compliance: 80 },
    required_sections: ["aanleiding", "voorstel", "besluit"],
    min_quality_score: 50,
  };
  const r = await evalueerOutput({
    ...baseInput,
    antwoord: "De beleidsdekkingsgraad is 112,4% [Bron 1].", // secties ontbreken → format 0
    spec,
    criteria: ["exact_numeric_fact_match", "required_section_present"],
  });
  const vloer = r.dimensieVloeren.find((d) => d.dimensie === "format_compliance");
  assert.ok(vloer && vloer.gehaald === false);
  assert.equal(r.kwaliteitPass, false);
});

test("engine: schone boolean-judge pass (no_forbidden_claim, score=null) → GEEN review-trigger", async () => {
  const goedeJudge = async (c: JudgeCriterium): Promise<JudgeResultaat> => ({
    criterium_code: c, score: null, pass: true, motivatie: "Geen verboden claim.",
    bewijs: [], judge_model: "claude-opus-4-8", methode: "llm_judge",
  });
  const r = await evalueerOutput(
    {
      ...baseInput,
      antwoord: "Aanleiding: 112,4% [Bron 1].",
      spec: { expected_answer_outline: { exact_facts: ["112,4%"] }, min_quality_score: 80 },
      criteria: ["exact_numeric_fact_match", "no_forbidden_claim"],
      reviewVerplicht: false,
    },
    { judge: goedeJudge }
  );
  assert.equal(r.gate_status, "pass"); // score=null bij een PASS mag geen review forceren
});

test("engine: reviewVerplicht → gate review_vereist bij schone output", async () => {
  const r = await evalueerOutput({
    ...baseInput,
    antwoord: "Aanleiding: 112,4% [Bron 1].",
    spec: { expected_answer_outline: { exact_facts: ["112,4%"] }, min_quality_score: 80 },
    criteria: ["exact_numeric_fact_match"],
    reviewVerplicht: true,
  });
  assert.equal(r.gate_status, "review_vereist");
});
