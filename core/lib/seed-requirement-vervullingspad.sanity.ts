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
  "supabase/seeds/schema/2026_08_13_invaar_requirements_seed.sql",
  "supabase/seeds/schema/2026_08_14_invaar_requirements_seed_v2.sql",
];

// 2026-05-08 is een historische, al toegepaste seedmigratie en daarmee geen
// actuele definitie. Besluit 0195 corrigeert de toen gepubliceerde rij(en) met
// een nieuwe voorwaartse migratie; deze test borgt dat die correctie niet stil
// uit de migratieset verdwijnt.
const legacySeedBestand =
  "supabase/migrations/2026_05_08_phase_1b_template_requirements.sql";
const legacyCorrectieBestand =
  "supabase/migrations/2026_08_29_zz_0195_verwijder_onvervulbare_templatevereisten.sql";
const legacyCorrectieRollbackBestand =
  "supabase/rollbacks/2026_08_29_zz_0195_verwijder_onvervulbare_templatevereisten_ROLLBACK.sql";

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

const legacyInhoud = readFileSync(join(process.cwd(), legacySeedBestand), "utf8");
const legacyTypesZonderPad = [...legacyInhoud.matchAll(requirementTypeInRij)]
  .map((match) => match[1] as RequirementType)
  .filter((type) => !heeftVervullingspad(type));
const correctieInhoud = readFileSync(join(process.cwd(), legacyCorrectieBestand), "utf8");
const rollbackInhoud = readFileSync(
  join(process.cwd(), legacyCorrectieRollbackBestand),
  "utf8"
);

assert.ok(
  legacyTypesZonderPad.includes("evaluation"),
  `${legacySeedBestand}: de #228-doelrij ontbreekt onverwacht; wijzig 0195 bewust`
);
assert.match(
  correctieInhoud,
  /stap_volgorde = 6[\s\S]*requirement_type = 'evaluation'[\s\S]*label = 'Evaluatiemoment gepland'/,
  `${legacyCorrectieBestand}: mist de exact gerichte voorwaartse verwijdering voor #228`
);
for (const [pad, inhoud] of [
  [legacyCorrectieBestand, correctieInhoud],
  [legacyCorrectieRollbackBestand, rollbackInhoud],
] as const) {
  assert.doesNotMatch(
    inhoud.replace(/^--.*$/gm, ""),
    /session_replication_role/,
    `${pad}: I7 mag niet via session_replication_role worden omzeild`
  );
  assert.match(
    inhoud,
    /v_gepinde_dossiers not in \(0, 3\)/,
    `${pad}: mist de fail-closed 0195-uitzondering voor exact 0 (Preview) of 3 (productie) gepinde 1.0.0-dossiers`
  );
  assert.match(
    inhoud,
    /tgname = 'trg_req_versievast'[\s\S]*tgenabled = 'O'/,
    `${pad}: moet vóór commit bewijzen dat I7 weer actief is`
  );
}

console.log(
  `seed-requirement-vervullingspad: ${seedBestanden.length} actuele seeddefinities zonder onvervulbare requirement-typen; legacy-correctie 0195 geborgd.`
);
