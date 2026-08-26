// Sanity-tests voor de operationele enforce-vlagmeting.
// Uitvoeren: npx tsx core/lib/enforce-vlagstand.sanity.ts

import assert from "node:assert/strict";
import { enforceVlagstandVoorOmgeving } from "./enforce-vlagstand";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("enforce-vlagstand sanity-tests:");

test("resolveert de vier vlaggen volgens hun enforce-semantiek", () => {
  assert.deepEqual(
    enforceVlagstandVoorOmgeving({
      ENFORCE_CAPABILITY: "on",
      ENFORCE_SCHEMA: " ON ",
      ENFORCE_RATELIMIT: "off",
      ENFORCE_AUDIT: "on",
    }),
    {
      ENFORCE_CAPABILITY: true,
      ENFORCE_SCHEMA: true,
      ENFORCE_RATELIMIT: false,
      ENFORCE_AUDIT: true,
    }
  );
});

test("een ontbrekende vlag is aantoonbaar uit", () => {
  assert.deepEqual(enforceVlagstandVoorOmgeving({}), {
    ENFORCE_CAPABILITY: false,
    ENFORCE_SCHEMA: false,
    ENFORCE_RATELIMIT: false,
    ENFORCE_AUDIT: false,
  });
});

test("ENFORCE_AUDIT valt niet buiten de healthcheck (W11, #183 §5b)", () => {
  // De vlag met de omgekeerde semantiek (uit = niets schrijven) hoort óók
  // opgelost te worden; de flag-resolutie zelf is gewoon "on" → true.
  const stand = enforceVlagstandVoorOmgeving({ ENFORCE_AUDIT: "on" });
  assert.equal(stand.ENFORCE_AUDIT, true);
  assert.ok("ENFORCE_AUDIT" in stand, "ENFORCE_AUDIT hoort in de opgeloste stand te zitten");
});

console.log(`\nAlle ${n} enforce-vlagstand-tests groen.`);
