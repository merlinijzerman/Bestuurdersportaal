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
import { anthropicModelprofiel, isAnthropicEffort } from "../anthropic-modelprofiel";
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

function sluitObjectSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const kopie: Record<string, unknown> = {};
  for (const [sleutel, waarde] of Object.entries(schema)) {
    if (Array.isArray(waarde)) {
      kopie[sleutel] = waarde.map((item) =>
        item !== null && typeof item === "object" ? sluitObjectSchema(item as Record<string, unknown>) : item
      );
    } else if (waarde !== null && typeof waarde === "object") {
      kopie[sleutel] = sluitObjectSchema(waarde as Record<string, unknown>);
    } else {
      kopie[sleutel] = waarde;
    }
  }
  if (schema.type === "object") kopie.additionalProperties = false;
  return kopie;
}

function voegToolInstructieToe(
  systeem: AdapterVerzoek["systeem"],
  toolnamen: string[],
  poging: 0 | 1
): AdapterVerzoek["systeem"] {
  const namen = toolnamen.map((naam) => `\`${naam}\``).join(", ");
  const tekst =
    poging === 0
      ? `Gebruik voor je antwoord verplicht ${namen}. Geef het resultaat uitsluitend via de toolcall.`
      : `HERSTELINSTRUCTIE: je vorige antwoord bevatte geen verplichte toolcall. Roep nu ${namen} aan en geef geen gewoon tekstantwoord.`;
  if (typeof systeem === "string") return `${systeem}\n\n${tekst}`;
  return [...systeem, { type: "text", text: tekst }];
}

export function bouwAnthropicParams(v: AdapterVerzoek, poging: 0 | 1 = 0): Params {
  const profiel = anthropicModelprofiel(v.model);
  const effort = v.effort;
  if (profiel && (effort === null || effort === undefined)) {
    throw new GatewayFout("configuratie", "anthropic_effort_vereist");
  }
  if (profiel && (!isAnthropicEffort(effort) || !profiel.effort.includes(effort))) {
    throw new GatewayFout("configuratie", "anthropic_effort_niet_ondersteund");
  }

  const verplichteToolnamen =
    v.tools?.flatMap((tool) => (tool.soort === "functie" && tool.verplicht ? [tool.naam] : [])) ?? [];
  const autoVerplichteTool = Boolean(profiel && !profiel.forcedToolOndersteund && verplichteToolnamen.length > 0);
  const params: Params = {
    model: v.model,
    max_tokens: v.maxTokens,
    system: (autoVerplichteTool ? voegToolInstructieToe(v.systeem, verplichteToolnamen, poging) : v.systeem) as Params["system"],
    messages: v.berichten,
  };
  if (profiel) {
    params.thinking = { type: "adaptive" };
    params.output_config = { effort: isAnthropicEffort(effort) ? effort : undefined };
  } else {
    // Bestaande 4.x-calls houden exact hun huidige requestvorm.
    if (typeof v.temperature === "number") params.temperature = v.temperature;
    if (typeof v.topP === "number") params.top_p = v.topP;
  }
  if (v.tools && v.tools.length > 0) {
    const tools: unknown[] = [];
    let toolChoice: Anthropic.Messages.ToolChoice | undefined;
    for (const t of v.tools) {
      if (t.soort === "webzoek") {
        // Servertool; de neutrale gatewayvorm blijft identiek aan de route vóór #311.
        tools.push(buildWebSearchTool(t.domeinen, t.maxGebruik));
      } else {
        tools.push({
          name: t.naam,
          description: t.beschrijving,
          input_schema: (profiel ? sluitObjectSchema(t.schema) : t.schema) as Anthropic.Messages.Tool["input_schema"],
          ...(profiel ? { strict: true } : {}),
        });
        if (t.verplicht) {
          toolChoice = profiel && !profiel.forcedToolOndersteund ? { type: "auto" } : { type: "tool", name: t.naam };
        }
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

export function vertaalAnthropicStop(reden: string | null | undefined): StopReden {
  switch (reden) {
    case "end_turn":
      return "einde";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    case "tool_use":
      return "tool";
    case "pause_turn":
      return "pauze";
    case "refusal":
      return "weigering";
    case "model_context_window_exceeded":
      return "contextvenster";
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
    stopReden: vertaalAnthropicStop(msg.stop_reason),
    stopDetailsCategorie: msg.stop_details?.category ?? null,
    usage: maakUsage({
      in: u?.input_tokens ?? 0,
      out: u?.output_tokens ?? 0,
      cacheCreatie: u?.cache_creation_input_tokens ?? 0,
      cacheLezen: u?.cache_read_input_tokens ?? 0,
      thinking: u?.output_tokens_details?.thinking_tokens,
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
      const opties = bouwOpties(verzoek);
      const start = Date.now();
      const profiel = anthropicModelprofiel(verzoek.model);
      const verplichteToolnamen =
        verzoek.tools?.flatMap((tool) => (tool.soort === "functie" && tool.verplicht ? [tool.naam] : [])) ?? [];
      const controleerTool = Boolean(profiel && !profiel.forcedToolOndersteund && verplichteToolnamen.length > 0);

      for (const poging of [0, 1] as const) {
        const params = bouwAnthropicParams(verzoek, poging);
        const msg = (await (opties ? client.messages.create(params, opties) : client.messages.create(params))) as Anthropic.Messages.Message;
        if (!controleerTool || msg.stop_reason === "refusal") return naarResultaat(msg, Date.now() - start);
        const heeftVerplichteTool = verplichteToolnamen.every((naam) =>
          msg.content.some((blok) => blok.type === "tool_use" && blok.name === naam)
        );
        if (heeftVerplichteTool) return naarResultaat(msg, Date.now() - start);
      }
      throw new GatewayFout("provider", "verplichte_tool_ontbreekt");
    },

    stream(verzoek, credentials) {
      const profiel = anthropicModelprofiel(verzoek.model);
      if (profiel && !profiel.forcedToolOndersteund && verzoek.tools?.some((tool) => tool.soort === "functie" && tool.verplicht)) {
        throw new GatewayFout("configuratie", "verplichte_tool_streaming_niet_ondersteund");
      }
      const client = clientVoor(credentials);
      const params = bouwAnthropicParams(verzoek) as Anthropic.Messages.MessageStreamParams;
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
