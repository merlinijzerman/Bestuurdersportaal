// ============================================================================
//  Azure OpenAI Responses-adapter — klant-eigen generatieve AI
// ----------------------------------------------------------------------------
//  Dit is bewust een afzonderlijke provider en geen OpenAI-alias. Daardoor
//  blijven profiel-eigendom, kill switch, allowlist en audit ondubbelzinnig.
//  De endpoint/deployment komen server-side uit het fondsprofiel; de API-key
//  en URL staan uitsluitend in omgevingssecrets.
//
//  We gebruiken Azure OpenAI v1 Responses met `store: false`. De portaalprompt
//  blijft de gezaghebbende instructie en wordt als `instructions` verstuurd.
//  Er is geen providerfallback. Webzoek is nog niet gecontracteerd voor deze
//  provider en faalt daarom gesloten.
// ============================================================================

import type { EffortNiveau, NeutraleTool, StopReden } from "../contract";
import type { Credentials } from "../secrets";
import { GatewayFout } from "../fout";
import {
  berichtNaarTekst,
  maakUsage,
  systeemNaarTekst,
  type AdapterResultaat,
  type AdapterStream,
  type AdapterVerzoek,
  type ProviderAdapter,
} from "./types";

type AzureOutputItem = {
  type?: string;
  content?: Array<{ type?: string; text?: string; refusal?: string }>;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
};

export interface AzureOpenAIResponse {
  status?: string;
  incomplete_details?: { reason?: string | null } | null;
  output?: AzureOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number } | null;
    output_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
}

