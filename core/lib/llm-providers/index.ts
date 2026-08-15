// lib/llm-providers/index.ts
// -----------------------------------------------------------------------------
// AQLab — provider-registry (AQL-6). Kiest de juiste generatie-adapter op basis
// van de provider. Anthropic is de default en het baseline-/productiepad; OpenAI
// en Mistral zijn challengers ("ander provider dan productie", decision 0064).
// -----------------------------------------------------------------------------

import type { ModelProvider, ProviderRequest, ProviderResultaat } from "./types";
import { genereerAnthropic, type AnthropicStreamClient } from "./anthropic";
import { genereerOpenAI } from "./openai";
import { genereerMistral } from "./mistral";
import type { PoortContext } from "../ai-poort";

export type { ModelProvider, ProviderRequest, ProviderResultaat } from "./types";
export { systeemBlokkenNaarTekst } from "./types";
export type { AnthropicStreamClient } from "./anthropic";

export interface ProviderOpties {
  /** Injecteerbare Anthropic stream-client (hermetische tests/smoke). */
  anthropicClient?: AnthropicStreamClient;
  /** Injecteerbare fetch (hermetische tests voor OpenAI/Mistral). */
  fetchImpl?: typeof fetch;
  /**
   * AI-BEGRENZING (besluit 0180). Verplicht op het productiepad: elke adapter
   * toetst hiermee live de kill switch en de modelallowlist. Alleen met een
   * geïnjecteerde client/fetch (hermetische tests) mag hij ontbreken.
   */
  poort?: PoortContext;
}

/**
 * Draait één generatie via de gekozen provider. De retrieval/RAG en [Bron N]-
 * labeling zitten NIET hier — die blijven in de generatie-adapter; hier swapt
 * uitsluitend het generatiemodel.
 */
export async function genereerViaProvider(
  provider: ModelProvider,
  req: ProviderRequest,
  opts?: ProviderOpties
): Promise<ProviderResultaat> {
  switch (provider) {
    case "openai":
      return genereerOpenAI(req, { fetchImpl: opts?.fetchImpl, poort: opts?.poort });
    case "mistral":
      return genereerMistral(req, { fetchImpl: opts?.fetchImpl, poort: opts?.poort });
    case "anthropic":
    default:
      return genereerAnthropic(req, opts?.anthropicClient, opts?.poort);
  }
}
