// ============================================================================
//  core/lib/ai-gateway/adapters/mistral.ts — Mistral chat-completions (rauwe fetch)
// ----------------------------------------------------------------------------
//  Eén-op-één verhuisd uit core/lib/llm-providers/mistral.ts (AQL-6). Alleen
//  chat; embeddings en OCR blijven in core/lib/embeddings.ts en core/lib/ocr.ts
//  achter de 0180-poort (bewust uitgesteld, zie AI-GATEWAY-ONTWERP.md §3.6).
//  Credentials komen van de gateway; de chat-URL is de endpointreferentie van
//  het profiel (MISTRAL_CHAT_URL) of de standaard. Geen streaming (fail-closed).
// ============================================================================

import type { Credentials } from "../secrets";
import { GatewayFout } from "../fout";
import { maakUsage, systeemNaarTekst, type AdapterResultaat, type AdapterVerzoek, type ProviderAdapter } from "./types";

export const MISTRAL_STANDAARD_CHAT_URL = "https://api.mistral.ai/v1/chat/completions";
const MAX_RETRIES = 2;

function slaap(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MistralChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

class HttpFout extends Error {
  readonly status: number;
  constructor(status: number, wat: string) {
    super(`${wat} ${status}`);
    this.name = "HttpFout";
    this.status = status;
  }
}

export function maakMistralAdapter(deps?: { fetchImpl?: typeof fetch }): ProviderAdapter {
  const doFetch = deps?.fetchImpl ?? fetch;
  return {
    provider: "mistral",

    async genereer(v: AdapterVerzoek, credentials: Credentials): Promise<AdapterResultaat> {
      if (v.tools && v.tools.length > 0) {
        throw new GatewayFout("configuratie", "tool_niet_ondersteund");
      }
      const url = (credentials.baseUrl ?? MISTRAL_STANDAARD_CHAT_URL).replace(/\/+$/, "");
      const body = {
        model: v.model,
        max_tokens: v.maxTokens,
        messages: [{ role: "system" as const, content: systeemNaarTekst(v.systeem) }, ...v.berichten],
        ...(typeof v.temperature === "number" ? { temperature: v.temperature } : {}),
        ...(typeof v.topP === "number" ? { top_p: v.topP } : {}),
      };

      const start = Date.now();
      for (let poging = 0; poging <= MAX_RETRIES; poging++) {
        const res = await doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.apiKey}` },
          body: JSON.stringify(body),
          ...(v.signal ? { signal: v.signal } : {}),
        });
        if (res.ok) {
          const data = (await res.json()) as MistralChatResponse;
          const tekst = data.choices?.[0]?.message?.content ?? "";
          const finish = data.choices?.[0]?.finish_reason ?? null;
          return {
            tekst,
            inhoud: [{ type: "text", text: tekst }],
            stopReden: finish === "length" ? "max_tokens" : finish === "stop" ? "einde" : "onbekend",
            usage: maakUsage({ in: data.usage?.prompt_tokens ?? 0, out: data.usage?.completion_tokens ?? 0 }),
            latencyMs: Date.now() - start,
          };
        }
        const tijdelijk = res.status === 429 || res.status >= 500;
        if (tijdelijk && poging < MAX_RETRIES) {
          await slaap(500 * 2 ** poging);
          continue;
        }
        throw new HttpFout(res.status, "Mistral chat/completions");
      }
      throw new HttpFout(503, "Mistral chat/completions: max retries overschreden");
    },

    stream() {
      throw new GatewayFout("configuratie", "streaming_niet_ondersteund");
    },
  };
}
