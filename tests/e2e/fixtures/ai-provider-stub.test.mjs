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

test("stub bewaart per verzoek alleen vorm en hashes, nooit promptinhoud (#311)", async () => {
  await metStub(async (basis, stats) => {
    const geheim = "GEHEIME-PROMPTINHOUD-DIE-NOOIT-OPGESLAGEN-MAG-WORDEN";
    await fetch(`${basis}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        stream: true,
        max_tokens: 5000,
        system: [{ type: "text", text: geheim }],
        messages: [{ role: "user", content: geheim }],
      }),
    });
    const verzoeken = await (await fetch(`${basis}/verzoeken`)).json();
    assert.equal(verzoeken.length, 1);
    const v = verzoeken[0];
    assert.equal(v.model, "claude-sonnet-4-6");
    assert.equal(v.stream, true);
    assert.equal(v.max_tokens, 5000);
    assert.equal(v.temperature, null);
    assert.match(v.system_sha256, /^[0-9a-f]{64}$/);
    assert.match(v.messages_sha256, /^[0-9a-f]{64}$/);
    assert.equal(v.messages_aantal, 1);
    assert.doesNotMatch(JSON.stringify(verzoeken), new RegExp(geheim));
    // `stats` blijft exact de vier tellers: de buffer staat er bewust naast.
    assert.deepEqual(Object.keys(stats), ["requests", "streams", "nonStreams", "failures"]);

    const reset = await fetch(`${basis}/verzoeken`, { method: "DELETE" });
    assert.equal(reset.status, 200);
    assert.deepEqual(await (await fetch(`${basis}/verzoeken`)).json(), []);
  });
});
