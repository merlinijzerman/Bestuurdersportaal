// lib/aqlab/judge.ts
// -----------------------------------------------------------------------------
// AQLab — LLM-judge-adapter (AQL-2, technisch §5.5).
//
// De judge geeft een tweede, semantisch oordeel NAAST de deterministische/
// heuristische auto-checks. Harde randvoorwaarden (CLAUDE.md + technisch §5.5):
//   • APART GEPIND MODEL, verschillend van het generatiemodel (self-grading-bias,
//     R2). Generatie draait claude-sonnet-4-6; de judge draait claude-opus-4-8.
//   • VAST JSON-OUTPUT-SCHEMA per criterium, runtime-gevalideerd (geen nieuwe dep).
//   • ADVISEREND: de judge-score staat altijd naast de auto-checks en is NOOIT de
//     enige grond voor een blokkade. De evaluatie-engine gebruikt een judge-signaal
//     hooguit om 'review_vereist' te zetten, nooit om zelfstandig te GEBLOKKEERD.
//   • De judge krijgt bron/context mee voor groundedness.
//
// De drie judge-criteria (seed-YAML checks[], methode 'judge'):
//   - claim_matches_source_semantic → {score_0_100:int, motivation:string, evidence:string}
//   - risk_duiding_correct          → {score_0_100:int, motivation:string}
//   - no_forbidden_claim            → {pass:bool, violated:string[]}
// -----------------------------------------------------------------------------

import type Anthropic from "@anthropic-ai/sdk";
import { bewaakteAnthropic, type PoortContext } from "@/core/lib/ai-poort";

/** Apart gepind judge-model (≠ generatiemodel, anti-self-grading). */
export const JUDGE_MODEL = "claude-opus-4-8";
const JUDGE_MAX_TOKENS = 1024;

/** De criteria die door de judge (en niet door een auto-check) worden beoordeeld. */
export type JudgeCriterium =
  | "claim_matches_source_semantic"
  | "risk_duiding_correct"
  | "no_forbidden_claim";

export const JUDGE_CRITERIA: readonly JudgeCriterium[] = [
  "claim_matches_source_semantic",
  "risk_duiding_correct",
  "no_forbidden_claim",
];

export function isJudgeCriterium(key: string): key is JudgeCriterium {
  return (JUDGE_CRITERIA as readonly string[]).includes(key);
}

/** Genormaliseerd judge-resultaat (wat de evaluatie-engine wegschrijft). */
export interface JudgeResultaat {
  criterium_code: JudgeCriterium;
  /** 0-100 voor de score-varianten; null voor de boolean-variant (no_forbidden_claim). */
  score: number | null;
  /** Adviserende pass/fail. Score-variant: score >= drempel. Boolean-variant: output.pass. */
  pass: boolean;
  motivatie: string;
  /** Geciteerd bewijs (score-variant 'evidence' of boolean-variant 'violated'). */
  bewijs: unknown;
  judge_model: string;
  methode: "llm_judge";
  /** true = de judge kon niet betrouwbaar oordelen (schema-fout/afwezig) → engine zet review_vereist. */
  onbetrouwbaar?: boolean;
}

/** Wat de judge nodig heeft voor groundedness. */
export interface JudgeInput {
  vraag: string;
  antwoord: string;
  /** Bron-/contexttekst (de aangeleverde [Bron N]-context) voor groundedness. */
  bronContext: string;
  /** Voor no_forbidden_claim: de te controleren verboden claims. */
  forbiddenClaims?: string[];
  /** Voor claim_matches_source_semantic: de verwachte feiten (referentie). */
  expectedFacts?: string[];
}

/** Adviserende passdrempel voor de score-varianten (0-100). */
const JUDGE_PASS_DREMPEL = 70;

// ── Vaste judge-prompts per criterium ───────────────────────────────────────
const GEMEEN_KADER = `U bent een onafhankelijke, kritische beoordelaar (LLM-as-judge) voor een AI Output Quality & Governance Lab van een Nederlands pensioenfonds. U beoordeelt de kwaliteit van een AI-antwoord tegen de aangeleverde bron/context. U bent GEEN jurist en uw oordeel is ADVISEREND, geen grondwaarheid. Wees streng, feitelijk en beknopt. Antwoord UITSLUITEND met één geldig JSON-object, zonder omliggende tekst of code-fences.`;

