// ============================================================================
//  Sanity-tests voor de pure tenant-enforce-beoordeling (T1.3, besluit 0042).
//  De host→fonds-resolutie zelf is al in tenant-host.sanity.ts gedekt; hier
//  testen we alleen de fail-closed toegangslogica.
//
//  Uitvoeren: npx tsx lib/tenant-enforce.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { beoordeelToegang } from "./tenant-enforce";
import type { FondsResolutie } from "./tenant-host";

const gevonden = (fondsId: string): FondsResolutie => ({ type: "gevonden", fondsId });
const onbekend: FondsResolutie = { type: "onbekend" };

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("tenant-enforce sanity-tests:");

test("enforce uit → altijd toegestaan (observe-fase, ook bij mismatch)", () => {
  assert.deepEqual(
    beoordeelToegang({ resolutie: onbekend, sessieFondsId: "fonds-a", enforce: false }),
    { toegestaan: true }
  );
  assert.deepEqual(
    beoordeelToegang({ resolutie: gevonden("fonds-b"), sessieFondsId: "fonds-a", enforce: false }),
    { toegestaan: true }
  );
});

test("enforce aan + host-fonds == sessie-fonds → toegestaan", () => {
  assert.deepEqual(
    beoordeelToegang({ resolutie: gevonden("fonds-a"), sessieFondsId: "fonds-a", enforce: true }),
    { toegestaan: true }
  );
});

test("enforce aan + onbekende host → weiger (onbekende-host)", () => {
  assert.deepEqual(
    beoordeelToegang({ resolutie: onbekend, sessieFondsId: "fonds-a", enforce: true }),
    { toegestaan: false, reden: "onbekende-host" }
  );
});

test("enforce aan + host-fonds ≠ sessie-fonds → weiger (fonds-mismatch)", () => {
  assert.deepEqual(
    beoordeelToegang({ resolutie: gevonden("fonds-b"), sessieFondsId: "fonds-a", enforce: true }),
    { toegestaan: false, reden: "fonds-mismatch" }
  );
});

test("enforce aan + gevonden host maar geen sessie-fonds → weiger (fonds-mismatch)", () => {
  assert.deepEqual(
    beoordeelToegang({ resolutie: gevonden("fonds-a"), sessieFondsId: null, enforce: true }),
    { toegestaan: false, reden: "fonds-mismatch" }
  );
});

console.log(`\n${n} sanity-tests geslaagd.`);
