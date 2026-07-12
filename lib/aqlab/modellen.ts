// lib/aqlab/modellen.ts
// -----------------------------------------------------------------------------
// AQLab — variantbeheer-light (AQL-5). CLIENT-SAFE deel (geen node:crypto, geen
// Supabase): mag zowel in server- als client-components worden geïmporteerd.
//
// Eén plek voor:
//   • AQLAB_TOEGESTANE_MODELLEN — de code-constante allowlist (nooit vrije tekst).
//     Afgeleid van de infra + API-key (Anthropic-generatiekern). Mistral zit in de
//     stack maar UITSLUITEND voor embeddings/OCR, niet voor generatie → bewust
//     GEEN generatie-challenger in de MVP (apart decision-record).
//   • autoNaam() — interne, leesbare naam voor een gepinde variant (geen invoer).
//   • leidGewijzigdeAsAf() — leidt de "gewijzigde as" automatisch af uit
//     baseline-vs-challenger (niet meer handmatig gekozen).
//
// De hash + seed (die node:crypto/Supabase nodig hebben) staan in
// lib/aqlab/modellen-hash.ts, zodat dit bestand client-veilig blijft.
// -----------------------------------------------------------------------------

/**
 * Generatie-provider (AQL-6). Productie draait op Anthropic (baseline); OpenAI en
 * Mistral zijn uitsluitend challengers ("ander provider dan productie"). De
 * provider is per model-string uniek (`claude-*`/`gpt-*`/`mistral-*`), dus hij
 * hoeft NIET in de dedup-hash (canoniekeVariant) — model_name draagt de identiteit.
 * Zie decision 0064 (multi-provider generatie, interim).
 */
export type ModelProvider = "anthropic" | "openai" | "mistral";

/**
 * Reasoning-effort (AQL-6). De "denk-knop" van reasoning-modellen (o-serie,
 * GPT-5): hoevéél interne reasoning-tokens het model besteedt vóór het zichtbare
 * antwoord. Vervangt bij deze modellen de sampling-knop temperature (die door de
 * provider is vergrendeld op de default). null = provider-default (doorgaans
 * "medium"). "minimal" wordt niet door elke reasoning-modelfamilie ondersteund
 * (verifieer per model tegen de provider-docs). Zie decision 0064.
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";
export const REASONING_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];

/** Provider afgeleid uit een allowlist-modelnaam (default anthropic). */
export function providerVanModel(model: string): ModelProvider {
  return toegestaanModel(model)?.provider ?? "anthropic";
}

/**
 * Is dit een reasoning-model (o-serie/GPT-5)? Dan gelden andere API-regels:
 * max_completion_tokens i.p.v. max_tokens, temperature/top_p vergrendeld, en een
 * reasoning_effort-knop. De adapter (lib/llm-providers/openai.ts) vertakt hierop.
 */
export function isRedeneermodel(model: string): boolean {
  return toegestaanModel(model)?.redeneermodel === true;
}

/** Eén toegestaan generatiemodel (allowlist-entry). */
export interface ToegestaanModel {
  model_name: string;
  /** Generatie-provider (AQL-6). Anthropic = baseline; OpenAI/Mistral = challenger. */
  provider: ModelProvider;
  /**
   * AQL-6: reasoning-model (o-serie/GPT-5)? Bepaalt de API-parametermapping:
   * max_completion_tokens, geen temperature/top_p, wel reasoning_effort.
   * Ontbreekt/false = klassiek chat-model (temperature instelbaar).
   */
  redeneermodel?: boolean;
  /** Vriendelijke naam voor de starter-config (variantbeheer-light). */
  label: string;
  /** Korte alias voor auto-namen van gepinde varianten (bv. "sonnet-4-6"). */
  korteNaam: string;
  /** Default max_tokens voor deze variant (afgeleid van de productiekern/infra). */
  defaultMaxTokens: number;
  /** Is dit de productiekern-baseline (exact wat live draait)? */
  isBaseline: boolean;
  /** Korte duiding voor de UI. */
  toelichting: string;
}

