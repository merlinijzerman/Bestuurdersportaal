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
import { evalueerOutput, type EvaluatieResultaat } from "./evaluation-engine";
import { berekenConsistentie, type IteratieMeting } from "./consistency";
import type { GenereerAntwoordParams } from "@/core/lib/generatie-kern";
import type { TestcaseSpec } from "./checks/index";
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

/**
 * Gemockte fetch die een OpenAI/Mistral chat-completions-respons nabootst
 * (zelfde vorm voor beide providers). Bewijst de provider-pariteit zonder netwerk.
 */
function mockChatFetch(antwoord: string): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: antwoord } }],
        usage: { prompt_tokens: 120, completion_tokens: 240 },
      }),
    })) as unknown as typeof fetch;
}

/** Als mockChatFetch, maar legt de verstuurde request-body vast (param-mapping-check). */
function mockCapturingChatFetch(antwoord: string, sink: { body?: Record<string, unknown> }): typeof fetch {
  return (async (_url: string, init: { body: string }) => {
    sink.body = JSON.parse(init.body) as Record<string, unknown>;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: antwoord } }],
        usage: { prompt_tokens: 120, completion_tokens: 240 },
      }),
    };
  }) as unknown as typeof fetch;
}

/** De bronafbakening draagt per generatie bewust een willekeurige sentinel.
 * Voor providerpariteit vergelijken we de structuur, niet die requestnonce. */
