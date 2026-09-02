import assert from "node:assert/strict";
import test from "node:test";
import { resolveAnthropicBaseUrl } from "../../../core/lib/ai-provider-endpoint.mjs";

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
