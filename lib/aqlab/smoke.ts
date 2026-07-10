// lib/aqlab/smoke.ts
// -----------------------------------------------------------------------------
// AQLab — hermetische mini-smoke (AQL-2). Draait de generatie-adapter →
// evaluatie-engine end-to-end over een CODE-DEFINED mini-testset met een
// GEMOCKTE model-client en judge — geen netwerk, geen DB, geen API-keys. Bewijst
// dat de pijplijn (contextopbouw, [Bron N]-labeling, det/heur-checks, gate,
// judge-advies, aggregatie) klopt en dat de kern-guardrails gelden.
//
// Uitvoeren: npm run aqlab:smoke  (of: npx tsx lib/aqlab/smoke.ts)
// Exit 0 = groen; exit 1 = één of meer verwachtingen niet gehaald.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { genereerViaAdapter, type FixtureContext } from "./generate-adapter";
import { evalueerOutput } from "./evaluation-engine";
import type { GenereerAntwoordParams } from "@/lib/generatie-kern";
import type { TestcaseSpec } from "./checks";
import type { JudgeCriterium, JudgeInput, JudgeResultaat } from "./judge";

// ── Mocks ────────────────────────────────────────────────────────────────────
/** Model-client die altijd hetzelfde (gecande) antwoord streamt. */
function mockModelClient(antwoord: string): GenereerAntwoordParams["client"] {
  return {
    stream: () =>
      ({
        finalMessage: async () => ({
          content: [{ type: "text", text: antwoord }],
          usage: { input_tokens: 120, output_tokens: 240 },
        }),
      }) as unknown as ReturnType<NonNullable<GenereerAntwoordParams["client"]>["stream"]>,
  } as GenereerAntwoordParams["client"];
}

/** Judge-stub: geeft een vaste (adviserende) uitkomst per criterium. */
function mockJudge(pass: boolean) {
  return async (c: JudgeCriterium, _inp: JudgeInput): Promise<JudgeResultaat> => ({
    criterium_code: c,
    score: c === "no_forbidden_claim" ? null : pass ? 90 : 40,
    pass,
    motivatie: pass ? "Judge: sluit aan op de bron." : "Judge: wijkt af.",
    bewijs: pass ? "112,4%" : [],
    judge_model: "claude-opus-4-8",
    methode: "llm_judge",
  });
}

const FIXTURE: FixtureContext = {
  fixture_id: "HORIZON-MEMO-STANDAARD-001",
  titel: "Bestuursmemo dekkingsgraad Q2 2026",
  bron: "Bestuursmemo",
  tekst: "De beleidsdekkingsgraad bedraagt 112,4% (Q2 2026). Voorgestelde premie 2027: 28,6%.",
};

const SPEC: TestcaseSpec = {
  expected_answer_outline: { exact_facts: ["beleidsdekkingsgraad 112,4%", "premie 28,6%"], forbidden: [] },
  forbidden_claims: ["besluit reeds genomen"],
  required_sections: ["aanleiding", "voorstel"],
  required_source_ids: ["HORIZON-MEMO-STANDAARD-001"],
  dimension_floors: { feitelijke_juistheid: 80, format_compliance: 80 },
  min_quality_score: 80,
  checks: ["exact_numeric_fact_match", "required_section_present", "source_label_present", "claim_matches_source_semantic"],
};

interface SmokeGeval {
  naam: string;
  antwoord: string;
  judgePass: boolean;
  verwachtGate: "pass" | "geblokkeerd" | "review_vereist";
}

const GEVALLEN: SmokeGeval[] = [
  {
    naam: "schone output → pass",
    antwoord:
      "Aanleiding: de beleidsdekkingsgraad is 112,4% [Bron 1]. Voorstel: de premie 2027 wordt 28,6% [Bron 1].",
    judgePass: true,
    verwachtGate: "pass",
  },
  {
    naam: "gehallucineerde bron [Bron 9] → GEBLOKKEERD (ongeacht score)",
    antwoord:
      "Aanleiding: de beleidsdekkingsgraad is 112,4% [Bron 9]. Voorstel: premie 28,6% [Bron 9].",
    judgePass: true,
    verwachtGate: "geblokkeerd",
  },
  {
    naam: "judge keurt af zonder harde blokkade → review_vereist (advies, geen auto-blok)",
    antwoord:
      "Aanleiding: de beleidsdekkingsgraad is 112,4% [Bron 1]. Voorstel: premie 28,6% [Bron 1].",
    judgePass: false,
    verwachtGate: "review_vereist",
  },
];

async function main() {
  console.log("AQLab smoke (hermetisch):");
  let fouten = 0;

  for (const g of GEVALLEN) {
    const gen = await genereerViaAdapter({
      vraag: "Vat de kern van dit memo samen.",
      rol: "voorzitter",
      fixtures: [FIXTURE],
      metVervolgvragen: false,
      client: mockModelClient(g.antwoord),
    });

    // Adapter-parity: [Bron N]-labeling en effectieve instellingen aanwezig.
    assert.ok(gen.contextTekst.includes("[Bron 1]"), "context mist [Bron 1]-labeling");
    assert.equal(gen.bronnenAantal, 1);
    assert.equal(gen.effectieveInstellingen.provider_default_used, true);
    assert.ok(gen.snapshot_hash.length === 64, "snapshot_hash geen sha256");

    const res = await evalueerOutput(
      {
        vraag: "Vat de kern van dit memo samen.",
        antwoord: gen.antwoord,
        bronnenAantal: gen.bronnenAantal,
        bronContext: gen.contextTekst,
        spec: SPEC,
        snapshotRefs: gen.snapshot_refs.fixture_ids,
        criteria: SPEC.checks ?? [],
        reviewVerplicht: false,
      },
      { judge: mockJudge(g.judgePass) }
    );

    const ok = res.gate_status === g.verwachtGate;
    if (!ok) fouten++;
    console.log(
      `  ${ok ? "✓" : "✗"} ${g.naam} → gate=${res.gate_status} quality=${res.quality_score} (verwacht ${g.verwachtGate})`
    );
    if (g.verwachtGate === "geblokkeerd") {
      assert.ok(res.findings.some((f) => f.ernst === "kritiek"), "geblokkeerd zonder kritieke finding");
    }
  }

  if (fouten > 0) {
    console.error(`\nSMOKE FAALT: ${fouten} geval(len) niet zoals verwacht.`);
    process.exit(1);
  }
  console.log(`\n${GEVALLEN.length} smoke-gevallen geslaagd.`);
}

main().catch((e) => {
  console.error("SMOKE-FOUT:", e);
  process.exit(1);
});
