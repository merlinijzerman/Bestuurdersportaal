import assert from "node:assert/strict";
import { parseLicentieGetal } from "./licentie-invoer";

const tests: Array<[string, () => void]> = [
  ["lege invoer blijft null", () => assert.equal(parseLicentieGetal(""), null)],
  ["HTML-decimale punt blijft een decimaal", () => assert.equal(parseLicentieGetal("5.32"), 5.32)],
  ["Nederlandse decimale komma wordt ondersteund", () => assert.equal(parseLicentieGetal("5,32"), 5.32)],
  ["Nederlandse duizendtalscheiding wordt ondersteund", () => assert.equal(parseLicentieGetal("2.400,50"), 2400.5)],
  ["ongeldige invoer levert NaN", () => assert.equal(Number.isNaN(parseLicentieGetal("geen getal")), true)],
];

console.log("licentie-invoer sanity-tests:");
for (const [naam, test] of tests) {
  test();
  console.log(`  ✓ ${naam}`);
}
console.log(`\n${tests.length}/${tests.length} groen.`);
