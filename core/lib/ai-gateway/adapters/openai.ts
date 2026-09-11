// ============================================================================
//  core/lib/ai-gateway/adapters/openai.ts — OpenAI chat-completions (rauwe fetch)
// ----------------------------------------------------------------------------
//  Eén-op-één verhuisd uit core/lib/llm-providers/openai.ts (AQL-6): zelfde
//  body-mapping (reasoning-modellen: max_completion_tokens, geen sampling,
//  reasoning_effort), zelfde retry/backoff. Nieuw: credentials komen van de
//  gateway (profielreferentie), niet rechtstreeks uit process.env; fouten dragen
//  een HTTP-status zodat de gateway ze kan classificeren.
//
//  EU-MIGRATIE-KLAAR: de base-URL is de endpointreferentie van het profiel
//  (OPENAI_BASE_URL) of de standaard. Geen streaming (fail-closed).
// ============================================================================

import type { Credentials } from "../secrets";
import { GatewayFout } from "../fout";
import { maakUsage, systeemNaarTekst, type AdapterResultaat, type AdapterVerzoek, type ProviderAdapter } from "./types";

export const OPENAI_STANDAARD_BASE_URL = "https://api.openai.com/v1";
const MAX_RETRIES = 2;

function slaap(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface OpenAIChatResponse {
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

export function maakOpenAIAdapter(deps?: { fetchImpl?: typeof fetch }): ProviderAdapter {
  const doFetch = deps?.fetchImpl ?? fetch;
  return {
    provider: "openai",

    async genereer(v: AdapterVerzoek, credentials: Credentials): Promise<AdapterResultaat> {
      const baseUrl = (credentials.baseUrl ?? OPENAI_STANDAARD_BASE_URL).replace(/\/+$/, "");
      const messages = [{ role: "system" as const, content: systeemNaarTekst(v.systeem) }, ...v.berichten];
      const body = v.redeneermodel
        ? {
            model: v.model,
            max_completion_tokens: v.maxTokens,
            messages,
            ...(v.reasoningEffort ? { reasoning_effort: v.reasoningEffort } : {}),
          }
        : {
            model: v.model,
            max_tokens: v.maxTokens,
            messages,
            ...(typeof v.temperature === "number" ? { temperature: v.temperature } : {}),
            ...(typeof v.topP === "number" ? { top_p: v.topP } : {}),
          };
      if (v.tools && v.tools.length > 0) {
        throw new GatewayFout("configuratie", "tool_niet_ondersteund");
      }

      const start = Date.now();
      for (let poging = 0; poging <= MAX_RETRIES; poging++) {
        const res = await doFetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.apiKey}` },
          body: JSON.stringify(body),
          ...(v.signal ? { signal: v.signal } : {}),
        });
        if (res.ok) {
          const data = (await res.json()) as OpenAIChatResponse;
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
        throw new HttpFout(res.status, "OpenAI chat/completions");
      }
      throw new HttpFout(503, "OpenAI chat/completions: max retries overschreden");
    },

    stream() {
      throw new GatewayFout("configuratie", "streaming_niet_ondersteund");
    },
  };
}
