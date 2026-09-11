import assert from "node:assert/strict";
import test from "node:test";
import { veiligeMicrosoftReturnUrl } from "./microsoft-config-core";
test("Microsoft-returnpad accepteert alleen een lokaal absoluut pad", () => {
  assert.equal(veiligeMicrosoftReturnUrl("/profiel"), "/profiel");
  assert.equal(veiligeMicrosoftReturnUrl("/profiel?tab=microsoft"), "/profiel?tab=microsoft");
  assert.equal(veiligeMicrosoftReturnUrl(null), "/profiel");
  assert.equal(veiligeMicrosoftReturnUrl("profiel"), "/profiel");
  assert.equal(veiligeMicrosoftReturnUrl("https://aanvaller.example"), "/profiel");
  assert.equal(veiligeMicrosoftReturnUrl("//aanvaller.example"), "/profiel");
  assert.equal(veiligeMicrosoftReturnUrl("/\\aanvaller.example"), "/profiel");
});