// De allowlist. sonnet-4-6 = productiekern (lib/generatie-kern.ts AI_MODEL).
// De overige Anthropic-modellen zijn challengers die in de infra beschikbaar zijn.
// AQL-6: OpenAI (gpt-*) en Mistral (mistral-*) zijn UITSLUITEND challengers
// ("ander provider dan productie"); baseline blijft Claude, judge blijft Claude-opus.
// Externe providers draaien alleen op de synthetische golden set — geen echte
// fondsdata (decision 0064, governance-poort). Uitbreiden = hier een regel
// toevoegen (MVP-keuze: code-constante, geen beheerscherm).
// LET OP: verifieer elke externe modelstring + no-training tegen het provider-
// account vóór de eerste live call (identiek aan de hedging bij AI_MODEL).
export const AQLAB_TOEGESTANE_MODELLEN: ToegestaanModel[] = [
  {
    model_name: "claude-sonnet-4-6",
    provider: "anthropic",
    label: "Productiekern",
    korteNaam: "sonnet-4-6",
    defaultMaxTokens: 3200,
    isBaseline: true,
    toelichting: "Exact het model dat live draait (productiekern).",
  },
  {
    model_name: "claude-opus-4-8",
    provider: "anthropic",
    label: "Opus-challenger",
    korteNaam: "opus-4-8",
    defaultMaxTokens: 4500,
    isBaseline: false,
    toelichting: "Sterker/duurder model — test of extra kwaliteit de kosten/latency waard is.",
  },
  {
    model_name: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    label: "Haiku-challenger",
    korteNaam: "haiku-4-5",
    defaultMaxTokens: 3200,
    isBaseline: false,
    toelichting: "Sneller/goedkoper model — test of de kwaliteit acceptabel blijft.",
  },
  {
    model_name: "claude-sonnet-4-5",
    provider: "anthropic",
    label: "Sonnet 4.5 (ouder)",
    korteNaam: "sonnet-4-5",
    defaultMaxTokens: 3200,
    isBaseline: false,
    toelichting: "Vorige Sonnet-generatie — regressie t.o.v. de huidige productiekern.",
  },
  {
    model_name: "gpt-4.1",
    provider: "openai",
    label: "OpenAI GPT-4.1 (challenger)",
    korteNaam: "gpt-4.1",
    defaultMaxTokens: 3200,
    isBaseline: false,
    toelichting: "Ander provider dan productie (OpenAI), sterk model. Alleen synthetische data; provider+model als gewijzigde as — signaal minder zuiver toewijsbaar.",
  },
  {
    model_name: "gpt-4.1-mini",
    provider: "openai",
    label: "OpenAI GPT-4.1 mini (challenger)",
    korteNaam: "gpt-4.1-mini",
    defaultMaxTokens: 3200,
    isBaseline: false,
    toelichting: "Ander provider dan productie (OpenAI), sneller/goedkoper — test of de kwaliteit acceptabel blijft. Alleen synthetische data.",
  },
  {
    model_name: "gpt-4o",
    provider: "openai",
    label: "OpenAI GPT-4o (challenger)",
    korteNaam: "gpt-4o",
    defaultMaxTokens: 3200,
    isBaseline: false,
    toelichting: "Ander provider dan productie (OpenAI), vorige flagship-generatie. Alleen synthetische data; provider+model als gewijzigde as.",
  },
  {
    model_name: "gpt-4o-mini",
    provider: "openai",
    label: "OpenAI GPT-4o mini (challenger)",
    korteNaam: "gpt-4o-mini",
    defaultMaxTokens: 3200,
    isBaseline: false,
    toelichting: "Ander provider dan productie (OpenAI), goedkoopste chat-optie — test de ondergrens van acceptabele kwaliteit. Alleen synthetische data.",
  },
  // ── OpenAI reasoning-modellen (GPT-5-serie) ─────────────────────────────────
  // Andere API-regels: max_completion_tokens i.p.v. max_tokens, temperature/top_p
  // vergrendeld, reasoning_effort-knop. defaultMaxTokens ruim omdat de verborgen
  // reasoning-tokens meetellen (te krap → leeg/afgekapt zichtbaar antwoord).
  {
    model_name: "gpt-5",
    provider: "openai",
    redeneermodel: true,
    label: "OpenAI GPT-5 (reasoning-challenger)",
    korteNaam: "gpt-5",
    defaultMaxTokens: 8000,
    isBaseline: false,
    toelichting: "Ander provider dan productie (OpenAI), reasoning-model — denkt eerst intern na. Sampling (temperature) is vergrendeld; instelbaar via reasoning-effort. Alleen synthetische data.",
  },
  {
    model_name: "gpt-5-mini",
    provider: "openai",
    redeneermodel: true,
    label: "OpenAI GPT-5 mini (reasoning-challenger)",
    korteNaam: "gpt-5-mini",
    defaultMaxTokens: 8000,
    isBaseline: false,
    toelichting: "Ander provider dan productie (OpenAI), lichter reasoning-model — sneller/goedkoper dan GPT-5. Sampling vergrendeld; reasoning-effort instelbaar. Alleen synthetische data.",
  },
  {
    model_name: "gpt-5-nano",
    provider: "openai",
    redeneermodel: true,
    label: "OpenAI GPT-5 nano (reasoning-challenger)",
    korteNaam: "gpt-5-nano",
    defaultMaxTokens: 8000,
    isBaseline: false,
    toelichting: "Ander provider dan productie (OpenAI), kleinste reasoning-model — goedkoopst. Sampling vergrendeld; reasoning-effort instelbaar. Alleen synthetische data.",
  },
  {
    model_name: "mistral-large-latest",
    provider: "mistral",
    label: "Mistral Large (challenger)",
    korteNaam: "mistral-large",
    defaultMaxTokens: 3200,
    isBaseline: false,
    toelichting: "Ander provider dan productie (Mistral). Alleen synthetische data; provider+model als gewijzigde as — signaal minder zuiver toewijsbaar.",
  },
];

