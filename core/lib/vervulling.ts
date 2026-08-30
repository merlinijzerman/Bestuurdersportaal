// Vervulling per vereiste (P2, #167) — de kern van D10: een vereiste is vervuld
// door een POSITIEF, GEBONDEN feit, nooit door afwezigheid of een afleiding.
//
// `vervuld = count(gebonden feiten met de sleutel) >= min_aantal`. Puur en type-
// generiek: één gelijkheidstest op de sleutel, geen per-type matchlogica meer.
// `field` is de gemotiveerde uitzondering (geen gebonden feit maar een veld of het
// governance-event classificatie_bevestigd) en wordt hier NOOIT via binding vervuld
// verklaard — die toets leeft apart in buildEvidenceLijst.

import { REQUIREMENT_BRON } from "./requirement-bron";
import type { RequirementType } from "./decision-view";

/**
 * Vervuldheid van een vereiste op basis van het aantal aan díe vereiste gebonden
 * feiten (gelijkheid op requirement_sleutel, geteld op de dossier-lokale scope) en
 * `min_aantal`. `field` → altijd false (geen gebonden feit; PR-B behandelt veld/event).
 */
export function vervuldViaBinding(
  type: RequirementType,
  aantalGebondenFeiten: number,
  minAantal: number | null | undefined
): boolean {
  if (REQUIREMENT_BRON[type] === null) return false; // field: niet via een gebonden feit
  return aantalGebondenFeiten >= Math.max(1, minAantal ?? 1);
}
