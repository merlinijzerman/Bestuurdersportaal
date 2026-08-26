// #192 — de affordance-poort op UI-niveau, als PURE functies zodat het I1-slot
// toetsbaar is en een latere refactor het niet stil kan omzeilen.
//
// I1 (0189 §I1): onder een vaststellende besluitstatus mag een vervulling niet
// verdwijnen. Vertaald naar de kiezer-UI:
//   • koppelen (first-bind) BLIJFT toegestaan onder slot — het voegt een
//     vervulling TOE, dat is geen deur;
//   • losmaken is onder slot UITGESCHAKELD (deur a) — de UI toont 'vergrendeld',
//     en de koppelroute weigert het bovendien server-side (409).

import type { RequirementType } from "./decision-view";

export interface AffordanceContext {
  slotAan: boolean;
  kanBeheren: boolean;
  alleenLezen: boolean;
}

/** Mag deze gebruiker een gebonden feit LOSMAKEN van de vereiste? Onder slot: nee. */
export function magLosmaken(
  ctx: AffordanceContext & { bronType: string | null }
): boolean {
  if (!ctx.kanBeheren || ctx.alleenLezen) return false;
  // field/classificatie vult via een governance-event: geen koppelbare bron.
  if (ctx.bronType === "governance_event") return false;
  // I1: onder een vaststellende besluitstatus is losmaken de dichte deur.
  if (ctx.slotAan) return false;
  return true;
}

/** Mag deze gebruiker een artefact KOPPELEN aan de vereiste? Ook onder slot ja
 *  (eerste binding voegt toe). field en evaluation hebben geen koppel-affordance
 *  (veld resp. geen aanmaakpad — bevinding #198). */
export function magKoppelen(
  ctx: AffordanceContext & { type: RequirementType }
): boolean {
  if (!ctx.kanBeheren || ctx.alleenLezen) return false;
  if (ctx.type === "field" || ctx.type === "evaluation") return false;
  return true;
}
