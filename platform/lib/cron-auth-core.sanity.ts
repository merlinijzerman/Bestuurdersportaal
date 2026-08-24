// ============================================================================
//  Sanity-tests voor de pure cron-bearer-beoordeling (W5b PR 2, #103).
//  Uitvoeren: npx tsx platform/lib/cron-auth-core.sanity.ts
// ============================================================================
import assert from "node:assert/strict";
import { beoordeelCronBearer, CRON_SECRET_MIN_LENGTE } from "./cron-auth-core";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}
console.log("cron-auth-core sanity-tests:");

const langGenoeg = "a".repeat(CRON_SECRET_MIN_LENGTE); // precies op de grens
const teKort = "a".repeat(CRON_SECRET_MIN_LENGTE - 1); // net eronder
const bearer = (s: string) => `Bearer ${s}`;

test("een geldig, lang genoeg secret met correcte bearer wordt geaccepteerd", () => {
  assert.equal(beoordeelCronBearer({ secret: langGenoeg, authHeader: bearer(langGenoeg) }), true);
});

test("ENTROPIE-ONDERGRENS: een te kort secret wordt geweigerd, ook met correcte bearer", () => {
  // De kern van deliverable 3. Zonder de ondergrens zou dit true zijn (de bearer
  // matcht immers); mét de ondergrens is een te zwak secret fail-closed.
  assert.equal(beoordeelCronBearer({ secret: teKort, authHeader: bearer(teKort) }), false);
});

test("de grens ligt op CRON_SECRET_MIN_LENGTE (net eronder faalt, precies erop slaagt)", () => {
  assert.equal(beoordeelCronBearer({ secret: teKort, authHeader: bearer(teKort) }), false);
  assert.equal(beoordeelCronBearer({ secret: langGenoeg, authHeader: bearer(langGenoeg) }), true);
  assert.ok(CRON_SECRET_MIN_LENGTE >= 32, "de ondergrens mag niet stil onder 32 zakken");
});

test("ontbrekend secret → geweigerd (bestaand fail-closed gedrag, ongewijzigd)", () => {
  assert.equal(beoordeelCronBearer({ secret: null, authHeader: bearer(langGenoeg) }), false);
  assert.equal(beoordeelCronBearer({ secret: undefined, authHeader: bearer(langGenoeg) }), false);
  assert.equal(beoordeelCronBearer({ secret: "", authHeader: bearer(langGenoeg) }), false);
});

test("ontbrekende of verkeerde header → geweigerd", () => {
  assert.equal(beoordeelCronBearer({ secret: langGenoeg, authHeader: null }), false);
  assert.equal(beoordeelCronBearer({ secret: langGenoeg, authHeader: "" }), false);
  assert.equal(beoordeelCronBearer({ secret: langGenoeg, authHeader: bearer("iets anders") }), false);
  assert.equal(beoordeelCronBearer({ secret: langGenoeg, authHeader: langGenoeg }), false); // zonder "Bearer "
});

console.log(`\nAlle ${n} cron-auth-core sanity-tests groen.`);
