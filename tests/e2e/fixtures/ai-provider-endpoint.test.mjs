import assert from "node:assert/strict";
import test from "node:test";
import { resolveAnthropicBaseUrl, resolveMistralBaseUrl } from "../../../core/lib/ai-provider-endpoint.mjs";

const GOED = Object.freeze({
  WP4_E2E_AI_PROVIDER: "local",
  WP4_E2E_AI_PROVIDER_URL: "http://127.0.0.1:8790",
  SEED_DOELOMGEVING: "local",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
});

test("productiegedrag houdt de standaard provider-URL", () => {
  assert.equal(resolveAnthropicBaseUrl({}), undefined);
});

test("expliciete lokale E2E-modus accepteert alleen de vaste loopback-origin", () => {
  assert.equal(resolveAnthropicBaseUrl(GOED), "http://127.0.0.1:8790");
});

for (const [naam, env] of [
  ["verkeerde modus", { ...GOED, WP4_E2E_AI_PROVIDER: "preview" }],
  ["niet-lokale database", { ...GOED, NEXT_PUBLIC_SUPABASE_URL: "https://voorbeeld.supabase.co" }],
  ["externe provider", { ...GOED, WP4_E2E_AI_PROVIDER_URL: "https://api.anthropic.com" }],
  ["loopback met pad", { ...GOED, WP4_E2E_AI_PROVIDER_URL: "http://127.0.0.1:8790/v1" }],
]) {
  test(`providerseam weigert ${naam}`, () => {
    assert.throws(() => resolveAnthropicBaseUrl(env), /E2E AI GEBLOKKEERD/);
  });
}


// ── #349 (F4-T1b) — de embeddingseam draagt dezelfde dubbele grendel ─────────
const LOKAAL = { SEED_DOELOMGEVING: "local", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };

test("T1b-seam — ongezet blijft het productiegedrag ongewijzigd", () => {
  assert.equal(resolveMistralBaseUrl({}), undefined);
  assert.equal(resolveMistralBaseUrl({ ...LOKAAL }), undefined);
});

test("T1b-seam — alleen de volledige lokale grendel leidt om", () => {
  assert.equal(
    resolveMistralBaseUrl({ ...LOKAAL, WP4_E2E_EMBED_PROVIDER: "local", WP4_E2E_EMBED_PROVIDER_URL: "http://127.0.0.1:8791" }),
    "http://127.0.0.1:8791"
  );
});

test("T1b-seam — de chatvlag zet de embeddingsomleiding NIET aan", () => {
  // Losse vlaggen: anders zou het gebruik van de chatstub stilzwijgend ook de
  // embeddingprovider omleiden, en is niet meer te zien wat is omgeleid.
  assert.equal(
    resolveMistralBaseUrl({ ...LOKAAL, WP4_E2E_AI_PROVIDER: "local", WP4_E2E_AI_PROVIDER_URL: "http://127.0.0.1:8790" }),
    undefined
  );
});

test("T1b-seam — buiten de lokale omgeving is de omleiding fail-closed", () => {
  for (const env of [
    { ...LOKAAL, SEED_DOELOMGEVING: "preview", WP4_E2E_EMBED_PROVIDER: "local", WP4_E2E_EMBED_PROVIDER_URL: "http://127.0.0.1:8791" },
    { ...LOKAAL, NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co", WP4_E2E_EMBED_PROVIDER: "local", WP4_E2E_EMBED_PROVIDER_URL: "http://127.0.0.1:8791" },
    { ...LOKAAL, WP4_E2E_EMBED_PROVIDER: "on", WP4_E2E_EMBED_PROVIDER_URL: "http://127.0.0.1:8791" },
    { ...LOKAAL, WP4_E2E_EMBED_PROVIDER: "local", WP4_E2E_EMBED_PROVIDER_URL: "https://api.mistral.ai" },
    { ...LOKAAL, WP4_E2E_EMBED_PROVIDER: "local", WP4_E2E_EMBED_PROVIDER_URL: "http://user:pw@127.0.0.1:8791" },
    { ...LOKAAL, WP4_E2E_EMBED_PROVIDER: "local", WP4_E2E_EMBED_PROVIDER_URL: "http://127.0.0.1:8791/v1" },
    { ...LOKAAL, WP4_E2E_EMBED_PROVIDER: "local" },
  ]) {
    assert.throws(() => resolveMistralBaseUrl(env), /E2E AI GEBLOKKEERD/);
  }
});
