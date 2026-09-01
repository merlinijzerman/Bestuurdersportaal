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
import { heeftVervullingspad } from "./requirement-bron";

export interface AffordanceContext {
  slotAan: boolean;
  alleenLezen: boolean;
}

/** De reden waarom een type géén koppel-affordance heeft, of null als het er wél
 *  een hoort te hebben. `field` vult via een veldwaarde/governance-event (geen
 *  koppelbare bron); de typen-zonder-vervullingspad (evaluation, ai_validation —
 *  besluit 0195) tonen de affordance uitgeschakeld MÉT deze reden i.p.v. niets. */
export function redenGeenKoppelAffordance(type: RequirementType): string | null {
  if (type === "field") return null; // field toont sowieso geen koppelknop (geen reden nodig)
  if (heeftVervullingspad(type)) return null;
  if (type === "evaluation") return "Evaluaties kunnen nog niet in het portaal worden vastgelegd.";
  if (type === "ai_validation") return "AI-validaties kunnen nog niet los worden opgevoerd.";
  return "Voor dit type bestaat nog geen manier om een feit vast te leggen.";
}

/** Mag deze gebruiker een gebonden feit LOSMAKEN van de vereiste? Onder slot: nee. */
export function magLosmaken(
  ctx: AffordanceContext & { bronType: string | null; kanBeheren: boolean }
): boolean {
  if (!ctx.kanBeheren || ctx.alleenLezen) return false;
  // field/classificatie vult via een governance-event: geen koppelbare bron.
  if (ctx.bronType === "governance_event") return false;
  // I1: onder een vaststellende besluitstatus is losmaken de dichte deur.
  if (ctx.slotAan) return false;
  return true;
}

/** Mag deze gebruiker een artefact KOPPELEN aan de vereiste? Ook onder slot ja
 *  (eerste binding voegt toe). `field` kent geen koppelbare bron, en typen zónder
 *  vervullingspad (evaluation, ai_validation — besluit 0195) hebben geen actieve
 *  koppel-affordance: de UI toont die uitgeschakeld mét reden
 *  (`redenGeenKoppelAffordance`) i.p.v. een altijd-lege kiezer. */
export function magKoppelen(
  ctx: AffordanceContext & { type: RequirementType; magBewijsKoppelen: boolean }
): boolean {
  // Het koppelen van bewijs is proceswerk, geen beheer van de vereiste zelf.
  // Een bestuurslid met `procedures.manage` mag dus een document opvoeren en
  // aan de bestaande eis binden; het wijzigen of uitsluiten van die eis blijft
  // afzonderlijk onder `kanBeheren` vallen.
  if (!ctx.magBewijsKoppelen || ctx.alleenLezen) return false;
  if (ctx.type === "field") return false;
  if (!heeftVervullingspad(ctx.type)) return false;
  return true;
}
