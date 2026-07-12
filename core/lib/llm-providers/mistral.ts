// lib/llm-providers/mistral.ts
// -----------------------------------------------------------------------------
// AQLab — Mistral-adapter (AQL-6). Hergebruikt exact het REST-patroon van
// lib/embeddings.ts (dezelfde MISTRAL_API_KEY, dezelfde retry/backoff), maar dan
// voor chat-completions i.p.v. embeddings. Server-side only; uitsluitend als
// CHALLENGER op de synthetische golden set (decision 0064) — nooit echte
// fondsdata.
//
// EU-MIGRATIE-KLAAR: het endpoint komt uit één base-URL-constante (MISTRAL_CHAT_URL).
// NO-TRAINING wordt op accountniveau bij Mistral geregeld (vastgelegd in decision
// 0064); er is geen betrouwbare per-request no-training-parameter, dus die zetten
// we hier bewust niet (geen schijnzekerheid).
// -----------------------------------------------------------------------------

import type { ProviderRequest, ProviderResultaat } from "./types";
import { systeemBlokkenNaarTekst } from "./types";

export const MISTRAL_CHAT_URL = (process.env.MISTRAL_CHAT_URL || "https://api.mistral.ai/v1/chat/completions").replace(/\/+$/, "");

const MAX_RETRIES = 2;

function slaap(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MistralChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function genereerMistral(
  req: ProviderRequest,
  opts?: { fetchImpl?: typeof fetch }
): Promise<ProviderResultaat> {
  const doFetch = opts?.fetchImpl ?? fetch;
  // Bij een geïnjecteerde fetch (hermetische tests) is geen echte key nodig; in
  // productie (echte fetch) blijft de key hard vereist.
  const key = process.env.MISTRAL_API_KEY ?? (opts?.fetchImpl ? "test-key" : undefined);
  if (!key) throw new Error("MISTRAL_API_KEY ontbreekt in de omgeving");

  const body = {
    model: req.model,
    max_tokens: req.maxTokens,
    messages: [
      { role: "system" as const, content: systeemBlokkenNaarTekst(req.systeemBlokken) },
      ...req.berichten,
    ],
    ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
    ...(typeof req.topP === "number" ? { top_p: req.topP } : {}),
  };

  const start = Date.now();
  for (let poging = 0; poging <= MAX_RETRIES; poging++) {
    const res = await doFetch(MISTRAL_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json()) as MistralChatResponse;
      const latency_ms = Date.now() - start;
      return {
        tekst: data.choices?.[0]?.message?.content ?? "",
        tokens: {
          in: data.usage?.prompt_tokens ?? 0,
          out: data.usage?.completion_tokens ?? 0,
        },
        latency_ms,
      };
    }

    const tijdelijk = res.status === 429 || res.status >= 500;
    if (tijdelijk && poging < MAX_RETRIES) {
      await slaap(500 * 2 ** poging); // 0,5s → 1s
      continue;
    }
    throw new Error(`Mistral chat/completions ${res.status}`);
  }
  throw new Error("Mistral chat/completions: max retries overschreden");
}
