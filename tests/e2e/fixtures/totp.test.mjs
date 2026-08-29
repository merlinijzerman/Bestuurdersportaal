import assert from "node:assert/strict";
import test from "node:test";
import { maakTotp } from "./totp.mjs";

test("TOTP-generator volgt de RFC 6238 SHA-1-testvector", () => {
  assert.equal(
    maakTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", { tijdMs: 59_000, cijfers: 8 }),
    "94287082",
  );
});
