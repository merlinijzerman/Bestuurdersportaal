import assert from "node:assert/strict";
import { isPreviewOmgeving } from "./deploy-omgeving";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("deploy-omgeving sanity-tests:");

test("Vercel Preview en custom staging tonen de Preview-markering", () => {
  assert.equal(isPreviewOmgeving({ vercelEnv: "preview" }), true);
  assert.equal(isPreviewOmgeving({ vercelTargetEnv: "staging" }), true);
  assert.equal(
    isPreviewOmgeving({ vercelEnv: "preview", vercelTargetEnv: "preview" }),
    true
  );
});

test("Productie en lokale ontbrekende config tonen geen Preview-markering", () => {
  assert.equal(isPreviewOmgeving({ vercelEnv: "production" }), false);
  assert.equal(isPreviewOmgeving({ vercelEnv: "development" }), false);
  assert.equal(isPreviewOmgeving({}), false);
});

console.log(`\n${n} sanity-tests geslaagd.`);
