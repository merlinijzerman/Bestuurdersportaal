// Seeddefinities mogen geen requirement-type publiceren waarvoor de runtime
// geen vervullingspad heeft. Daarmee is #228 geen eenmalige correctie maar een
// fail-closed contract tussen de definitielaag en de huidige runtime.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALLE_REQUIREMENT_TYPES,
  heeftVervullingspad,
} from "./requirement-bron";
import type { RequirementType } from "./decision-view";

const seedBestanden = [
  "supabase/migrations/2026_05_08_phase_1b_template_requirements.sql",
  "supabase/seeds/schema/2026_08_13_invaar_requirements_seed.sql",
  "supabase/seeds/schema/2026_08_14_invaar_requirements_seed_v2.sql",
];

// De drie seedvormen dragen steeds (template_code, [template_versie,]
// stap_volgorde, requirement_type, ...). Lees uitsluitend de VALUES-rijen;
// comments en de kolomnaam mogen de poort niet beïnvloeden.
const requirementTypeInRij =
  /^\s*\(\s*'[^']+'\s*,\s*(?:'[^']+'\s*,\s*)?\d+\s*,\s*'([^']+)'\s*,/gm;

for (const relatiefPad of seedBestanden) {
  const inhoud = readFileSync(join(process.cwd(), relatiefPad), "utf8");
  const types = [...inhoud.matchAll(requirementTypeInRij)].map((match) => match[1]);

  assert.ok(types.length > 0, `${relatiefPad}: geen requirement-rijen herkend`);
  for (const type of types) {
    assert.ok(
      ALLE_REQUIREMENT_TYPES.includes(type as RequirementType),
      `${relatiefPad}: onbekend requirement-type ${type}`
    );
    assert.ok(
      heeftVervullingspad(type as RequirementType),
      `${relatiefPad}: ${type} heeft geen runtime-vervullingspad en mag niet in een seeddefinitie staan`
    );
  }
}

console.log(
  `seed-requirement-vervullingspad: ${seedBestanden.length} seeddefinities zonder onvervulbare requirement-typen.`
);
