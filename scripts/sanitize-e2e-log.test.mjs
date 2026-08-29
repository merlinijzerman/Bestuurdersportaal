import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeE2eLog } from "./sanitize-e2e-log.mjs";

test("E2E-serverlog verwijdert bearer, JWT, sessiecookie, querysecret en e-mail", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.handtekening";
  const bron = [
    `Authorization: Bearer ${jwt}`,
    `cookie sb-local-auth-token.0=${jwt}; ander=veilig`,
    `GET /callback?code=gevoelig&token=ook-gevoelig`,
    `account wp3-a-bestuurder@e2e.invalid`,
  ].join("\n");
  const uit = sanitizeE2eLog(bron);
  assert.doesNotMatch(uit, /handtekening|gevoelig|wp3-a-bestuurder/);
  assert.match(uit, /Bearer \[REDACTED\]/);
  assert.match(uit, /sb-local-auth-token\.0=\[REDACTED\]/);
  assert.match(uit, /\[REDACTED_EMAIL\]/);
});
