import assert from "node:assert/strict";
import { test } from "vitest";
import { GatewayFout } from "./fout";
import {
  bouwAzureOpenAIBody,
  maakAzureOpenAIAdapter,
  normaliseerAzureOpenAIResponse,
} from "./adapters/azure-openai";
import type { AdapterVerzoek } from "./adapters/types";

function verzoek(over: Partial<AdapterVerzoek> = {}): AdapterVerzoek {
  return {
    model: "klant-gpt-deployment",
    systeem: [{ type: "text", text: "Volg het portaalbeleid." }],
    berichten: [{ role: "user", content: "Vat dit stuk samen." }],
    maxTokens: 4_000,
    effort: "high",
    temperature: 0.3,
    topP: 0.8,
    timeoutMs: 5_000,
    ...over,
  };
}

test("Azure Responses houdt instructies in het portaal, gebruikt de deploymentnaam en slaat de response niet op", () => {
  const body = bouwAzureOpenAIBody(verzoek(), false);
  assert.equal(body.model, "klant-gpt-deployment");
  assert.equal(body.instructions, "Volg het portaalbeleid.");
  assert.equal(body.store, false);
  assert.equal(body.stream, false);
  assert.equal(body.parallel_tool_calls, false);
  assert.deepEqual(body.reasoning, { effort: "high" });
  assert.equal(body.temperature, undefined, "sampling gaat niet mee naast reasoning effort");
  assert.equal(body.top_p, undefined);
  assert.deepEqual(body.input, [{ role: "user", content: "Vat dit stuk samen." }]);
});

test("functie-tools worden strict vertaald en terug genormaliseerd naar het bestaande tool_use-contract", async () => {
  const ontvangen: { url?: string; aanvraag?: Record<string, unknown>; headers?: Headers } = {};
  const fetchImpl: typeof fetch = async (url, init) => {
    ontvangen.url = String(url);
    ontvangen.aanvraag = JSON.parse(String(init?.body)) as Record<string, unknown>;
    ontvangen.headers = new Headers(init?.headers);
    return Response.json({
      status: "completed",
      output: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "classificeer_vraag",
          arguments: '{"taak":"uitleg"}',
        },
      ],
      usage: {
        input_tokens: 15,
        output_tokens: 6,
        input_tokens_details: { cached_tokens: 5 },
        output_tokens_details: { reasoning_tokens: 2 },
      },
    });
  };
  const adapter = maakAzureOpenAIAdapter({ fetchImpl });
  const resultaat = await adapter.genereer(
    verzoek({
      tools: [
        {
          soort: "functie",
          naam: "classificeer_vraag",
          beschrijving: "Classificeer de vraag.",
          verplicht: true,
          schema: {
            type: "object",
            properties: { taak: { type: "string" } },
            required: ["taak"],
          },
        },
      ],
    }),
    { apiKey: "geheim", baseUrl: "https://klant.openai.azure.com/openai/v1" }
  );

  assert.equal(ontvangen.url, "https://klant.openai.azure.com/openai/v1/responses");
  assert.equal(ontvangen.headers?.get("api-key"), "geheim");
  assert.equal(ontvangen.headers?.has("authorization"), false);
  assert.deepEqual(ontvangen.aanvraag?.tool_choice, { type: "function", name: "classificeer_vraag" });
  const tool = (ontvangen.aanvraag?.tools as Array<Record<string, unknown>>)[0]!;
  assert.equal(tool.strict, true);
  assert.equal((tool.parameters as Record<string, unknown>).additionalProperties, false);
  assert.equal(resultaat.stopReden, "tool");
  assert.deepEqual(resultaat.inhoud, [
    { type: "tool_use", id: "call_1", name: "classificeer_vraag", input: { taak: "uitleg" } },
  ]);
  assert.deepEqual(resultaat.usage, {
    in: 10,
    out: 6,
    cacheLezen: 5,
    cacheCreatie: 0,
    thinking: 2,
    totaal: 21,
  });
});

