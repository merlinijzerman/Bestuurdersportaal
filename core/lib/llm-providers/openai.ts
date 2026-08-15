// lib/llm-providers/openai.ts
// -----------------------------------------------------------------------------
// AQLab — OpenAI-adapter (AQL-6). Dunne REST-wrapper (geen SDK), consistent met
// het bestaande Mistral-patroon (lib/embeddings.ts): server-side only, key uit de
// omgeving (NOOIT NEXT_PUBLIC_). Uitsluitend als CHALLENGER op de synthetische
// golden set (decision 0064) — nooit echte fondsdata.
//
// EU-MIGRATIE-KLAAR: het endpoint komt uit één base-URL-constante. Omschakelen
// naar Azure OpenAI (EU) is later een config-/endpoint-wissel (OPENAI_BASE_URL +
// evt. auth-header), geen herbouw. Reguliere api.openai.com = VS-verwerking,
// bewust geaccepteerd zolang alleen synthetische data wordt verzonden.
//
// NO-TRAINING: de reguliere OpenAI API traint standaard niet op API-data
// (vastgelegd in decision 0064). Er is dus geen per-request no-training-parameter.
// -----------------------------------------------------------------------------

import type { ProviderRequest, ProviderResultaat } from "./types";
import { systeemBlokkenNaarTekst } from "./types";
import { poortCheck, type PoortContext } from "../ai-poort";

// Base-URL als config-punt (EU-swap). Trailing slashes worden genormaliseerd.
export const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

const MAX_RETRIES = 2;

function slaap(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface OpenAIChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function genereerOpenAI(
  req: ProviderRequest,
  opts?: { fetchImpl?: typeof fetch; poort?: PoortContext }
): Promise<ProviderResultaat> {
  const doFetch = opts?.fetchImpl ?? fetch;
  // Bij een geïnjecteerde fetch (hermetische tests) is geen echte key nodig; in
  // productie (echte fetch) blijft de key hard vereist.
  const key = process.env.OPENAI_API_KEY ?? (opts?.fetchImpl ? "test-key" : undefined);
  if (!key) throw new Error("OPENAI_API_KEY ontbreekt in de omgeving");

  // System-blokken → één system-message; daarna de gespreks-messages ongewijzigd.
  // NB: oudere o1-modellen accepteren geen "system"-rol (wel "developer"); GPT-5 en
  // de recente o-serie accepteren "system". Verifieer per model als je oudere
  // reasoning-modellen toevoegt.
  const messages = [
    { role: "system" as const, content: systeemBlokkenNaarTekst(req.systeemBlokken) },
    ...req.berichten,
  ];

  // Reasoning-modellen (o-serie/GPT-5): max_completion_tokens i.p.v. max_tokens,
  // GEEN temperature/top_p (vergrendeld → sturen geeft een 400), wél
  // reasoning_effort. Het budget dekt reasoning- + zichtbare tokens samen.
  const body = req.redeneermodel
    ? {
        model: req.model,
        max_completion_tokens: req.maxTokens,
        messages,
        ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
      }
    : {
        model: req.model,
        max_tokens: req.maxTokens,
        messages,
        ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
        ...(typeof req.topP === "number" ? { top_p: req.topP } : {}),
      };

  // AI-BEGRENZING (besluit 0180). Poort vóór de eerste poging; de retrylus
  // hieronder herhaalt hetzelfde verzoek en valt binnen dezelfde toestemming.
  // Zonder geïnjecteerde fetch (productiepad) is een poortcontext verplicht.
  if (!opts?.fetchImpl) {
    if (!opts?.poort) {
      throw new Error("openai: poortcontext ontbreekt (AI-begrenzing, besluit 0180)");
    }
    await poortCheck(opts.poort, "openai", req.model);
  }

  const start = Date.now();
  for (let poging = 0; poging <= MAX_RETRIES; poging++) {
    const res = await doFetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json()) as OpenAIChatResponse;
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
    throw new Error(`OpenAI chat/completions ${res.status}`);
  }
  throw new Error("OpenAI chat/completions: max retries overschreden");
}
