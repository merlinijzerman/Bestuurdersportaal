// ============================================================
//  Sanity-tests voor core/lib/procedure-requirements-seed.ts.
//
//  Drift-check (WO: CI-/seed-validatie): het GEGENEREERD-blok in de
//  requirements-seed-migratie moet EXACT overeenkomen met wat de generator
//  uit de canonieke JSON-definitie afleidt. Zo kan de DB-seed niet stil
//  divergeren van de definitie — dezelfde valkuil die het proceduremodule-
//  ontwerp bij template↔requirements benoemt.
// ============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { genereerRequirementsSeed } from "./procedure-requirements-seed";
import invaarJson from "../../definities/pensioenfondsen/pf_wtp_invaarbesluit@2.0.0.json";
import type { ProcedureDefinitie } from "./procedure-definitie";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const hier = dirname(fileURLToPath(import.meta.url));
// OB-E10: de gezaghebbende seed is nu 2026_08_14 (standaardset-bewijslast +
// toelichting). De 2026_08_13-seed is historisch (idempotent gesuperseded).
const migratiePad = join(
  hier,
  "../../supabase/migrations/2026_08_14_invaar_requirements_seed_v2.sql"
);

const START = "-- <<GEGENEREERD_UIT_DEFINITIE>>";
const EIND = "-- <</GEGENEREERD_UIT_DEFINITIE>>";

check("gegenereerd seed-blok komt exact overeen met de definitie", () => {
  const sql = readFileSync(migratiePad, "utf8");
  const i = sql.indexOf(START);
  const j = sql.indexOf(EIND);
  assert.ok(i >= 0 && j > i, "GEGENEREERD-markers niet gevonden in de migratie");
  const inhoud = sql.slice(i + START.length, j).trim();
  const verwacht = genereerRequirementsSeed(
    invaarJson as unknown as ProcedureDefinitie
  ).trim();
  assert.equal(
    inhoud,
    verwacht,
    "De seed-migratie loopt uit de pas met de JSON-definitie.\n" +
      "Regenereer het blok tussen de GEGENEREERD-markers uit de definitie."
  );
});

check("seed bevat één rij per requirement uit de definitie", () => {
  const def = invaarJson as unknown as ProcedureDefinitie;
  const aantal = def.stappen.reduce((s, st) => s + st.requirements.length, 0);
  const sql = genereerRequirementsSeed(def);
  const rijen = sql
    .split("\n")
    .filter((r) => r.trimStart().startsWith("('pf_wtp_invaarbesluit',"));
  assert.equal(rijen.length, aantal);
});

console.log(`\nprocedure-requirements-seed.sanity: ${n} checks groen.`);
