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
const antwoordRegel = css.match(/\.assistent-antwoord\s*\{([^}]*)\}/);
const gesprekRegel = css.match(/\.assistent-gesprek\s*\{([^}]*)\}/);
const kopstatusRegel = css.match(/\.assistent-kopstatus\s*\{([^}]*)\}/);

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

assert.ok(antwoordRegel, "de assistent-antwoordregel ontbreekt");
assert.match(
  antwoordRegel[1],
  /color\s*:\s*var\(--assistant-copy\)\s*;/,
  "antwoordtekst moet het generieke assistent-copytoken gebruiken",
);
console.log("  ✓ antwoordtekst gebruikt in iedere module dezelfde tekstkleur");

assert.ok(gesprekRegel, "de assistent-gesprekregel ontbreekt");
assert.match(
  gesprekRegel[1],
  /background\s*:\s*var\(--assistant-canvas\)\s*;/,
  "het gesprek moet het generieke assistent-canvas gebruiken",
);
console.log("  ✓ gesprek gebruikt in iedere module hetzelfde contrastvlak");

assert.ok(kopstatusRegel, "de assistent-kopstatusregel ontbreekt");
assert.match(
  kopstatusRegel[1],
  /color\s*:\s*var\(--assistant-on-dark-muted\)\s*;/,
  "de kopstatus mag niet meekleuren met het fondsthema",
);
console.log("  ✓ secundaire koptekst blijft over modules heen gelijk");

console.log("\n4 sanity-tests geslaagd.");
