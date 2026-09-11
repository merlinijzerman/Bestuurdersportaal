// lib/llm-providers/types.ts
// -----------------------------------------------------------------------------
// AQLab — provider-abstractie (AQL-6). Eén dunne interface waarmee de
// generatiekern (lib/generatie-kern.ts) een antwoord kan opvragen bij Anthropic
// (baseline/productie), OpenAI of Mistral, zónder dat de retrieval/RAG en de
// [Bron N]-labeling wijzigen. Alleen het GENERATIEMODEL swapt.
//
// De adapter krijgt de reeds opgebouwde system-blokken (identiek aan wat de
// streaming-route bouwt) + de messages + de effectieve sampling-parameters, en
// levert uitsluitend {tekst, tokens, latency} terug. Alle post-processing
// (vervolgvragen knippen, [Bron N]-telling, effectieve instellingen bevriezen)
// blijft provider-neutraal in de generatiekern.
// -----------------------------------------------------------------------------

import type { ModelProvider, ReasoningEffort } from "@/core/lib/aqlab/modellen";
import type { TekstBlok } from "../ai-gateway/contract";

export type { ModelProvider, ReasoningEffort };

/**
 * Provider-neutraal generatieverzoek. De system-blokken zijn structureel gelijk
 * aan Anthropic TextBlockParams (het bestaande formaat uit bouwSysteemBlokken),
 * getypeerd zonder SDK (#311); OpenAI/Mistral lezen daar enkel de `.text` uit en
 * vouwen ze tot één system-message.
 */
export interface ProviderRequest {
  systeemBlokken: TekstBlok[];
  berichten: { role: "user" | "assistant"; content: string }[];
  model: string;
  maxTokens: number;
  /** null/undefined → provider-default overnemen (zoals productie). */
  temperature?: number | null;
  topP?: number | null;
  /**
   * Reasoning-model (o-serie/GPT-5)? Dan gebruikt de OpenAI-adapter
   * max_completion_tokens i.p.v. max_tokens, laat temperature/top_p weg
   * (vergrendeld) en stuurt reasoning_effort mee. Default false = chat-model.
   */
  redeneermodel?: boolean;
  /** null/undefined → provider-default reasoning-effort. Alleen bij redeneermodel. */
  reasoningEffort?: ReasoningEffort | null;
}

export interface ProviderResultaat {
  tekst: string;
  tokens: { in: number; out: number };
  latency_ms: number;
}

/** Vouwt de system-blokken tot één string (voor OpenAI/Mistral chat-completions). */
export function systeemBlokkenNaarTekst(blokken: TekstBlok[]): string {
  return blokken
    .map((b) => (typeof b.text === "string" ? b.text : ""))
    .filter((t) => t.length > 0)
    .join("\n\n");
}
