import assert from "node:assert/strict";
import { test } from "vitest";
import { bouwAnthropicParams, maakAnthropicAdapter, vertaalAnthropicStop } from "./adapters/anthropic";
import type { AdapterVerzoek } from "./adapters/types";
import { GatewayFout } from "./fout";

const TOOL = {
  soort: "functie" as const,
  naam: "vergelijk_dimensie",
  beschrijving: "Vergelijk de opgegeven waarde.",
  verplicht: true,
  schema: {
    type: "object",
    properties: {
      oordeel: {
        type: "object",
        properties: { score: { type: "number" } },
        required: ["score"],
      },
    },
    required: ["oordeel"],
  },
};

function verzoek(over: Partial<AdapterVerzoek> = {}): AdapterVerzoek {
  return {
    model: "claude-opus-5-5",
    systeem: [{ type: "text", text: "Systeem" }],
    berichten: [{ role: "user", content: "Vergelijk" }],
    maxTokens: 64_000,
    effort: "high",
    temperature: 0,
    topP: 0.9,
    tools: [TOOL],
    ...over,
  };
}

function bericht(over: Record<string, unknown> = {}): unknown {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: "antwoord" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
    },
    ...over,
  };
}

test("bestaande Claude 4.x-requestvorm blijft byte-compatibel", () => {
  const params = bouwAnthropicParams(
    verzoek({ model: "claude-opus-4-8", effort: undefined, maxTokens: 5000 })
  ) as unknown as Record<string, unknown>;
  assert.equal(params.temperature, 0);
  assert.equal(params.top_p, 0.9);
  assert.equal(params.thinking, undefined);
  assert.equal(params.output_config, undefined);
  assert.deepEqual(params.tool_choice, { type: "tool", name: "vergelijk_dimensie" });
  const tool = (params.tools as Array<Record<string, unknown>>)[0]!;
  assert.equal(tool.strict, undefined);
  assert.equal((tool.input_schema as Record<string, unknown>).additionalProperties, undefined);
  assert.deepEqual(params.system, [{ type: "text", text: "Systeem" }]);
});

test("Opus 5.5 gebruikt adaptive thinking, expliciete effort en auto+strict voor de vergelijkingscall", () => {
  const params = bouwAnthropicParams(verzoek()) as unknown as Record<string, unknown>;
  assert.deepEqual(params.thinking, { type: "adaptive" });
  assert.deepEqual(params.output_config, { effort: "high" });
  assert.equal(params.temperature, undefined);
  assert.equal(params.top_p, undefined);
  assert.deepEqual(params.tool_choice, { type: "auto" });
  const tool = (params.tools as Array<Record<string, unknown>>)[0]!;
  assert.equal(tool.strict, true);
  const schema = tool.input_schema as Record<string, unknown>;
  assert.equal(schema.additionalProperties, false);
  const oordeel = (schema.properties as Record<string, Record<string, unknown>>).oordeel;
  assert.equal(oordeel.additionalProperties, false);
  assert.match(JSON.stringify(params.system), /vergelijk_dimensie/);
  assert.equal("additionalProperties" in TOOL.schema, false, "normalisatie muteert het neutrale toolschema niet");
});

test("Sonnet 5 behoudt ondersteunde forced tool-choice en valideert effort fail-closed", () => {
  const params = bouwAnthropicParams(verzoek({ model: "claude-sonnet-5", effort: "low" }));
  assert.deepEqual(params.tool_choice, { type: "tool", name: "vergelijk_dimensie" });
  assert.throws(
    () => bouwAnthropicParams(verzoek({ effort: "minimal" })),
    (fout: unknown) => fout instanceof GatewayFout && fout.reden === "anthropic_effort_niet_ondersteund"
  );
  assert.throws(
    () => bouwAnthropicParams(verzoek({ effort: undefined })),
    (fout: unknown) => fout instanceof GatewayFout && fout.reden === "anthropic_effort_vereist"
  );
  const adapter = maakAnthropicAdapter({
    clientVoor: () => {
      throw new Error("client mag niet worden gemaakt");
    },
  });
  assert.throws(
    () => adapter.stream(verzoek(), { apiKey: "test" }),
    (fout: unknown) =>
      fout instanceof GatewayFout && fout.reden === "verplichte_tool_streaming_niet_ondersteund"
  );
});

test("Opus 5.5 probeert een ontbrekende verplichte tool precies eenmaal opnieuw", async () => {
  const calls: unknown[] = [];
  const antwoorden = [
    bericht(),
    bericht({
      content: [{ type: "tool_use", id: "toolu_test", name: "vergelijk_dimensie", input: { oordeel: { score: 8 } } }],
      stop_reason: "tool_use",
    }),
  ];
  const adapter = maakAnthropicAdapter({
    clientVoor: () => ({
      messages: {
        create: async (params: unknown) => {
          calls.push(params);
          return antwoorden.shift();
        },
        stream: (() => {
          throw new Error("niet gebruikt");
        }) as never,
      } as never,
    }),
  });
  const resultaat = await adapter.genereer(verzoek(), { apiKey: "test" });
  assert.equal(calls.length, 2);
  assert.equal(resultaat.stopReden, "tool");
  assert.equal(resultaat.effort, "high");
  assert.match(JSON.stringify(calls[1]), /HERSTELINSTRUCTIE/);
});

test("Opus 5.5 faalt gesloten als ook de retry geen verplichte tool bevat", async () => {
  let calls = 0;
  const adapter = maakAnthropicAdapter({
    clientVoor: () => ({
      messages: {
        create: (async () => {
          calls += 1;
          return bericht();
        }) as never,
        stream: (() => {
          throw new Error("niet gebruikt");
        }) as never,
      } as never,
    }),
  });
  await assert.rejects(
    () => adapter.genereer(verzoek(), { apiKey: "test" }),
    (fout: unknown) => fout instanceof GatewayFout && fout.reden === "verplichte_tool_ontbreekt"
  );
  assert.equal(calls, 2);
});

test("weigering en thinking-tokens worden inhoudsarm genormaliseerd", async () => {
  let calls = 0;
  const adapter = maakAnthropicAdapter({
    clientVoor: () => ({
      messages: {
        create: (async () => {
          calls += 1;
          return bericht({
            stop_reason: "refusal",
            stop_details: { type: "refusal", category: "general_harms", explanation: "niet loggen" },
            usage: {
              input_tokens: 10,
              output_tokens: 9,
              cache_creation_input_tokens: 2,
              cache_read_input_tokens: 3,
              cache_creation: null,
              inference_geo: null,
              output_tokens_details: { thinking_tokens: 6 },
              server_tool_use: null,
              service_tier: "standard",
            },
          });
        }) as never,
        stream: (() => {
          throw new Error("niet gebruikt");
        }) as never,
      } as never,
    }),
  });
  const resultaat = await adapter.genereer(verzoek(), { apiKey: "test" });
  assert.equal(resultaat.stopReden, "weigering");
  assert.equal(resultaat.stopDetailsCategorie, "general_harms");
  assert.equal(resultaat.effort, "high");
  assert.equal(resultaat.usage.thinking, 6);
  assert.equal(resultaat.usage.totaal, 24);
  assert.equal(calls, 1, "een expliciete weigering wordt niet met een toolretry omzeild");
  assert.doesNotMatch(JSON.stringify(resultaat), /niet loggen/);
  assert.equal(vertaalAnthropicStop("model_context_window_exceeded"), "contextvenster");
  assert.equal(vertaalAnthropicStop("pause_turn"), "pauze");
});
