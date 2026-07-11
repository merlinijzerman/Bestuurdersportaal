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

/** Eén toegestaan generatiemodel (allowlist-entry). */
export interface ToegestaanModel {
  model_name: string;
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
// De overige zijn challengers die in de infra beschikbaar zijn (kostentabel in
// run-orchestrator.ts kent alle vier). Uitbreiden = hier een regel toevoegen
// (MVP-keuze: code-constante, geen beheerscherm).
export const AQLAB_TOEGESTANE_MODELLEN: ToegestaanModel[] = [
  {
    model_name: "claude-sonnet-4-6",
    label: "Productiekern",
    korteNaam: "sonnet-4-6",
    defaultMaxTokens: 3200,
    isBaseline: true,
    toelichting: "Exact het model dat live draait (productiekern).",
  },
  {
    model_name: "claude-opus-4-8",
    label: "Opus-challenger",
    korteNaam: "opus-4-8",
    defaultMaxTokens: 4500,
    isBaseline: false,
    toelichting: "Sterker/duurder model — test of extra kwaliteit de kosten/latency waard is.",
  },
  {
    model_name: "claude-haiku-4-5-20251001",
    label: "Haiku-challenger",
    korteNaam: "haiku-4-5",
    defaultMaxTokens: 3200,
    isBaseline: false,
    toelichting: "Sneller/goedkoper model — test of de kwaliteit acceptabel blijft.",
  },
  {
    model_name: "claude-sonnet-4-5",
    label: "Sonnet 4.5 (ouder)",
    korteNaam: "sonnet-4-5",
    defaultMaxTokens: 3200,
    isBaseline: false,
    toelichting: "Vorige Sonnet-generatie — regressie t.o.v. de huidige productiekern.",
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
  /** null = provider-default (zoals productie). */
  temperature: number | null;
  /** null = kern-default (MAX_TOKENS). */
  maxTokens: number | null;
  /** null = provider-default. */
  topP: number | null;
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
  return [
    `model:${v.model}`,
    `temp:${v.temperature ?? "provider-default"}`,
    `max:${v.maxTokens ?? "kern-default"}`,
    `topp:${v.topP ?? "provider-default"}`,
    `retr:${stabieleJson(v.retrieval ?? {})}`,
  ].join("|");
}

/** Interne, leesbare naam voor een gepinde variant (bv. "sonnet-4-6 · temp0.2 · 3200"). */
export function autoNaam(v: VariantInstellingen): string {
  const kort = toegestaanModel(v.model)?.korteNaam ?? v.model.replace(/^claude-/, "");
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
  // temperature-as: temperature óf top_p (beide sampling).
  if (
    (baseline.temperature ?? null) !== (challenger.temperature ?? null) ||
    (baseline.topP ?? null) !== (challenger.topP ?? null)
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
