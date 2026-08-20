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

// ── Bewijsbinding: de matchsleutel moet per stap niet-leeg en uniek zijn ──
//
// coalesce(documenttype, label) is de identiteit die de unieke index
// idx_req_uniek draagt, de per-proces uitsluiting én — sinds 2026-08-18 —
// de bewijs↔vereiste-binding. Botsen twee vereisten binnen één stap op die
// identiteit, dan vervult één bewijsstuk ze allebei. De generator hoort dat
// te weigeren in plaats van de fout de database in te schrijven.
function defMet(requirements: unknown[]): ProcedureDefinitie {
  return {
    code: "test_template",
    versie: "1.0.0",
    naam: "Test",
    fasen: [],
    stappen: [
      { volgorde: 1, naam: "Stap 1", checklist: [], requirements },
    ],
  } as unknown as ProcedureDefinitie;
}

check("generator weigert een dubbele matchsleutel binnen één stap", () => {
  assert.throws(
    () =>
      genereerRequirementsSeed(
        defMet([
          { requirement_type: "document", label: "Transitieplan", verplicht: true, blokkerend: true },
          { requirement_type: "document", label: "Transitieplan", verplicht: true, blokkerend: true },
        ])
      ),
    /dubbele matchsleutel/i
  );
});

check("generator weigert een lege matchsleutel", () => {
  assert.throws(
    () =>
      genereerRequirementsSeed(
        defMet([
          { requirement_type: "document", label: "   ", verplicht: true, blokkerend: true },
        ])
      ),
    /lege matchsleutel/i
  );
});

check("gelijke labels met verschillend documenttype botsen niet", () => {
  const sql = genereerRequirementsSeed(
    defMet([
      { requirement_type: "document", label: "Verslag", documenttype: "verslag_a", verplicht: true, blokkerend: true },
      { requirement_type: "document", label: "Verslag", documenttype: "verslag_b", verplicht: true, blokkerend: true },
    ])
  );
  assert.match(sql, /verslag_a/);
  assert.match(sql, /verslag_b/);
});

check("hetzelfde label in een ándere stap is toegestaan", () => {
  const def = {
    code: "test_template",
    versie: "1.0.0",
    naam: "Test",
    fasen: [],
    stappen: [
      {
        volgorde: 1,
        naam: "Stap 1",
        checklist: [],
        requirements: [
          { requirement_type: "document", label: "Verslag", verplicht: true, blokkerend: true },
        ],
      },
      {
        volgorde: 2,
        naam: "Stap 2",
        checklist: [],
        requirements: [
          { requirement_type: "document", label: "Verslag", verplicht: true, blokkerend: true },
        ],
      },
    ],
  } as unknown as ProcedureDefinitie;
  const rijen = genereerRequirementsSeed(def)
    .split("\n")
    .filter((r) => r.trimStart().startsWith("('test_template',"));
  assert.equal(rijen.length, 2);
});

console.log(`\nprocedure-requirements-seed.sanity: ${n} checks groen.`);