function bouwJudgePrompt(criterium: JudgeCriterium, input: JudgeInput): string {
  const context = input.bronContext?.trim() || "(geen broncontext aangeleverd)";
  const basis = `${GEMEEN_KADER}

VRAAG VAN DE BESTUURDER:
${input.vraag}

AANGELEVERDE BRON/CONTEXT:
${context}

TE BEOORDELEN AI-ANTWOORD:
${input.antwoord}`;

  if (criterium === "claim_matches_source_semantic") {
    const facts = (input.expectedFacts ?? []).join("; ") || "(geen expliciete verwachte feiten)";
    return `${basis}

VERWACHTE FEITEN (referentie): ${facts}

BEOORDEEL: komt elke feitelijke claim in het antwoord inhoudelijk overeen met de aangeleverde bron/context? Wijkt een claim inhoudelijk af, verzint het antwoord iets, of citeert het een niet-onderbouwde bewering, dan is de score laag.
Geef exact dit JSON-schema terug:
{"score_0_100": <geheel getal 0-100>, "motivation": "<beknopte motivatie in het Nederlands>", "evidence": "<letterlijk geciteerd fragment uit antwoord of bron dat uw oordeel staaft>"}`;
  }

  if (criterium === "risk_duiding_correct") {
    return `${basis}

BEOORDEEL: zijn de risico's en compliance-aspecten correct en volledig geduid? Een verzwegen, afgezwakt of verkeerd geduid risico verlaagt de score sterk.
Geef exact dit JSON-schema terug:
{"score_0_100": <geheel getal 0-100>, "motivation": "<beknopte motivatie in het Nederlands>"}`;
  }

  // no_forbidden_claim
  const verboden = (input.forbiddenClaims ?? []).map((c) => `- ${c}`).join("\n") || "(geen opgegeven)";
  return `${basis}

VERBODEN CLAIMS (mogen NIET voorkomen — ook niet geparafraseerd):
${verboden}

BEOORDEEL: komt een van de verboden claims (bijv. een verzonnen cijfer of een gefingeerd besluit) in het antwoord voor?
Geef exact dit JSON-schema terug:
{"pass": <true als GEEN verboden claim voorkomt, anders false>, "violated": [<lijst van letterlijk geciteerde overtredende fragmenten, leeg indien geen>]}`;
}

// ── JSON-extractie + strikte validatie ──────────────────────────────────────
function parseJsonObject(ruw: string): Record<string, unknown> | null {
  const start = ruw.indexOf("{");
  const eind = ruw.lastIndexOf("}");
  if (start === -1 || eind === -1 || eind <= start) return null;
  try {
    const obj = JSON.parse(ruw.slice(start, eind + 1));
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function clampScore(v: unknown): number | null {
  if (typeof v !== "number" || Number.isNaN(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Zet een gevalideerd JSON-object om naar een genormaliseerd JudgeResultaat. */
export function normaliseerJudgeOutput(
  criterium: JudgeCriterium,
  obj: Record<string, unknown> | null
): JudgeResultaat {
  const basis = { criterium_code: criterium, judge_model: JUDGE_MODEL, methode: "llm_judge" as const };
  if (!obj) {
    return {
      ...basis,
      score: null,
      pass: false,
      motivatie: "Judge leverde geen geldig JSON-schema; oordeel onbetrouwbaar (menselijke review nodig).",
      bewijs: null,
      onbetrouwbaar: true,
    };
  }

  if (criterium === "no_forbidden_claim") {
    const pass = obj.pass === true;
    const violated = Array.isArray(obj.violated) ? obj.violated : [];
    if (typeof obj.pass !== "boolean") {
      return { ...basis, score: null, pass: false, motivatie: "Ongeldig boolean-schema van judge.", bewijs: violated, onbetrouwbaar: true };
    }
    return {
      ...basis,
      score: null,
      pass,
      motivatie: pass ? "Geen verboden claim aangetroffen." : `Verboden claim(s) aangetroffen: ${violated.length}.`,
      bewijs: violated,
    };
  }

  // score-varianten
  const score = clampScore(obj.score_0_100);
  const motivatie = typeof obj.motivation === "string" ? obj.motivation : "";
  const evidence = "evidence" in obj ? obj.evidence : null;
  if (score === null || !motivatie) {
    return { ...basis, score, pass: false, motivatie: motivatie || "Ongeldig score-schema van judge.", bewijs: evidence, onbetrouwbaar: true };
  }
  return { ...basis, score, pass: score >= JUDGE_PASS_DREMPEL, motivatie, bewijs: evidence };
}

/** Type voor een injecteerbare model-client (test/mocks). */
export type JudgeClient = {
  messages: Pick<Anthropic["messages"], "create">;
};

// AI-BEGRENZING (besluit 0180). Geen eigen client: de judge-call loopt door de
// centrale poort. AQLab draait op synthetische data maar kost wél echt geld, en
// het judge-model is Opus — juist dat pad mag niet buiten de begrenzing vallen.

/**
 * Beoordeelt één judge-criterium met het apart gepinde judge-model.
 * Adviserend: het resultaat mag nooit zelfstandig een blokkade veroorzaken.
 * @param client optioneel injecteerbaar (hermetische tests/mocks).
 */
export async function beoordeelMetJudge(
  criterium: JudgeCriterium,
  input: JudgeInput,
  client?: JudgeClient,
  poort?: PoortContext
): Promise<JudgeResultaat> {
  const prompt = bouwJudgePrompt(criterium, input);
  // Zonder injecteerbare client (productiepad) is een poortcontext verplicht.
  if (!client && !poort) return normaliseerJudgeOutput(criterium, null);
  try {
    const params = {
      model: JUDGE_MODEL,
      max_tokens: JUDGE_MAX_TOKENS,
      messages: [{ role: "user" as const, content: prompt }],
    };
    const resp = client
      ? await client.messages.create(params)
      : await bewaakteAnthropic(poort!, JUDGE_MODEL, (a) => a.messages.create(params));
    const tekst = resp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return normaliseerJudgeOutput(criterium, parseJsonObject(tekst));
  } catch {
    return normaliseerJudgeOutput(criterium, null);
  }
}
