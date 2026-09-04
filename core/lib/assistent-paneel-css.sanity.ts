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
const resultaatkaartRegel = css.match(/\.assistent-resultaatkaart\s*\{([^}]*)\}/);
const paneelRegel = css.match(/\.assistent-paneel\s*\{([^}]*)\}/);
const gesprekRegel = css.match(/\.assistent-gesprek\s*\{([^}]*)\}/);
const kopstatusRegel = css.match(/\.assistent-kopstatus\s*\{([^}]*)\}/);
const oppervlak = readFileSync(
  join(process.cwd(), "app", "(dashboard)", "ai", "_components", "AssistentOppervlak.tsx"),
  "utf8",
);
const voorbereidingKaart = readFileSync(
  join(
    process.cwd(),
    "app",
    "(dashboard)",
    "vergaderingen",
    "_components",
    "VoorbereidingKaart.tsx",
  ),
  "utf8",
);

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

assert.match(
  antwoordRegel[1],
  /font-size\s*:\s*0\.8625rem\s*;/,
  "antwoordtekst moet de 13,8px-tekstmaat uit het referentieprototype gebruiken",
);
assert.match(
  antwoordRegel[1],
  /line-height\s*:\s*1\.68\s*;/,
  "antwoordtekst moet de regelafstand uit het referentieprototype gebruiken",
);
assert.doesNotMatch(
  oppervlak,
  /assistent-antwoord[^"\n]*\b(?:text-sm|leading-relaxed)\b/,
  "Tailwind-utilities mogen de vaste antwoordtypografie niet overschrijven",
);
console.log("  ✓ tekstmaat en regelafstand volgen het referentieprototype");

assert.ok(resultaatkaartRegel, "de generieke AI-resultaatkaart ontbreekt");
assert.match(
  resultaatkaartRegel[1],
  /border\s*:\s*1px solid var\(--ai-line\)\s*;/,
  "AI-resultaatkaarten moeten de vaste assistentrand gebruiken",
);
assert.match(
  resultaatkaartRegel[1],
  /background\s*:\s*var\(--ai-tint\)\s*;/,
  "AI-resultaatkaarten moeten het rustige assistentvlak gebruiken",
);
assert.match(
  resultaatkaartRegel[1],
  /font-family\s*:\s*var\(--font-sans\)/,
  "AI-resultaatkaarten moeten hetzelfde lettertype als het assistentpaneel gebruiken",
);
console.log("  ✓ inline AI-uitkomsten volgen de kaartgrammatica van het prototype");

assert.match(
  voorbereidingKaart,
  /className="assistent-resultaatkaart"/,
  "Mijn voorbereiding moet de generieke AI-resultaatkaart gebruiken",
);
assert.ok(
  (voorbereidingKaart.match(/className="assistent-antwoord"/g) ?? []).length >= 2,
  "lopende en voltooide voorbereiding moeten de generieke antwoordtypografie gebruiken",
);
assert.doesNotMatch(
  voorbereidingKaart,
  /className="text-sm leading-relaxed text-ink"/,
  "Mijn voorbereiding mag geen lokale antwoordtypografie houden",
);
console.log("  ✓ Mijn voorbereiding erft dezelfde antwoordtypografie als het paneel");

assert.ok(paneelRegel, "de assistent-paneelregel ontbreekt");
assert.match(
  paneelRegel[1],
  /-webkit-font-smoothing\s*:\s*antialiased\s*;/,
  "het paneel moet dezelfde font-rendering als de Microsoft-referentie gebruiken",
);
assert.match(
  paneelRegel[1],
  /text-rendering\s*:\s*optimizeLegibility\s*;/,
  "het paneel moet dezelfde legibility-instelling als de Microsoft-referentie gebruiken",
);
console.log("  ✓ letterrendering volgt de Microsoft-referentie");

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

console.log("\n8 sanity-tests geslaagd.");
