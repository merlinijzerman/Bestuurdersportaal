// P3 (#168) — de stapkolom beschrijft de laatste afronding. Zolang de vlag
// `afgerond_met_afwijking` waar is, blijft de opvolging als aandachtspunt in het
// procesoverzicht staan. Deze afleiding is bewust klein en puur, zodat het
// overzicht geen tweede (en afwijkende) betekenis voor een afwijking invoert.

export type AfwijkingsStap = {
  afgerond_met_afwijking: boolean;
};

export function telAfwijkingenMetOpenOpvolging(
  stappen: readonly AfwijkingsStap[]
): number {
  return stappen.filter((stap) => stap.afgerond_met_afwijking).length;
}

export function afwijkingOpvolgingTekst(aantal: number): string | null {
  if (aantal <= 0) return null;
  return aantal === 1
    ? "Stap afgerond met afwijking; opvolging open"
    : `${aantal} stappen afgerond met afwijking; opvolging open`;
}