/** Lookup van een toegestaan model (of undefined). */
export function toegestaanModel(model: string): ToegestaanModel | undefined {
  return AQLAB_TOEGESTANE_MODELLEN.find((m) => m.model_name === model);
}

/** Allowlist-check: modelkeuze is nooit vrije tekst. */
export function isToegestaanModel(model: string): boolean {
  return AQLAB_TOEGESTANE_MODELLEN.some((m) => m.model_name === model);
}

/** De effectieve variant-assen die een run reproduceerbaar bepalen (§2B). */
export interface VariantInstellingen {
  model: string;
  /** null = provider-default (zoals productie). Bij reasoning-modellen vergrendeld → null. */
  temperature: number | null;
  /** null = kern-default (MAX_TOKENS). Bij reasoning-modellen = max_completion_tokens. */
  maxTokens: number | null;
  /** null = provider-default. Bij reasoning-modellen vergrendeld → null. */
  topP: number | null;
  /**
   * Reasoning-effort (AQL-6). Alleen zinvol bij reasoning-modellen; null =
   * provider-default. Optioneel zodat bestaande (chat-)varianten identiek blijven
   * en hun config-hash NIET verandert (back-compat, geen re-seed — decision 0064).
   */
  reasoningEffort?: ReasoningEffort | null;
  retrieval: Record<string, unknown>;
}

/** Deterministische, sleutel-gesorteerde JSON (stabiel over key-volgorde). */
function stabieleJson(waarde: unknown): string {
  if (waarde === null || typeof waarde !== "object") return JSON.stringify(waarde ?? null);
  if (Array.isArray(waarde)) return `[${waarde.map(stabieleJson).join(",")}]`;
  const obj = waarde as Record<string, unknown>;
  const sleutels = Object.keys(obj).sort();
  return `{${sleutels.map((k) => `${JSON.stringify(k)}:${stabieleJson(obj[k])}`).join(",")}}`;
}

