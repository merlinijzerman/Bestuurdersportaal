import http from "node:http";
import { pathToFileURL } from "node:url";
import {
  E2E_AI_EERSTE_DELTA,
  E2E_AI_PROVIDER_FOUT_MARKER,
  E2E_AI_TWEEDE_DELTA,
} from "./config.mjs";

export const AI_PROVIDER_POORT = 8790;

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
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && req.url === "/stats") {
      return json(res, 200, stats);
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
    setTimeout(() => {
      sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: E2E_AI_EERSTE_DELTA } });
      setTimeout(() => {
        sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: E2E_AI_TWEEDE_DELTA } });
        sse(res, { type: "content_block_stop", index: 0 });
        sse(res, {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 18 },
        });
        sse(res, { type: "message_stop" });
        res.end();
      }, tweedeDeltaVertragingMs);
    }, eersteDeltaVertragingMs);
  });
  return { server, stats };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server } = createAiProviderStub();
  server.listen(AI_PROVIDER_POORT, "127.0.0.1", () => {
    process.stdout.write(`WP4 AI-providerstub luistert op 127.0.0.1:${AI_PROVIDER_POORT}\n`);
  });
}
