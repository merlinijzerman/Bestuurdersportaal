// Requirements-seed-generator — leidt de procedure_requirements-seed-SQL af
// uit de canonieke JSON-definitie. Zo blijft de JSON de single source of
// truth en kan een drift-sanity (procedure-requirements-seed.sanity.ts)
// bewaken dat de gecommitte migratie exact overeenkomt met de definitie.
//
// Puur en deterministisch (geen tijd/random), zodat de output stabiel is.

import type { ProcedureDefinitie } from "./procedure-definitie";
import { requirementIdentiteit } from "./requirement-sleutel";

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
    // Bindings-/matchsleutel bewaken. De identiteit coalesce(documenttype,
    // label) draagt drie dingen: de unieke index idx_req_uniek, de
    // uitsluiting (match_sleutel) én sinds 2026-08-18 de bewijsbinding
    // (procedure_bewijs.requirement_sleutel). Een lege of dubbele identiteit
    // binnen dezelfde stap maakt een vereiste onadresseerbaar of laat één
    // bewijsstuk twee vereisten vervullen — precies de fout die de
    // bewijsmatching-fix opruimt. Faal hier, vóórdat de seed in de DB belandt.
    const gezien = new Set<string>();
    for (const r of stap.requirements) {
      const identiteit = requirementIdentiteit(r.documenttype ?? null, r.label);
      if (identiteit.trim() === "") {
        throw new Error(
          `stap ${stap.volgorde}, requirement '${r.requirement_type}': ` +
            `lege matchsleutel (documenttype én label zijn leeg)`
        );
      }
      const sleutel = `${r.requirement_type}|${identiteit}`;
      if (gezien.has(sleutel)) {
        throw new Error(
          `stap ${stap.volgorde}: dubbele matchsleutel '${identiteit}' ` +
            `voor requirement_type '${r.requirement_type}'. ` +
            `coalesce(documenttype, label) moet uniek zijn binnen een stap.`
        );
      }
      gezien.add(sleutel);
      rows.push(
        `  (${sqlStr(def.code)}, ${sqlStr(def.versie)}, ${stap.volgorde}, ${sqlStr(r.requirement_type)}, ` +
          `${sqlStr(r.label)}, ${sqlStr(r.documenttype ?? null)}, ${sqlStr(r.veld_pad ?? null)}, ` +
          `${sqlBool(r.verplicht)}, ${sqlBool(r.blokkerend)}, ${sqlInt(r.min_aantal ?? 1)}, ` +
          `${sqlStr(r.vereist_validatie_domein ?? null)}, ${sqlStr(r.toelichting ?? null)})`
      );
    }
  }
  // P1b (#166): version-scoped delete — een nieuwe versie mag de rijen van een
  // oudere versie niet wegvegen (versievastheid). Idempotent binnen de versie
  // TOT publicatie: zodra (code, versie) in procedure_definitie_publicatie staat,
  // weigert de trigger deze delete/insert (dat is het gewenste I7-effect —
  // wijzigen = een nieuwe versie, zie besluit 0188).
  const deleteStmt =
    `delete from public.procedure_requirements\n` +
    ` where template_code = ${sqlStr(def.code)} and template_versie = ${sqlStr(def.versie)};`;
  // Een definitie zonder requirements levert alleen de (idempotente) delete —
  // een lege `values`-lijst zou ongeldige SQL zijn.
  if (rows.length === 0) return deleteStmt;
  return (
    deleteStmt +
    `\n\n` +
    `insert into public.procedure_requirements\n` +
    `  (template_code, template_versie, stap_volgorde, requirement_type, label, documenttype,\n` +
    `   veld_pad, verplicht, blokkerend, min_aantal, vereist_validatie_domein,\n` +
    `   toelichting)\n` +
    `values\n` +
    rows.join(",\n") +
    `;`
  );
}
