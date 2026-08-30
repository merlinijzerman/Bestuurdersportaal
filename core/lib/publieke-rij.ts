/**
 * Houd interne fulfilmentmetadata uit bestaande API-contracten zolang er geen
 * binding bestaat. De P2-kolom is optioneel; een expliciete `null` zou anders
 * elk historisch response-object uitbreiden zonder functionele betekenis.
 */
export function zonderLegeRequirementSleutel<T extends Record<string, unknown>>(
  rij: T
): T {
  if (rij.requirement_sleutel !== null) return rij;

  const { requirement_sleutel: _weggelaten, ...publiek } = rij;
  return publiek as T;
}
