// ============================================================================
//  Kleine-populatie-suppressie (T11, v0.4 §13 / decisions/0055).
// ----------------------------------------------------------------------------
//  Een KPI/cel over een kleine populatie kan indirect identificerend zijn
//  (herleidbaarheid bij kleine aantallen). Deze pure laag onderdrukt waarden
//  waarvan de celgrootte onder de vastgelegde drempel ligt. De drempel is
//  n<10 (conservatief; besluit 0055) en centraal geconfigureerd.
//
//  PUUR & ISOMORF: geen I/O, bruikbaar in server- én client-componenten en in
//  sanity-tests. De server-side leeslagen (lib/stuurinfo-bron.ts /
//  lib/klantbeeld-bron.ts) passen dit toe VÓÓR de data de client bereikt, zodat
//  een onderdrukte waarde ook niet in de payload lekt.
// ============================================================================

/** Minimale celgrootte; onder deze n wordt een waarde onderdrukt. Besluit 0055. */
export const SUPPRESSIE_DREMPEL = 10;

/** Zichtbaar masker voor een onderdrukte waarde (geen getal lekt). */
export const SUPPRESSIE_MASKER = "⋅";

/** Korte, herbruikbare toelichting bij een onderdrukte cel. */
export const SUPPRESSIE_LABEL = `onderdrukt (n<${SUPPRESSIE_DREMPEL})`;

/**
 * Is de celgrootte te klein om te tonen? Een ontbrekende teller (null/undefined)
 * betekent "geen telbare populatie" → NIET onderdrukken (bv. een financiële KPI
 * zonder personen-teller). Alleen een expliciete n < drempel wordt onderdrukt.
 */
export function isOnderdrukt(n: number | null | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n < SUPPRESSIE_DREMPEL;
}

/**
 * Geeft de waarde terug, of `null` wanneer de celgrootte onder de drempel ligt.
 * Generiek zodat het op getallen én afgeleide objecten werkt.
 */
export function maskeer<T>(waarde: T, n: number | null | undefined): T | null {
  return isOnderdrukt(n) ? null : waarde;
}

/** Presentatiehulp: toont het masker bij onderdrukking, anders de geformatteerde waarde. */
export function toonOfMasker(
  n: number | null | undefined,
  format: () => string
): string {
  return isOnderdrukt(n) ? SUPPRESSIE_MASKER : format();
}
