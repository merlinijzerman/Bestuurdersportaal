// lib/llm-providers/anthropic.ts
// -----------------------------------------------------------------------------
// AQLab — Anthropic-adapter (AQL-6). Dit is de BESTAANDE productie-generatiecall,
// één-op-één verplaatst uit lib/generatie-kern.ts: dezelfde stream()-parameters
// (system-blokken met cache_control, messages, optioneel temperature/top_p) en
// dezelfde usage-mapping. Gedrag ONGEWIJZIGD — de streaming-route en het Lab
// draaien exact wat live draait.
//
// De client is injecteerbaar (hermetische smoke/tests): mockModelClient in
// lib/aqlab/smoke.ts levert een stream-vormige stub.
// -----------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import type { ProviderRequest, ProviderResultaat } from "./types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

/** Injecteerbare, stream-vormige client (default = de gedeelde productie-client). */
export type AnthropicStreamClient = Pick<Anthropic["messages"], "stream">;

export async function genereerAnthropic(
  req: ProviderRequest,
  client?: AnthropicStreamClient
): Promise<ProviderResultaat> {
  const streamer = client ?? anthropic.messages;

  // Alleen expliciet gezette waarden meesturen; anders neemt de provider-default
  // het over (identiek aan de streaming-route, die temperature/top_p niet zet).
  const temperatuurGezet = typeof req.temperature === "number";
  const topPGezet = typeof req.topP === "number";
  const callParams: Anthropic.Messages.MessageStreamParams = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.systeemBlokken,
    messages: req.berichten,
    ...(temperatuurGezet ? { temperature: req.temperature as number } : {}),
    ...(topPGezet ? { top_p: req.topP as number } : {}),
  };

  const start = Date.now();
  const stream = streamer.stream(callParams);
  const finalMessage = await stream.finalMessage();
  const latency_ms = Date.now() - start;

  const tekst = finalMessage.content
    .map((blok) => (blok.type === "text" ? blok.text : ""))
    .join("");

  return {
    tekst,
    tokens: {
      in: finalMessage.usage?.input_tokens ?? 0,
      out: finalMessage.usage?.output_tokens ?? 0,
    },
    latency_ms,
  };
}
