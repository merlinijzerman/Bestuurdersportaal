// ============================================================
//  Sanity-tests voor core/lib/startvragen.ts (P2 Deel A).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/startvragen.sanity.ts
//  Verifieert de vaste, generieke voorbeeldvragen: niet leeg, ontdubbeld,
//  vraagvorm (neutraal-kritisch), en geen «...»-verwijzing naar een specifiek
//  stuk/agendapunt (die horen bij de taakkaart "Een document doorgronden").
// ============================================================

import assert from "node:assert/strict";
import { GENERIEKE_STARTVRAGEN } from "./startvragen";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("startvragen sanity-tests:");

check("niet leeg en een hanteerbaar aantal", () => {
  assert.ok(GENERIEKE_STARTVRAGEN.length >= 1);
  assert.ok(GENERIEKE_STARTVRAGEN.length <= 6);
});

check("geen dubbele vragen", () => {
  assert.equal(new Set(GENERIEKE_STARTVRAGEN).size, GENERIEKE_STARTVRAGEN.length);
});

check("elke vraag is een vraagvorm (eindigt op ?)", () => {
  for (const v of GENERIEKE_STARTVRAGEN) assert.ok(v.trim().endsWith("?"), v);
});

check("geen «...»-verwijzing naar een specifiek stuk/agendapunt (generiek)", () => {
  for (const v of GENERIEKE_STARTVRAGEN) assert.ok(!v.includes("«"), v);
});

console.log(`\n${n} sanity-tests geslaagd.`);
