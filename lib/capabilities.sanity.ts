// ============================================================
//  Sanity-tests voor het capability-model (besluit 0006 B11).
//
//  De DB-read (requireCapability) is niet pure-TS testbaar; de
//  autorisatie-LOGICA zit in de pure mapping rolHeeftCapability. Die toetsen we
//  hier 1-op-1 tegen de eis uit het ticket (§7/§14 punt 5): beheerder mag
//  catalog.manage; bestuurder/voorzitter niet.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/capabilities.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { rolHeeftCapability, ROL_CAPABILITIES } from "./capabilities";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("capability sanity-tests:");

test("beheerder heeft catalog.manage", () => {
  assert.equal(rolHeeftCapability("beheerder", "catalog.manage"), true);
});

test("bestuurder heeft GEEN catalog.manage", () => {
  assert.equal(rolHeeftCapability("bestuurder", "catalog.manage"), false);
});

test("voorzitter heeft GEEN catalog.manage", () => {
  assert.equal(rolHeeftCapability("voorzitter", "catalog.manage"), false);
});

test("onbekende rol heeft geen capabilities", () => {
  assert.equal(rolHeeftCapability("auditor", "catalog.manage"), false);
});

test("null/undefined rol is veilig (geen capability)", () => {
  assert.equal(rolHeeftCapability(null, "catalog.manage"), false);
  assert.equal(rolHeeftCapability(undefined, "catalog.manage"), false);
});

test("alle drie de bekende rollen staan in de mapping", () => {
  for (const rol of ["beheerder", "voorzitter", "bestuurder"]) {
    assert.ok(rol in ROL_CAPABILITIES, `${rol} ontbreekt in mapping`);
  }
});

console.log(`\n${n} sanity-tests geslaagd.`);
