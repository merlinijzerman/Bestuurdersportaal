// ============================================================================
//  CSS-contract voor het assistentpaneel.
// ----------------------------------------------------------------------------
//  Het paneel gebruikt het HTML-attribuut `hidden` voor de dichte stand, maar
//  de components-laag geeft hetzelfde element ook `display: flex`. Zonder een
//  specifiekere hidden-regel blijft het paneel daardoor visueel 400 px breed,
//  ook al melden React en aria-expanded dat het gesloten is.
// ============================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const verborgenRegel = css.match(/\.assistent-paneel\[hidden\]\s*\{([^}]*)\}/);

console.log("assistent-paneel-css sanity-tests:");

assert.ok(
  verborgenRegel,
  "de specifiekere .assistent-paneel[hidden]-regel ontbreekt",
);
assert.match(
  verborgenRegel[1],
  /display\s*:\s*none\s*;/,
  "een gesloten assistentpaneel moet display: none krijgen",
);

console.log("  ✓ hidden wint van display: flex");
console.log("\n1 sanity-test geslaagd.");
