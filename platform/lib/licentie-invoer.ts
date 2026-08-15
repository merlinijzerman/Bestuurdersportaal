// Pure invoerhelpers voor het platform-licentieformulier.
// Los van de server action gehouden zodat de decimaalnormalisatie sanity-testbaar is.

/** Parseert een optioneel euro-/tariefveld met punt of komma als decimaalteken. */
export function parseLicentieGetal(waarde: FormDataEntryValue | null): number | null {
  const ruw = (waarde ?? "").toString().trim();
  if (ruw === "") return null;

  // HTML number-inputs leveren een decimale punt. Handmatig/alternatief aangeleverde
  // Nederlandse invoer mag een komma gebruiken. Bij beide tekens behandelen we
  // punten als duizendtalscheiding: "2.400,50" -> 2400.5.
  const genormaliseerd = ruw.includes(",")
    ? ruw.replace(/\./g, "").replace(",", ".")
    : ruw;
  const getal = Number(genormaliseerd);
  return Number.isFinite(getal) ? getal : NaN;
}