class AzureOpenAIHttpFout extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Azure OpenAI Responses HTTP ${status}`);
    this.name = "AzureOpenAIHttpFout";
    this.status = status;
  }
}

function sluitObjectSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const uit: Record<string, unknown> = {};
  for (const [sleutel, waarde] of Object.entries(schema)) {
    if (Array.isArray(waarde)) {
      uit[sleutel] = waarde.map((item) =>
        item !== null && typeof item === "object" ? sluitObjectSchema(item as Record<string, unknown>) : item
      );
    } else if (waarde !== null && typeof waarde === "object") {
      uit[sleutel] = sluitObjectSchema(waarde as Record<string, unknown>);
    } else {
      uit[sleutel] = waarde;
    }
  }
  if (schema.type === "object") {
    uit.additionalProperties = false;
    const eigenschappen = uit.properties;
    if (eigenschappen && typeof eigenschappen === "object" && !Array.isArray(eigenschappen)) {
      const namen = Object.keys(eigenschappen);
      const oorspronkelijkVerplicht = new Set(Array.isArray(schema.required) ? schema.required : []);
      for (const naam of namen) {
        if (oorspronkelijkVerplicht.has(naam)) continue;
        const veld = (eigenschappen as Record<string, unknown>)[naam];
        if (!veld || typeof veld !== "object" || Array.isArray(veld)) {
          throw new GatewayFout("configuratie", "azure_openai_schema_ongeldig");
        }
        const definitie = veld as Record<string, unknown>;
        const typen = typeof definitie.type === "string" ? [definitie.type] : definitie.type;
        if (!Array.isArray(typen) || !typen.every((type) => typeof type === "string")) {
          throw new GatewayFout("configuratie", "azure_openai_optioneel_schema_ongeldig");
        }
        definitie.type = [...new Set([...typen, "null"])];
        if (Array.isArray(definitie.enum) && !definitie.enum.includes(null)) {
          definitie.enum = [...definitie.enum, null];
        }
      }
      uit.required = namen;
    }
  }
  return uit;
}

export function bouwAzureOpenAIBody(v: AdapterVerzoek, stream: boolean): Record<string, unknown> {
  const functies = [];
  const verplicht: string[] = [];
  for (const tool of v.tools ?? []) {
    if (tool.soort === "webzoek") {
      throw new GatewayFout("configuratie", "azure_openai_webzoek_niet_ondersteund");
    }
    functies.push({
      type: "function",
      name: tool.naam,
      description: tool.beschrijving,
      parameters: sluitObjectSchema(tool.schema),
      strict: true,
    });
    if (tool.verplicht) verplicht.push(tool.naam);
  }
  if (verplicht.length > 1) {
    throw new GatewayFout("configuratie", "meerdere_verplichte_tools_niet_ondersteund");
  }

  const effort = v.effort ?? null;
  return {
    model: v.model,
    instructions: systeemNaarTekst(v.systeem),
    input: v.berichten.map((bericht) => ({
      role: bericht.role,
      content: berichtNaarTekst(bericht.content),
    })),
    max_output_tokens: v.maxTokens,
    store: false,
    stream,
    parallel_tool_calls: false,
    ...(effort ? { reasoning: { effort } } : {}),
    ...(!effort && typeof v.temperature === "number" ? { temperature: v.temperature } : {}),
    ...(!effort && typeof v.topP === "number" ? { top_p: v.topP } : {}),
    ...(functies.length > 0 ? { tools: functies } : {}),
    ...(verplicht.length === 1 ? { tool_choice: { type: "function", name: verplicht[0] } } : {}),
  };
}

function requestSignal(v: AdapterVerzoek): AbortSignal | undefined {
  const signalen: AbortSignal[] = [];
  if (v.signal) signalen.push(v.signal);
  if (typeof v.timeoutMs === "number" && v.timeoutMs > 0) signalen.push(AbortSignal.timeout(v.timeoutMs));
  if (signalen.length === 0) return undefined;
  return signalen.length === 1 ? signalen[0] : AbortSignal.any(signalen);
}

function endpoint(credentials: Credentials): string {
  if (!credentials.baseUrl) throw new GatewayFout("configuratie", "azure_openai_endpoint_ontbreekt");
  return `${credentials.baseUrl.replace(/\/+$/, "")}/responses`;
}

function parseToolInput(argumenten: string | undefined): unknown {
  try {
    return JSON.parse(argumenten ?? "{}");
  } catch {
    throw new GatewayFout("provider", "azure_openai_toolargumenten_ongeldig");
  }
}

function stopReden(data: AzureOpenAIResponse, heeftTool: boolean, geweigerd: boolean): StopReden {
  if (geweigerd) return "weigering";
  if (heeftTool) return "tool";
  const reden = data.incomplete_details?.reason;
  if (reden === "max_output_tokens") return "max_tokens";
  if (reden === "content_filter") return "weigering";
  if (data.status === "completed") return "einde";
  if (data.status === "incomplete") return "onbekend";
  return "onbekend";
}

export function normaliseerAzureOpenAIResponse(
  data: AzureOpenAIResponse,
  latencyMs: number,
  effort: EffortNiveau | null
): AdapterResultaat {
  const inhoud: unknown[] = [];
  let tekst = "";
  let heeftTool = false;
  let geweigerd = false;

  for (const item of data.output ?? []) {
    if (item.type === "message") {
      for (const deel of item.content ?? []) {
        if (deel.type === "output_text" && typeof deel.text === "string") {
          tekst += deel.text;
          inhoud.push({ type: "text", text: deel.text });
        } else if (deel.type === "refusal") {
          geweigerd = true;
        }
      }
    } else if (item.type === "function_call") {
      if (!item.name) throw new GatewayFout("provider", "azure_openai_toolnaam_ontbreekt");
      heeftTool = true;
      inhoud.push({
        type: "tool_use",
        id: item.call_id ?? item.id ?? "azure-tool-call",
        name: item.name,
        input: parseToolInput(item.arguments),
      });
    }
  }

  const inputTotaal = data.usage?.input_tokens ?? 0;
  const cache = data.usage?.input_tokens_details?.cached_tokens ?? 0;
  const output = data.usage?.output_tokens ?? 0;
  return {
    tekst,
    inhoud,
    stopReden: stopReden(data, heeftTool, geweigerd),
    stopDetailsCategorie: null,
    effort,
    usage: maakUsage({
      in: Math.max(0, inputTotaal - cache),
      out: output,
      cacheLezen: cache,
      thinking: data.usage?.output_tokens_details?.reasoning_tokens,
    }),
    latencyMs,
  };
}

function controleerVerplichteTool(v: AdapterVerzoek, resultaat: AdapterResultaat): void {
  const vereist = v.tools?.find(
    (tool): tool is Extract<NeutraleTool, { soort: "functie" }> =>
      tool.soort === "functie" && Boolean(tool.verplicht)
  );
  if (!vereist || resultaat.stopReden === "weigering") return;
  const aanwezig = resultaat.inhoud.some(
    (blok) =>
      blok !== null &&
      typeof blok === "object" &&
      (blok as { type?: unknown }).type === "tool_use" &&
      (blok as { name?: unknown }).name === vereist.naam
  );
  if (!aanwezig) throw new GatewayFout("provider", "verplichte_tool_ontbreekt");
}

async function haalJson(res: Response): Promise<AzureOpenAIResponse> {
  if (!res.ok) throw new AzureOpenAIHttpFout(res.status);
  return (await res.json()) as AzureOpenAIResponse;
}

async function verwerkSse(
  res: Response,
  opDelta: (delta: string) => void
): Promise<AzureOpenAIResponse> {
  if (!res.ok) throw new AzureOpenAIHttpFout(res.status);
  if (!res.body) throw new GatewayFout("provider", "azure_openai_stream_zonder_body");

  const lezer = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let voltooid: AzureOpenAIResponse | null = null;

  function verwerk(blok: string): void {
    const data = blok
      .split(/\r?\n/)
      .filter((regel) => regel.startsWith("data:"))
      .map((regel) => regel.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      throw new GatewayFout("provider", "azure_openai_stream_json_ongeldig");
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      opDelta(event.delta);
    } else if (event.type === "response.completed" && event.response && typeof event.response === "object") {
      voltooid = event.response as AzureOpenAIResponse;
    } else if (event.type === "response.failed" || event.type === "error") {
      throw new GatewayFout("provider", "azure_openai_stream_gefaald");
    }
  }

  while (true) {
    const { done, value } = await lezer.read();
    buffer += decoder.decode(value, { stream: !done });
    const delen = buffer.split(/\r?\n\r?\n/);
    buffer = delen.pop() ?? "";
    for (const blok of delen) verwerk(blok);
    if (done) break;
  }
  if (buffer.trim()) verwerk(buffer);
  if (!voltooid) throw new GatewayFout("provider", "azure_openai_stream_onvolledig");
  return voltooid;
}

export function maakAzureOpenAIAdapter(deps?: { fetchImpl?: typeof fetch }): ProviderAdapter {
  const doFetch = deps?.fetchImpl ?? fetch;
  return {
    provider: "azure_openai",

    async genereer(v, credentials) {
      const start = Date.now();
      const signaal = requestSignal(v);
      const res = await doFetch(endpoint(credentials), {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": credentials.apiKey },
        body: JSON.stringify(bouwAzureOpenAIBody(v, false)),
        ...(signaal ? { signal: signaal } : {}),
      });
      const resultaat = normaliseerAzureOpenAIResponse(await haalJson(res), Date.now() - start, v.effort ?? null);
      controleerVerplichteTool(v, resultaat);
      return resultaat;
    },

    stream(v, credentials) {
      if (v.tools && v.tools.length > 0) {
        throw new GatewayFout("configuratie", "azure_openai_tools_streaming_niet_ondersteund");
      }
      const start = Date.now();
      let luisteraar: ((delta: string) => void) | null = null;
      const buffer: string[] = [];
      const voltooiing = (async () => {
        const signaal = requestSignal(v);
        const res = await doFetch(endpoint(credentials), {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": credentials.apiKey },
          body: JSON.stringify(bouwAzureOpenAIBody(v, true)),
          ...(signaal ? { signal: signaal } : {}),
        });
        const data = await verwerkSse(res, (delta) => {
          if (luisteraar) luisteraar(delta);
          else buffer.push(delta);
        });
        return normaliseerAzureOpenAIResponse(data, Date.now() - start, v.effort ?? null);
      })();

      const handle: AdapterStream = {
        onTekst(cb) {
          if (luisteraar) throw new GatewayFout("configuratie", "stream_luisteraar_dubbel");
          luisteraar = cb;
          for (const delta of buffer.splice(0)) cb(delta);
        },
        afronden() {
          return voltooiing;
        },
      };
      return handle;
    },
  };
}
