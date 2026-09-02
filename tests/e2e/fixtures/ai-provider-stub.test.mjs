import assert from "node:assert/strict";
import test from "node:test";
import { createAiProviderStub } from "./ai-provider-stub.mjs";
import {
  E2E_AI_EERSTE_DELTA,
  E2E_AI_PROVIDER_FOUT_MARKER,
  E2E_AI_TWEEDE_DELTA,
} from "./config.mjs";

async function metStub(fn) {
  const { server, stats } = createAiProviderStub({
    eersteDeltaVertragingMs: 5,
    tweedeDeltaVertragingMs: 5,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const adres = server.address();
  try {
    await fn(`http://127.0.0.1:${adres.port}`, stats);
  } finally {
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

test("stub streamt twee vaste Anthropic-delta's en bewaart alleen tellers", async () => {
  await metStub(async (basis, stats) => {
    const response = await fetch(`${basis}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", stream: true, messages: [] }),
    });
    const tekst = await response.text();
    assert.equal(response.status, 200);
    assert.match(tekst, new RegExp(E2E_AI_EERSTE_DELTA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(tekst, new RegExp(E2E_AI_TWEEDE_DELTA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(Object.keys(stats), ["requests", "streams", "nonStreams", "failures"]);
    assert.equal(stats.streams, 1);
  });
});

test("stub geeft een gecontroleerde providerfout zonder invoer terug te tonen", async () => {
  await metStub(async (basis, stats) => {
    const response = await fetch(`${basis}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", stream: true, messages: [{ role: "user", content: E2E_AI_PROVIDER_FOUT_MARKER }] }),
    });
    const tekst = await response.text();
    assert.equal(response.status, 500);
    assert.doesNotMatch(tekst, new RegExp(E2E_AI_PROVIDER_FOUT_MARKER));
    assert.equal(stats.failures, 1);
  });
});