/** Canonieke string over de variant-assen (basis voor de hash + auto-naam). */
export function canoniekeVariant(v: VariantInstellingen): string {
  const delen = [
    `model:${v.model}`,
    `temp:${v.temperature ?? "provider-default"}`,
    `max:${v.maxTokens ?? "kern-default"}`,
    `topp:${v.topP ?? "provider-default"}`,
    `retr:${stabieleJson(v.retrieval ?? {})}`,
  ];
  // Reasoning-effort ALLEEN toevoegen als het gezet is → bestaande (chat-)varianten
  // houden exact dezelfde canonieke string en dus dezelfde config-hash (geen
  // re-seed, decision 0064). Een reasoning-variant krijgt een eigen hash.
  if (v.reasoningEffort) delen.push(`reff:${v.reasoningEffort}`);
  return delen.join("|");
}

/** Interne, leesbare naam voor een gepinde variant (bv. "sonnet-4-6 · temp0.2 · 3200"). */
export function autoNaam(v: VariantInstellingen): string {
  const kort = toegestaanModel(v.model)?.korteNaam ?? v.model.replace(/^claude-/, "");
  // Reasoning-modellen: sampling is vergrendeld → toon reasoning-effort i.p.v. temp.
  if (isRedeneermodel(v.model)) {
    const maxDeel = v.maxTokens == null ? "kern-default" : String(v.maxTokens);
    const effortDeel = v.reasoningEffort ? `effort:${v.reasoningEffort}` : "effort:provider-default";
    return `${kort} · ${effortDeel} · ${maxDeel}`;
  }
  const tempDeel = v.temperature == null ? "provider-default" : `temp${v.temperature}`;
  const maxDeel = v.maxTokens == null ? "kern-default" : String(v.maxTokens);
  const toppDeel = v.topP == null ? "" : ` · topp${v.topP}`;
  return `${kort} · ${tempDeel} · ${maxDeel}${toppDeel}`;
}

export type GewijzigdeAs =
  | "geen"
  | "model"
  | "temperature"
  | "max_tokens"
  | "retrieval"
  | "meerdere";

/**
 * Leidt de "gewijzigde as" af uit baseline-vs-challenger (scherm 3, automatisch —
 * niet meer handmatig). De DB-enum kent geen aparte `top_p`-as; een top_p-wijziging
 * wordt daarom onder de sampling-as `temperature` geteld (beide zijn sampling-knoppen).
 *   • 0 verschillen → "geen" (zelfde als baseline)
 *   • 1 verschil    → die as
 *   • ≥2 verschillen → "meerdere" (regressiesignaal niet zuiver toewijsbaar)
 * Zonder baseline (geen vrijgegeven variant) → "geen" (niets om tegen af te zetten).
 */
export function leidGewijzigdeAsAf(
  baseline: VariantInstellingen | null,
  challenger: VariantInstellingen
): GewijzigdeAs {
  if (!baseline) return "geen";
  const gewijzigd: GewijzigdeAs[] = [];
  if (baseline.model !== challenger.model) gewijzigd.push("model");
  // Generatie-control-as (DB-enum: "temperature"): temperature óf top_p (klassieke
  // sampling) óf reasoning_effort (de sampling-vervanger bij reasoning-modellen).
  // De DB-enum kent geen aparte reasoning-as, dus dit telt onder dezelfde as.
  if (
    (baseline.temperature ?? null) !== (challenger.temperature ?? null) ||
    (baseline.topP ?? null) !== (challenger.topP ?? null) ||
    (baseline.reasoningEffort ?? null) !== (challenger.reasoningEffort ?? null)
  ) {
    gewijzigd.push("temperature");
  }
  if ((baseline.maxTokens ?? null) !== (challenger.maxTokens ?? null)) gewijzigd.push("max_tokens");
  if (stabieleJson(baseline.retrieval ?? {}) !== stabieleJson(challenger.retrieval ?? {})) {
    gewijzigd.push("retrieval");
  }
  if (gewijzigd.length === 0) return "geen";
  if (gewijzigd.length === 1) return gewijzigd[0];
  return "meerdere";
}
