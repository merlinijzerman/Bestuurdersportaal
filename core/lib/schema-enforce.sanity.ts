// ============================================================================
//  Sanity-tests voor de pure schemabeoordeling (W9, EPIC W, deploy 3).
//
//  Zonder I/O en zonder Next-runtime:
//    1. de env-schakelaar — en dat hij, net als capability-enforce, GEEN
//       omgevings-default kent (kale opt-in);
//    2. de beoordeling: "geen-body", een geldige body, en een mismatch met de
//       vijf observe-velden (veld + verwacht + gekregen).
//
//  Uitvoeren: npx tsx core/lib/schema-enforce.sanity.ts
// ============================================================================
import assert from "node:assert/strict";
import { z } from "zod";
import {
  beoordeelSchema,
  schemaEnforceVoorOmgeving,
} from "./schema-enforce";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("schema-enforce sanity-tests:");

// ── De env-schakelaar ────────────────────────────────────────────────────────

test("alleen ENFORCE_SCHEMA=on zet de poort aan (kale opt-in)", () => {
  assert.equal(schemaEnforceVoorOmgeving({ enforceSchema: "on" }), true);
  assert.equal(schemaEnforceVoorOmgeving({ enforceSchema: " ON " }), true);
  assert.equal(schemaEnforceVoorOmgeving({ enforceSchema: "off" }), false);
  assert.equal(schemaEnforceVoorOmgeving({ enforceSchema: "" }), false);
  assert.equal(schemaEnforceVoorOmgeving({ enforceSchema: null }), false);
  assert.equal(schemaEnforceVoorOmgeving({}), false);
});

// ── De beoordeling ───────────────────────────────────────────────────────────

test('"geen-body" is altijd toegestaan', () => {
  const o = beoordeelSchema({ schema: "geen-body", body: undefined });
  assert.equal(o.toegestaan, true);
});

test("een geldige body wordt toegestaan en levert data", () => {
  const schema = z.object({ titel: z.string().optional() }).passthrough();
  const o = beoordeelSchema({ schema, body: { titel: "x", extra: 1 } });
  assert.equal(o.toegestaan, true);
  assert.deepEqual((o as { data: unknown }).data, { titel: "x", extra: 1 });
});

test("een lege body wordt toegestaan bij een all-optioneel schema", () => {
  const schema = z.object({ titel: z.string().optional() }).passthrough();
  assert.equal(beoordeelSchema({ schema, body: {} }).toegestaan, true);
});

test("een mismatch levert veld + verwacht + gekregen (de observe-velden)", () => {
  const schema = z.object({ kans: z.number().optional() }).passthrough();
  const o = beoordeelSchema({ schema, body: { kans: "hoog" } });
  assert.equal(o.toegestaan, false);
  const fouten = (o as { fouten: Array<{ veld: string; verwacht: string; gekregen: string }> }).fouten;
  assert.equal(fouten.length >= 1, true);
  assert.equal(fouten[0].veld, "kans");
  assert.equal(fouten[0].verwacht, "number");
  assert.equal(fouten[0].gekregen, "string");
});

console.log(`\nAlle ${n} schema-enforce sanity-tests groen.`);
