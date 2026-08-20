// Identiteit van een procedure-vereiste, als één stabiele tekstsleutel.
//
// Waarom een sleutel en geen id: vereisten komen uit twee tabellen
// (`procedure_requirements` = globale template-configuratie,
// `procedure_requirement_instance` = per Decision Object). Er is dus geen
// gedeelde primaire sleutel om naar te verwijzen. Bovendien wordt de
// template-set bij elke seed-regeneratie ge-delete en opnieuw ingevoegd
// (zie `procedure-requirements-seed.ts`), waardoor ids per definitie
// instabiel zijn — een FK zou lopende procedures laten meebewegen met een
// latere templatewijziging (guardrail: snapshot-integriteit).
//
// De identiteit `coalesce(documenttype, label)` is niet nieuw: hij staat al
// in de unieke index `idx_req_uniek` op `procedure_requirements` en in
// `procedure_requirement_uitsluiting.match_sleutel`. Deze module maakt er
// één TS-definitie van, zodat uitsluiting en bewijsbinding niet uit elkaar
// kunnen lopen.
//
// Puur en deterministisch: geen trim, geen lowercase, geen normalisatie —
// de SQL-tegenhanger (`coalesce(documenttype, label)`) doet dat ook niet, en
// stille normalisatie zou de spiegeling TS ↔ SQL breken.

/**
 * De identiteit van een vereiste binnen (stap, requirement_type):
 * de documenttype-tag als die er is, anders het label.
 * Spiegelt `coalesce(documenttype, label)` in SQL.
 */
export function requirementIdentiteit(
  documenttype: string | null | undefined,
  label: string
): string {
  return documenttype ?? label;
}

/**
 * De volledige bindings-/matchsleutel van een vereiste binnen één procedure:
 * `stap_volgorde|requirement_type|identiteit`.
 *
 * Gebruikt door (a) het uitsluitingsfilter in `decision.ts`, (b) de
 * bewijs↔vereiste-binding in `procedure_bewijs.requirement_sleutel`, en (c)
 * de document-tak van `fn_decision_readiness_check`, die dezelfde string in
 * SQL samenstelt.
 */
export function requirementSleutel(
  stapVolgorde: number,
  requirementType: string,
  documenttype: string | null | undefined,
  label: string
): string {
  return `${stapVolgorde}|${requirementType}|${requirementIdentiteit(
    documenttype,
    label
  )}`;
}

/**
 * Vereiste-typen die met een bewijsstuk vervuld kunnen worden. Spiegelt
 * `v_type` in fn_decision_readiness_check en de document-tak in decision.ts.
 * Staat hier (en niet in bewijs-binding.ts) zodat de client-component
 * StapPaneel hem kan importeren zonder de server-only bindingsmodule.
 */
export const BINDBARE_REQUIREMENT_TYPES = [
  "document",
  "external_submission",
  "consultation",
] as const;
