// ============================================================================
//  renormaliseer.ts — herbereken normalisatie op bestaande output/units.json.
// ----------------------------------------------------------------------------
//  Draai:  ./node_modules/.bin/tsx scripts/spike-s1/renormaliseer.ts
//  Past de HUIDIGE normalisatieregels (concepts.ts) toe op de al geëxtraheerde
//  ruwe modeloutput (value_raw + evidence), ZONDER nieuwe API-calls. Zo isoleer
//  je het effect van een normalisatie-verbetering (schone ablatie: zelfde ruwe
//  extracties, andere normalisatie). `evidence_ok` blijft ongewijzigd — die vergt
//  de paginatekst en is bij de extractie al bepaald.
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Unit } from "./types";
import { conceptDef, normaliseer } from "./concepts";

const HIER = dirname(fileURLToPath(import.meta.url));
const pad = join(HIER, "output", "units.json");

const units: Unit[] = JSON.parse(readFileSync(pad, "utf8"));
let gewijzigd = 0;

for (const u of units) {
  const def = conceptDef(u.concept);
  if (!def) continue;
  const norm = normaliseer(def, u.value_raw, u.evidence);
  const voor = JSON.stringify([u.value_normalized, u.currency, u.norm_ok]);
  u.value_normalized = norm.value;
  u.currency = norm.currency;
  u.norm_ok = norm.ok;
  if (JSON.stringify([u.value_normalized, u.currency, u.norm_ok]) !== voor) gewijzigd++;
}

writeFileSync(pad, JSON.stringify(units, null, 2));
console.log(
  `Hernormaliseerd: ${units.length} unit(s), ${gewijzigd} gewijzigd. → output/units.json`
);
