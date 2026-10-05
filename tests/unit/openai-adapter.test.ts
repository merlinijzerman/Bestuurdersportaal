import assert from "node:assert/strict";
import { test } from "vitest";
import { maakOpenAIAdapter } from "../../core/lib/ai-gateway/adapters/openai";
import type { AdapterVerzoek } from "../../core/lib/ai-gateway/adapters/types";

function verzoek(over: Partial<AdapterVerzoek> = {}): AdapterVerzoek {
  return {
    model: "gpt-6-luna",
    taakgroep: "generatie",
    systeem: "Gebruik uitsluitend de meegegeven bron.",
    berichten: [{ role: "user", content: "Wat staat in het document?" }],
    maxTokens: 500,
    effort: "low",
    ...over,
  };
}

test("fondsaanroep gebruikt Responses zonder opslag en met server-side Bearer-auth", async () => {
  const ontvangen: { url?: string; body?: Record<string, unknown>; headers?: Headers } = {};
  const fetchImpl: typeof fetch = async (url, init) => {
    ontvangen.url = String(url);
    ontvangen.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    ontvangen.headers = new Headers(init?.headers);
    return Response.json({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "De planning staat in het stuk." }] }],
      usage: { input_tokens: 13, output_tokens: 8 },
    });
  };
  const resultaat = await maakOpenAIAdapter({ fetchImpl }).genereer(verzoek(), { apiKey: "test-sleutel" });
  assert.equal(ontvangen.url, "https://api.openai.com/v1/responses");
  assert.equal(ontvangen.headers?.get("authorization"), "Bearer test-sleutel");
  assert.equal(ontvangen.headers?.has("api-key"), false);
  assert.equal(ontvangen.body?.store, false);
  assert.equal(ontvangen.body?.instructions, "Gebruik uitsluitend de meegegeven bron.");
  assert.deepEqual(ontvangen.body?.reasoning, { effort: "low" });
  assert.equal(resultaat.tekst, "De planning staat in het stuk.");
  assert.equal(resultaat.stopReden, "einde");
});

test("verplichte functietool levert bestaand tool_use-contract op", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({
    status: "completed",
    output: [{ type: "function_call", call_id: "call-route", name: "classificeer", arguments: '{"type":"feitelijk"}' }],
    usage: { input_tokens: 12, output_tokens: 5 },
  });
  const resultaat = await maakOpenAIAdapter({ fetchImpl }).genereer(
    verzoek({
      taakgroep: "hulp_snel",
      tools: [{
        soort: "functie",
        naam: "classificeer",
        beschrijving: "Classificeer de vraag",
        schema: { type: "object", properties: { type: { type: "string" } }, required: ["type"] },
        verplicht: true,
      }],
    }),
    { apiKey: "test-sleutel" }
  );
  assert.equal(resultaat.stopReden, "tool");
  assert.deepEqual(resultaat.inhoud, [
    { type: "tool_use", id: "call-route", name: "classificeer", input: { type: "feitelijk" } },
  ]);
});

test("fonds-stream stuurt delta's door en bewaart de response niet", async () => {
  const ontvangen: { body?: Record<string, unknown> } = {};
  const fetchImpl: typeof fetch = async (_url, init) => {
    ontvangen.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const sse = [
      'data: {"type":"response.output_text.delta","delta":"Hallo "}\n\n',
      'data: {"type":"response.output_text.delta","delta":"bestuurder"}\n\n',
      'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Hallo bestuurder"}]}],"usage":{"input_tokens":4,"output_tokens":3}}}\n\n',
    ];
    return new Response(new ReadableStream({
      start(controller) {
        for (const blok of sse) controller.enqueue(new TextEncoder().encode(blok));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } });
  };
  const stream = maakOpenAIAdapter({ fetchImpl }).stream(verzoek(), { apiKey: "test-sleutel" });
  const deltas: string[] = [];
  stream.onTekst((delta) => deltas.push(delta));
  const resultaat = await stream.afronden();
  assert.equal(ontvangen.body?.store, false);
  assert.equal(ontvangen.body?.stream, true);
  assert.equal(deltas.join(""), "Hallo bestuurder");
  assert.equal(resultaat.tekst, "Hallo bestuurder");
});

test("gestreamde functietool levert ook een volledig tool_use-resultaat", async () => {
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"function_call","call_id":"call-1","name":"classificeer","arguments":"{\\"type\\":\\"feitelijk\\"}"}],"usage":{"input_tokens":4,"output_tokens":3}}}\n\n'
      ));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
  const stream = maakOpenAIAdapter({ fetchImpl }).stream(verzoek({
    tools: [{
      soort: "functie",
      naam: "classificeer",
      beschrijving: "Classificeer de vraag",
      schema: { type: "object", properties: { type: { type: "string" } }, required: ["type"] },
      verplicht: true,
    }],
  }), { apiKey: "test-sleutel" });
  const resultaat = await stream.afronden();
  assert.equal(resultaat.stopReden, "tool");
  assert.deepEqual(resultaat.inhoud, [
    { type: "tool_use", id: "call-1", name: "classificeer", input: { type: "feitelijk" } },
  ]);
});

test("platform-AQLab houdt het bestaande Chat Completions-pad", async () => {
  let url = "";
  const fetchImpl: typeof fetch = async (input) => {
    url = String(input);
    return Response.json({ choices: [{ message: { content: "lab" }, finish_reason: "stop" }] });
  };
  const resultaat = await maakOpenAIAdapter({ fetchImpl }).genereer(
    verzoek({ taakgroep: null, redeneermodel: true, reasoningEffort: "low" }),
    { apiKey: "test-sleutel" }
  );
  assert.equal(url, "https://api.openai.com/v1/chat/completions");
  assert.equal(resultaat.tekst, "lab");
});