test("strict functie-schema maakt optionele velden nullable en vereist alle velden, ook genest", () => {
  const body = bouwAzureOpenAIBody(
    verzoek({
      tools: [{
        soort: "functie",
        naam: "vergelijk",
        beschrijving: "Vergelijk documenten.",
        verplicht: true,
        schema: {
          type: "object",
          properties: {
            waarde: { type: "string" },
            bewijs: { type: ["string", "null"] },
            details: {
              type: "object",
              properties: { code: { type: "string" }, toelichting: { type: "string" } },
              required: ["code"],
            },
          },
          required: ["waarde", "details"],
        },
      }],
    }),
    false
  );
  const schema = (body.tools as Array<{ parameters: Record<string, unknown> }>)[0]!.parameters;
  assert.deepEqual(schema.required, ["waarde", "bewijs", "details"]);
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(properties.bewijs.type, ["string", "null"]);
  assert.equal(properties.details.additionalProperties, false);
  assert.deepEqual(properties.details.required, ["code", "toelichting"]);
  const details = properties.details.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(details.toelichting.type, ["string", "null"]);
});

test("webzoek en een ontbrekende verplichte tool falen gesloten", async () => {
  assert.throws(
    () =>
      bouwAzureOpenAIBody(
        verzoek({ tools: [{ soort: "webzoek", domeinen: ["voorbeeld.nl"], maxGebruik: 1 }] }),
        false
      ),
    (fout: unknown) =>
      fout instanceof GatewayFout && fout.reden === "azure_openai_webzoek_niet_ondersteund"
  );

  const adapter = maakAzureOpenAIAdapter({
    fetchImpl: async () =>
      Response.json({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "gewoon antwoord" }] }],
      }),
  });
  await assert.rejects(
    () =>
      adapter.genereer(
        verzoek({
          tools: [
            {
              soort: "functie",
              naam: "verplicht",
              beschrijving: "Verplicht",
              verplicht: true,
              schema: { type: "object", properties: {} },
            },
          ],
        }),
        { apiKey: "x", baseUrl: "https://klant.openai.azure.com/openai/v1" }
      ),
    (fout: unknown) => fout instanceof GatewayFout && fout.reden === "verplichte_tool_ontbreekt"
  );
});

test("streaming buffert vroege tekst en rondt af met inhoudsvrije usage", async () => {
  const encoder = new TextEncoder();
  const sse = [
    'data: {"type":"response.output_text.delta","delta":"Hallo "}\n\n',
    'data: {"type":"response.output_text.delta","delta":"wereld"}\n\n',
    'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Hallo wereld"}]}],"usage":{"input_tokens":3,"output_tokens":2}}}\n\n',
    "data: [DONE]\n\n",
  ];
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const deel of sse) controller.enqueue(encoder.encode(deel));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );

  const stream = maakAzureOpenAIAdapter({ fetchImpl }).stream(verzoek(), {
    apiKey: "x",
    baseUrl: "https://klant.openai.azure.com/openai/v1",
  });
  await Promise.resolve();
  const deltas: string[] = [];
  stream.onTekst((delta) => deltas.push(delta));
  const resultaat = await stream.afronden();
  assert.equal(deltas.join(""), "Hallo wereld");
  assert.equal(resultaat.tekst, "Hallo wereld");
  assert.equal(resultaat.stopReden, "einde");
  assert.equal(resultaat.effort, "high");
});

test("normalisatie markeert max tokens en weigering zonder providertekst te bewaren", () => {
  const max = normaliseerAzureOpenAIResponse(
    { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
    12,
    "low"
  );
  assert.equal(max.stopReden, "max_tokens");

  const weigering = normaliseerAzureOpenAIResponse(
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "gevoelige uitleg" }] }] },
    4,
    "low"
  );
  assert.equal(weigering.stopReden, "weigering");
  assert.equal(weigering.tekst, "");
  assert.doesNotMatch(JSON.stringify(weigering), /gevoelige uitleg/);
});
