// ============================================================================
//  Pure afleiding voor de homepage-werkbak (§9.2).
// ----------------------------------------------------------------------------
//  Een werkbak bewaart niets zelf: deze module bepaalt uitsluitend de vaste,
//  uitlegbare presentatievolgorde van al bestaande werkzaamheden. De server
//  haalt de bronnen op in `werkbak.ts`; deze laag is bewust zonder I/O zodat de
//  belofte "achterstallig nooit verbergen" afzonderlijk toetsbaar blijft.
// ============================================================================

export type WerkbakSoort = "actie" | "stap" | "vergadering";

export interface WerkbakItem {
  id: string;
  soort: WerkbakSoort;
  titel: string;
  herkomst: string;
  /** ISO-datum (YYYY-MM-DD), of null wanneer de bron geen datum kent. */
  deadline: string | null;
  href: string;
}

export const WERKBAK_RUSTPUNT = 7;

/** Een datum is alleen achterstallig vóór vandaag; vandaag zelf is nog op tijd. */
export function isAchterstallig(item: Pick<WerkbakItem, "deadline">, vandaag: string): boolean {
  return item.deadline !== null && item.deadline < vandaag;
}

/**
 * Vaste werkbakvolgorde: alle achterstallige items eerst, vervolgens op datum
 * en items zonder datum onderaan. Titel/id zijn slechts een stabiele tiebreaker
 * zodat een render niet willekeurig verspringt.
 */
export function sorteerWerkbak(items: readonly WerkbakItem[]): WerkbakItem[] {
  return [...items].sort((a, b) => {
    const datumA = a.deadline ?? "9999-12-31";
    const datumB = b.deadline ?? "9999-12-31";
    if (datumA !== datumB) return datumA.localeCompare(datumB);
    if (a.titel !== b.titel) return a.titel.localeCompare(b.titel, "nl");
    return a.id.localeCompare(b.id);
  });
}

/**
 * Toont elke achterstallige regel, óók als dat er meer dan zeven zijn. Daarna
 * vult de werkbak tot het rustpunt met de eerstvolgende werkzaamheden aan.
 */
export function eersteWerkbakItems(
  items: readonly WerkbakItem[],
  vandaag: string,
  rustpunt = WERKBAK_RUSTPUNT
): WerkbakItem[] {
  const gesorteerd = sorteerWerkbak(items);
  const achterstallig = gesorteerd.filter((item) => isAchterstallig(item, vandaag));
  const overig = gesorteerd.filter((item) => !isAchterstallig(item, vandaag));
  return [...achterstallig, ...overig.slice(0, Math.max(0, rustpunt - achterstallig.length))];
}