function normaliseerBronSentinel(context: string): string {
  return context.replace(/s="[0-9a-f]{12}"/g, 's="<sentinel>"');
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

  // ── Provider-pariteit (AQL-6) — retrieval/[Bron N] identiek over providers ──
  // Zelfde fixtures + vraag; alleen het GENERATIEMODEL swapt (anthropic-stub vs
  // openai/mistral-fetch-stub). contextTekst en bronnen MOETEN identiek zijn —
  // dat bewijst dat alleen de generatie wisselt, niet de retrieval/labeling.
  {
    const schoonAntwoord =
      "Aanleiding: de beleidsdekkingsgraad is 112,4% [Bron 1]. Voorstel: premie 28,6% [Bron 1].";
    const gemeen = { vraag: "Vat de kern van dit memo samen.", rol: "voorzitter", fixtures: [FIXTURE], metVervolgvragen: false as const };

    const viaAnthropic = await genereerViaAdapter({ ...gemeen, client: mockModelClient(schoonAntwoord) });
    const viaOpenAI = await genereerViaAdapter({
      ...gemeen,
      modelConfig: { model: "gpt-4.1", provider: "openai" },
      fetchImpl: mockChatFetch(schoonAntwoord),
    });
    const viaMistral = await genereerViaAdapter({
      ...gemeen,
      modelConfig: { model: "mistral-large-latest", provider: "mistral" },
      fetchImpl: mockChatFetch(schoonAntwoord),
    });

    const anthropicContext = normaliseerBronSentinel(viaAnthropic.contextTekst);
    const contextIdentiek =
      anthropicContext === normaliseerBronSentinel(viaOpenAI.contextTekst) &&
      anthropicContext === normaliseerBronSentinel(viaMistral.contextTekst);
    const bronnenIdentiek =
      JSON.stringify(viaAnthropic.bronnen) === JSON.stringify(viaOpenAI.bronnen) &&
      JSON.stringify(viaAnthropic.bronnen) === JSON.stringify(viaMistral.bronnen);
    const providerBevroren =
      viaOpenAI.effectieveInstellingen.model_provider === "openai" &&
      viaMistral.effectieveInstellingen.model_provider === "mistral" &&
      viaAnthropic.effectieveInstellingen.model_provider === "anthropic";

    const okPariteit = contextIdentiek && bronnenIdentiek && providerBevroren;
    if (!okPariteit) fouten++;
    console.log(
      `  ${okPariteit ? "✓" : "✗"} provider-pariteit: context/bronnen identiek over anthropic/openai/mistral; provider bevroren`
    );
  }

  // ── Reasoning-model param-mapping (AQL-6) ──────────────────────────────────
  // Reasoning-modellen (GPT-5-serie): de OpenAI-adapter MOET max_completion_tokens
  // sturen (geen max_tokens), GEEN temperature/top_p (vergrendeld), wél
  // reasoning_effort — en dat effort moet per output bevroren worden.
  {
    const sink: { body?: Record<string, unknown> } = {};
    const gen = await genereerViaAdapter({
      vraag: "Vat de kern van dit memo samen.",
      rol: "voorzitter",
      fixtures: [FIXTURE],
      metVervolgvragen: false,
      modelConfig: { model: "gpt-5", provider: "openai", redeneermodel: true, reasoningEffort: "high" },
      fetchImpl: mockCapturingChatFetch("Aanleiding: 112,4% [Bron 1].", sink),
    });
    const b = sink.body ?? {};
    const okReasoning =
      typeof b.max_completion_tokens === "number" &&
      !("max_tokens" in b) &&
      !("temperature" in b) &&
      !("top_p" in b) &&
      b.reasoning_effort === "high" &&
      gen.effectieveInstellingen.reasoning_effort_effective === "high" &&
      gen.effectieveInstellingen.temperature_effective === null &&
      gen.effectieveInstellingen.top_p_effective === null;
    if (!okReasoning) fouten++;
    console.log(
      `  ${okReasoning ? "✓" : "✗"} reasoning-mapping (gpt-5): max_completion_tokens + reasoning_effort, géén temperature/top_p; effort bevroren`
    );
  }

  // ── Consistentie-mini (AQL-3, ADR 0056) — end-to-end over 3 iteraties ──────
  function metingUit(iteratie: number, res: EvaluatieResultaat, bronIds: string[]): IteratieMeting {
    const passByCode: Record<string, boolean | null> = {};
    for (const s of res.scores) passByCode[s.criterium_code] = s.pass;
    return {
      iteratie,
      gate_status: res.gate_status,
      quality_score: res.quality_score,
      passByCode,
      bronIds,
      retrievalIds: ["HORIZON-MEMO-STANDAARD-001"],
      kritiekeBlokkade: res.gate_status === "geblokkeerd",
    };
  }
  async function evalAntwoord(antwoord: string): Promise<EvaluatieResultaat> {
    const gen = await genereerViaAdapter({
      vraag: "Vat de kern van dit memo samen.",
      rol: "voorzitter",
      fixtures: [FIXTURE],
      metVervolgvragen: false,
      client: mockModelClient(antwoord),
    });
    return evalueerOutput(
      { vraag: "Vat de kern van dit memo samen.", antwoord: gen.antwoord, bronnenAantal: gen.bronnenAantal, bronContext: gen.contextTekst, spec: SPEC, snapshotRefs: gen.snapshot_refs.fixture_ids, criteria: SPEC.checks ?? [], reviewVerplicht: false },
      { judge: mockJudge(true) }
    );
  }

  const schoon = "Aanleiding: de beleidsdekkingsgraad is 112,4% [Bron 1]. Voorstel: de premie 2027 wordt 28,6% [Bron 1].";
  const stabiel = [
    metingUit(1, await evalAntwoord(schoon), ["HORIZON-MEMO-STANDAARD-001"]),
    metingUit(2, await evalAntwoord(schoon), ["HORIZON-MEMO-STANDAARD-001"]),
    metingUit(3, await evalAntwoord(schoon), ["HORIZON-MEMO-STANDAARD-001"]),
  ];
  const aggStabiel = berekenConsistentie(stabiel, { iterations: 3, consistency_required: true, critical: false });
  const okStabiel = aggStabiel.consistency_status === "consistent" && aggStabiel.release_eligible;
  if (!okStabiel) fouten++;
  console.log(`  ${okStabiel ? "✓" : "✗"} 3× identiek → consistent + release_eligible (status=${aggStabiel.consistency_status})`);

  // Eén iteratie met ander cijfer → verboden variatie → niet release_eligible.
  const afwijkend = "Aanleiding: de beleidsdekkingsgraad is 130,0% [Bron 1]. Voorstel: de premie 2027 wordt 28,6% [Bron 1].";
  const wisselend = [
    metingUit(1, await evalAntwoord(schoon), ["HORIZON-MEMO-STANDAARD-001"]),
    metingUit(2, await evalAntwoord(afwijkend), ["HORIZON-MEMO-STANDAARD-001"]),
    metingUit(3, await evalAntwoord(schoon), ["HORIZON-MEMO-STANDAARD-001"]),
  ];
  const aggWissel = berekenConsistentie(wisselend, { iterations: 3, consistency_required: true, critical: false });
  const okWissel = !aggWissel.release_eligible && aggWissel.consistency_status !== "consistent";
  if (!okWissel) fouten++;
  console.log(`  ${okWissel ? "✓" : "✗"} wisselend cijfer → niet release_eligible (status=${aggWissel.consistency_status})`);

  if (fouten > 0) {
    console.error(`\nSMOKE FAALT: ${fouten} geval(len) niet zoals verwacht.`);
    process.exit(1);
  }
  console.log(`\n${GEVALLEN.length + 4} smoke-gevallen geslaagd.`);
}

main().catch((e) => {
  console.error("SMOKE-FOUT:", e);
  process.exit(1);
});
