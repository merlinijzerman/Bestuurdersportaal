// lib/llm-providers/index.ts
// -----------------------------------------------------------------------------
// AQLab — provider-registry (AQL-6), sinds #311 een dunne schil op de adapters
// van de centrale AI-gateway (core/lib/ai-gateway/adapters/*). Er is dus één
// adapterhiërarchie: het Lab en de productiechat draaien dezelfde providercode.
//
// Wat hier BEWUST anders is dan het gateway-pad: AQLab is platformbreed
// (fonds = null), de provider/modelkeuze is caller-supplied uit de
// runconfiguratie (decision 0064) en wordt door de preflight + de live poort
// (fn_ai_poort_check, DB-allowlist) gedekt — niet door de fondsconfiguratie.
// De volledige gateway-route voor AQLab (taaktypes aqlab_generatie/aqlab_judge
// met platformprofiel + gateway-log) volgt in tranche T4.
// -----------------------------------------------------------------------------

import type { ModelProvider, ProviderRequest, ProviderResultaat } from "./types";
import { maakAnthropicAdapter, type AnthropicStreamClient } from "../ai-gateway/adapters/anthropic";
import { maakOpenAIAdapter } from "../ai-gateway/adapters/openai";
import { maakMistralAdapter } from "../ai-gateway/adapters/mistral";
import type { AdapterVerzoek } from "../ai-gateway/adapters/types";
import type { Credentials } from "../ai-gateway/secrets";

export type { ModelProvider, ProviderRequest, ProviderResultaat } from "./types";
export { systeemBlokkenNaarTekst } from "./types";
export type { AnthropicStreamClient };

export interface ProviderOpties {
  /** Injecteerbare Anthropic stream-client (hermetische tests/smoke). */
  anthropicClient?: AnthropicStreamClient;
  /** Injecteerbare fetch (hermetische tests voor OpenAI/Mistral). */
  fetchImpl?: typeof fetch;
}

function naarAdapterVerzoek(req: ProviderRequest): AdapterVerzoek {
  return {
    model: req.model,
    systeem: req.systeemBlokken,
    berichten: req.berichten,
    maxTokens: req.maxTokens,
    temperature: req.temperature,
    topP: req.topP,
    redeneermodel: req.redeneermodel,
    reasoningEffort: req.reasoningEffort ?? null,
  };
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
  const geinjecteerd = Boolean(opts?.anthropicClient || opts?.fetchImpl);
  if (!geinjecteerd) {
    throw new Error(`${provider}: directe providerlaag is uitsluitend voor hermetische tests; gebruik de AI-gateway`);
  }
  const credentials: Credentials = { apiKey: "test-key" };
  const verzoek = naarAdapterVerzoek(req);

  switch (provider) {
    case "openai": {
      const r = await maakOpenAIAdapter({ fetchImpl: opts?.fetchImpl }).genereer(verzoek, credentials);
      return { tekst: r.tekst, tokens: { in: r.usage.in, out: r.usage.out }, latency_ms: r.latencyMs };
    }
    case "mistral": {
      const r = await maakMistralAdapter({ fetchImpl: opts?.fetchImpl }).genereer(verzoek, credentials);
      return { tekst: r.tekst, tokens: { in: r.usage.in, out: r.usage.out }, latency_ms: r.latencyMs };
    }
    case "anthropic":
    default: {
      // Historisch (AQL-6) draait de Lab-generatie via messages.stream +
      // finalMessage — byte-identiek aan de streaming-route. Dat blijft zo.
      const client = opts?.anthropicClient;
      const adapter = maakAnthropicAdapter(
        client
          ? {
              clientVoor: () => ({
                messages: {
                  stream: client.stream.bind(client),
                  create: () => {
                    throw new Error("AQLab-mockclient kent alleen stream()");
                  },
                } as never,
              }),
            }
          : undefined
      );
      const r = await adapter.stream(verzoek, credentials).afronden();
      return { tekst: r.tekst, tokens: { in: r.usage.in, out: r.usage.out }, latency_ms: r.latencyMs };
    }
  }
}
