// Requirements-seed-generator — leidt de procedure_requirements-seed-SQL af
// uit de canonieke JSON-definitie. Zo blijft de JSON de single source of
// truth en kan een drift-sanity (procedure-requirements-seed.sanity.ts)
// bewaken dat de gecommitte migratie exact overeenkomt met de definitie.
//
// Puur en deterministisch (geen tijd/random), zodat de output stabiel is.

import type { ProcedureDefinitie } from "./procedure-definitie";

function sqlStr(v: string | null | undefined): string {
  if (v === null || v === undefined) return "null";
  return "'" + v.replace(/'/g, "''") + "'";
}
function sqlBool(b: boolean): string {
  return b ? "true" : "false";
}
function sqlInt(n: number | null | undefined): string {
  return n === null || n === undefined ? "null" : String(n);
}

/**
 * Genereert het idempotente seed-blok (delete + insert) voor
 * `procedure_requirements` op basis van de requirements in de definitie.
 * Bevat GEEN begin/commit — dat staat in de migratie eromheen.
 */
export function genereerRequirementsSeed(def: ProcedureDefinitie): string {
  const rows: string[] = [];
  for (const stap of [...def.stappen].sort((a, b) => a.volgorde - b.volgorde)) {
    for (const r of stap.requirements) {
      rows.push(
        `  (${sqlStr(def.code)}, ${stap.volgorde}, ${sqlStr(r.requirement_type)}, ` +
          `${sqlStr(r.label)}, ${sqlStr(r.documenttype ?? null)}, ${sqlStr(r.veld_pad ?? null)}, ` +
          `${sqlBool(r.verplicht)}, ${sqlBool(r.blokkerend)}, ${sqlInt(r.min_aantal ?? 1)}, ` +
          `${sqlStr(r.vereist_validatie_domein ?? null)})`
      );
    }
  }
  const deleteStmt =
    `delete from public.procedure_requirements\n` +
    ` where template_code = ${sqlStr(def.code)};`;
  // Een definitie zonder requirements levert alleen de (idempotente) delete —
  // een lege `values`-lijst zou ongeldige SQL zijn.
  if (rows.length === 0) return deleteStmt;
  return (
    deleteStmt +
    `\n\n` +
    `insert into public.procedure_requirements\n` +
    `  (template_code, stap_volgorde, requirement_type, label, documenttype,\n` +
    `   veld_pad, verplicht, blokkerend, min_aantal, vereist_validatie_domein)\n` +
    `values\n` +
    rows.join(",\n") +
    `;`
  );
}
