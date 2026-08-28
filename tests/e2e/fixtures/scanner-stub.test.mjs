import assert from "node:assert/strict";
import test from "node:test";
import { scannerGeautoriseerd } from "./scanner-stub.mjs";

test("scannerstub weigert scans zonder beide lokale OIDC-headers", async () => {
  assert.equal(scannerGeautoriseerd({}), false);
  assert.equal(
    scannerGeautoriseerd({ authorization: "Bearer wp3-e2e-local-oidc" }),
    false,
  );
  assert.equal(
    scannerGeautoriseerd({
      authorization: "Bearer wp3-e2e-local-oidc",
      "x-vercel-trusted-oidc-idp-token": "wp3-e2e-local-oidc",
    }),
    true,
  );
});
