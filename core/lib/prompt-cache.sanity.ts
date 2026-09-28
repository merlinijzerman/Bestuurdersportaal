import assert from "node:assert/strict";
import test from "node:test";
import { berekenPromptCacheScope, markeerLaatsteGebruikersberichtVoorCache } from "./prompt-cache";

test("cache-scope is stabiel binnen gesprek en gescheiden per fonds/gebruiker/gesprek", () => {
  const basis = { sleutel: "test-geheim", fondsId: "fonds-a", actorId: "user-a", gesprekId: "gesprek-a" };
  assert.equal(berekenPromptCacheScope(basis), berekenPromptCacheScope(basis));
  assert.notEqual(berekenPromptCacheScope(basis), berekenPromptCacheScope({ ...basis, fondsId: "fonds-b" }));
  assert.notEqual(berekenPromptCacheScope(basis), berekenPromptCacheScope({ ...basis, actorId: "user-b" }));
  assert.notEqual(berekenPromptCacheScope(basis), berekenPromptCacheScope({ ...basis, gesprekId: "gesprek-b" }));
});

test("alleen het laatste gebruikersbericht krijgt een cache-breakpoint van één uur", () => {
  const resultaat = markeerLaatsteGebruikersberichtVoorCache([
    { role: "user", content: "eerste" },
    { role: "assistant", content: "antwoord" },
    { role: "user", content: "tweede met documentcontext" },
  ]);
  assert.equal(resultaat[0].content, "eerste");
  assert.deepEqual(resultaat[2].content, [{
    type: "text",
    text: "tweede met documentcontext",
    cache_control: { type: "ephemeral", ttl: "1h" },
  }]);
});

