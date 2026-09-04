// ============================================================================
//  core/lib/ai-gateway/adapters/anthropic.ts — de ENIGE module met de Anthropic-SDK
// ----------------------------------------------------------------------------
//  Vertaalt het neutrale adapterverzoek één-op-één naar de bestaande SDK-calls
//  (messages.create / messages.stream) met exact dezelfde parameters als de
//  chatroute vóór #311 stuurde — byte-pariteit is gekarakteriseerd in
//  tests/karakterisering (w311.chat.post.bestuurder.sse-*: model, max_tokens,
//  stream, sampling, tools en sha256 van system/berichten).
//
//  De client wordt per credentials gecachet; er is geen module-globale client
//  meer met een vaste sleutel. `resolveAnthropicBaseUrl` (lokale E2E-stub) blijft
//  de enige base-URL-bron. Streams bufferen tekst-delta's tot de aanroeper een
//  luisteraar registreert, zodat geen delta verloren gaat tussen het aanmaken
//  van de stream en `onTekst`.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { resolveAnthropicBaseUrl } from "../../ai-provider-endpoint.mjs";
import { buildWebSearchTool } from "../../web-retrieval";
import type { StopReden } from "../contract";
import type { Credentials } from "../secrets";
import { GatewayFout } from "../fout";
import { maakUsage, type AdapterResultaat, type AdapterStream, type AdapterVerzoek, type ProviderAdapter } from "./types";

export const ANTHROPIC_TIMEOUT_MS = 60_000;
export const ANTHROPIC_MAX_RETRIES = 1;

const clients = new Map<string, Anthropic>();

/**
 * Eén client per (sleutel, base-URL). De gateway is de enige productieaanroeper,
 * zodat `new Anthropic(` nergens anders staat.
 */
function maakAnthropicClient(credentials: Credentials): Anthropic {
  const baseURL = resolveAnthropicBaseUrl() ?? credentials.baseUrl;
  const sleutel = createHash("sha256").update(`${credentials.apiKey}\n${baseURL ?? ""}`).digest("hex");
  let client = clients.get(sleutel);
  if (!client) {
    client = new Anthropic({
      apiKey: credentials.apiKey,
      timeout: ANTHROPIC_TIMEOUT_MS,
      maxRetries: ANTHROPIC_MAX_RETRIES,
      ...(baseURL ? { baseURL } : {}),
    });
    clients.set(sleutel, client);
  }
  return client;
}

type Params = Anthropic.Messages.MessageCreateParamsNonStreaming;

function bouwParams(v: AdapterVerzoek): Params {
  const params: Params = {
    model: v.model,
    max_tokens: v.maxTokens,
    system: v.systeem as Params["system"],
    messages: v.berichten,
  };
  if (typeof v.temperature === "number") params.temperature = v.temperature;
  if (typeof v.topP === "number") params.top_p = v.topP;
  if (v.tools && v.tools.length > 0) {
    const tools: unknown[] = [];
    let toolChoice: Anthropic.Messages.ToolChoice | undefined;
    for (const t of v.tools) {
      if (t.soort === "webzoek") {
        // Servertool; SDK 0.39 typeert hem niet, de API ondersteunt hem wel
        // (identiek aan de route vóór #311).
        tools.push(buildWebSearchTool(t.domeinen, t.maxGebruik));
      } else {
        tools.push({
          name: t.naam,
          description: t.beschrijving,
          input_schema: t.schema as Anthropic.Messages.Tool["input_schema"],
        });
        if (t.verplicht) toolChoice = { type: "tool", name: t.naam };
      }
    }
    (params as { tools?: unknown[] }).tools = tools;
    if (toolChoice) params.tool_choice = toolChoice;
  }
  return params;
}

function bouwOpties(v: AdapterVerzoek): Anthropic.RequestOptions | undefined {
  const opties: Anthropic.RequestOptions = {};
  if (typeof v.timeoutMs === "number") opties.timeout = v.timeoutMs;
  if (v.signal) opties.signal = v.signal;
  return Object.keys(opties).length > 0 ? opties : undefined;
}

function vertaalStop(reden: string | null | undefined): StopReden {
  switch (reden) {
    case "end_turn":
      return "einde";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    case "tool_use":
      return "tool";
    default:
      return "onbekend";
  }
}

function naarResultaat(msg: Anthropic.Messages.Message, latencyMs: number): AdapterResultaat {
  const tekst = msg.content.map((blok) => (blok.type === "text" ? blok.text : "")).join("");
  const u = msg.usage as
    | (Anthropic.Messages.Usage & { cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null })
    | undefined;
  return {
    tekst,
    inhoud: msg.content as unknown[],
    stopReden: vertaalStop(msg.stop_reason),
    usage: maakUsage({
      in: u?.input_tokens ?? 0,
      out: u?.output_tokens ?? 0,
      cacheCreatie: u?.cache_creation_input_tokens ?? 0,
      cacheLezen: u?.cache_read_input_tokens ?? 0,
    }),
    latencyMs,
  };
}

/** Injecteerbare stream-client (hermetische tests/AQLab-smoke). */
export type AnthropicStreamClient = Pick<Anthropic["messages"], "stream">;
export type AnthropicCreateClient = Pick<Anthropic["messages"], "create">;

export function maakAnthropicAdapter(deps?: {
  clientVoor?: (credentials: Credentials) => { messages: AnthropicStreamClient & AnthropicCreateClient };
}): ProviderAdapter {
  const clientVoor = deps?.clientVoor ?? ((c: Credentials) => maakAnthropicClient(c));

  return {
    provider: "anthropic",

    async genereer(verzoek, credentials) {
      const client = clientVoor(credentials);
      const params = bouwParams(verzoek);
      const opties = bouwOpties(verzoek);
      const start = Date.now();
      const msg = await (opties ? client.messages.create(params, opties) : client.messages.create(params));
      return naarResultaat(msg as Anthropic.Messages.Message, Date.now() - start);
    },

    stream(verzoek, credentials) {
      const client = clientVoor(credentials);
      const params = bouwParams(verzoek) as Anthropic.Messages.MessageStreamParams;
      const opties = bouwOpties(verzoek);
      const start = Date.now();
      const stream = opties ? client.messages.stream(params, opties) : client.messages.stream(params);

      // Buffer tot registratie: de gateway doet nog een `await` tussen het
      // aanmaken van de stream en het teruggeven van de handle.
      let luisteraar: ((delta: string) => void) | null = null;
      const buffer: string[] = [];
      // Een geïnjecteerde stub (AQLab-smoke) kent soms alleen finalMessage();
      // dan zijn er geen delta's en levert afronden() het geheel.
      if (typeof (stream as { on?: unknown }).on === "function") {
        stream.on("text", (delta: string) => {
          if (luisteraar) luisteraar(delta);
          else buffer.push(delta);
        });
      }

      const handle: AdapterStream = {
        onTekst(cb) {
          if (luisteraar) throw new GatewayFout("configuratie", "stream_luisteraar_dubbel");
          luisteraar = cb;
          for (const d of buffer.splice(0)) cb(d);
        },
        async afronden() {
          const msg = await stream.finalMessage();
          return naarResultaat(msg, Date.now() - start);
        },
      };
      return handle;
    },
  };
}
