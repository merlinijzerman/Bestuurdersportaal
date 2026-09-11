import http from "node:http";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  E2E_AI_EERSTE_DELTA,
  E2E_AI_PROVIDER_FOUT_MARKER,
  E2E_AI_TWEEDE_DELTA,
} from "./config.mjs";

export const AI_PROVIDER_POORT = 8790;

/** Aantal bewaarde verzoekvingerafdrukken (ringbuffer; oudste valt af). */
const MAX_VERZOEKEN = 50;

function sha256(waarde) {
  return createHash("sha256").update(waarde).digest("hex");
}

/**
 * Vingerafdruk van één providerverzoek — UITSLUITEND vorm en hashes, nooit de
 * inhoud. Het karakteriseringsharnas (#311) leest dit terug om te bewijzen dat
 * de migratie naar de AI-gateway het verzoek aan de provider byte-identiek laat:
 * zelfde model, zelfde tokenbudget, zelfde sampling, zelfde system-prompt en
 * zelfde berichten. Een hash volstaat daarvoor; de prompttekst zelf blijft
 * buiten dit proces (de stub bewaart nooit promptinhoud — zie de unit-test).
 */
function vingerafdruk(body) {
  const systeem = body.system === undefined ? null : JSON.stringify(body.system);
  const berichten = body.messages === undefined ? null : JSON.stringify(body.messages);
  return {
    model: typeof body.model === "string" ? body.model : null,
    stream: body.stream === true,
    max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : null,
    temperature: typeof body.temperature === "number" ? body.temperature : null,
    top_p: typeof body.top_p === "number" ? body.top_p : null,
    tools: Array.isArray(body.tools)
      ? body.tools.map((t) => (t && typeof t === "object" && typeof t.type === "string" ? t.type : "onbekend"))
      : null,
    tool_choice: body.tool_choice === undefined ? null : JSON.stringify(body.tool_choice),
    system_sha256: systeem === null ? null : sha256(systeem),
    system_tekens: systeem === null ? 0 : systeem.length,
    messages_sha256: berichten === null ? null : sha256(berichten),
    messages_aantal: Array.isArray(body.messages) ? body.messages.length : 0,
  };
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function leesBody(req) {
  let body = "";
  for await (const deel of req) body += deel;
  return body;
}

function sse(res, event) {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/** Deterministische Anthropic-compatibele stub; bewaart nooit promptinhoud. */
export function createAiProviderStub({
  eersteDeltaVertragingMs = 700,
  tweedeDeltaVertragingMs = 700,
} = {}) {
  const stats = { requests: 0, streams: 0, nonStreams: 0, failures: 0 };
  // #356 — LEVENSLOOP van de streams, apart van `stats`: die blijft exact de
  // vier tellers (ai-provider-stub.test.mjs pint `Object.keys`). Deze tellers
  // beantwoorden een andere vraag dan "hoeveel calls kwamen er": is de
  // oorspronkelijke verbinding WERKELIJK afgebroken? `streams +1` bewijst
  // alleen dat er geen tweede call kwam, niet dat de eerste is gestopt.
  const levensloop = { actief: 0, afgebroken: 0, voltooid: 0, tweedeDeltas: 0 };
  // Losse buffer naast `stats`: `stats` blijft exact de vier tellers (unit-test),
  // de vingerafdrukken staan apart en zijn per scenario te wissen.
  const verzoeken = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && req.url === "/stats") {
      return json(res, 200, stats);
    }
    if (req.method === "GET" && req.url === "/levensloop") {
      return json(res, 200, levensloop);
    }
    if (req.method === "GET" && req.url === "/verzoeken") {
      return json(res, 200, verzoeken);
    }
    if (req.method === "DELETE" && req.url === "/verzoeken") {
      verzoeken.length = 0;
      return json(res, 200, { ok: true });
    }
    if (req.method !== "POST" || req.url !== "/v1/messages") {
      return json(res, 404, { error: { type: "not_found_error", message: "Niet gevonden" } });
    }

    stats.requests += 1;
    const raw = await leesBody(req);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(res, 400, { error: { type: "invalid_request_error", message: "Ongeldige JSON" } });
    }
    verzoeken.push(vingerafdruk(body));
    if (verzoeken.length > MAX_VERZOEKEN) verzoeken.shift();
    if (raw.includes(E2E_AI_PROVIDER_FOUT_MARKER)) {
      stats.failures += 1;
      return json(res, 500, {
        type: "error",
        error: { type: "api_error", message: "Synthetische providerfout" },
      });
    }

    const model = typeof body.model === "string" ? body.model : "synthetisch-model";
    if (body.stream !== true) {
      stats.nonStreams += 1;
      return json(res, 200, {
        id: "msg_wp4_nonstream",
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text: "WP4 deterministische teststub" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 4 },
      });
    }

    stats.streams += 1;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    sse(res, {
      type: "message_start",
      message: {
        id: "msg_wp4_stream",
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    });
    sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });

    // #356 — de levensloop van DEZE stream. `voltooid` betekent dat wij hem
    // netjes hebben afgesloten; `afgebroken` dat de client de verbinding
    // verbrak vóórdat dat gebeurde. De timers worden dan opgeruimd, zodat er
    // geen tweede delta meer wordt geschreven op een dode socket.
    levensloop.actief += 1;
    let netjesAfgesloten = false;
    /** @type {ReturnType<typeof setTimeout>[]} */
    const timers = [];
    res.on("close", () => {
      levensloop.actief -= 1;
      if (netjesAfgesloten) return;
      levensloop.afgebroken += 1;
      for (const t of timers) clearTimeout(t);
    });

    timers.push(
      setTimeout(() => {
        if (res.writableEnded || res.destroyed) return;
        sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: E2E_AI_EERSTE_DELTA } });
        timers.push(
          setTimeout(() => {
            if (res.writableEnded || res.destroyed) return;
            levensloop.tweedeDeltas += 1;
            sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: E2E_AI_TWEEDE_DELTA } });
            sse(res, { type: "content_block_stop", index: 0 });
            sse(res, {
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: { output_tokens: 18 },
            });
            sse(res, { type: "message_stop" });
            netjesAfgesloten = true;
            levensloop.voltooid += 1;
            res.end();
          }, tweedeDeltaVertragingMs)
        );
      }, eersteDeltaVertragingMs)
    );
  });
  return { server, stats, levensloop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // #356 — instelbare vertraging, alleen via de CLI-ingang. De DEFAULTS van
  // `createAiProviderStub()` blijven ongemoeid, zodat de karakteriseringsgoldens
  // en de stubtests exact hetzelfde gedrag houden. Een traag streamende stub is
  // nodig om een ECHTE clientdisconnect middenin een generatie te kunnen
  // uitlokken — een gesimuleerd AbortController-signaal bewijst niets over
  // `req.signal` en een gesloten ReadableStream.
  const getal = (naam, standaard) => {
    const n = Number.parseInt(process.env[naam] ?? "", 10);
    return Number.isFinite(n) && n >= 0 ? n : standaard;
  };
  const { server } = createAiProviderStub({
    eersteDeltaVertragingMs: getal("WP4_AI_STUB_DELTA1_MS", 700),
    tweedeDeltaVertragingMs: getal("WP4_AI_STUB_DELTA2_MS", 700),
  });
  server.listen(AI_PROVIDER_POORT, "127.0.0.1", () => {
    process.stdout.write(`WP4 AI-providerstub luistert op 127.0.0.1:${AI_PROVIDER_POORT}\n`);
  });
}
