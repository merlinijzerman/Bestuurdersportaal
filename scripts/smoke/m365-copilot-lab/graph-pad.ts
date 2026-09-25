/**
 * Normaliseert de door Microsoft Graph teruggegeven paden zonder inhoud of
 * tenantgegevens vast te leggen. Ongeldige of besturingstekens falen dicht.
 */
export function normaliseerGraphPad(pad: string | null | undefined): string | null {
  const waarde = pad?.trim();
  if (!waarde) return null;
  try {
    const genormaliseerd = decodeURIComponent(waarde).normalize("NFC").replace(/\/+$/, "");
    return genormaliseerd && !/[\u0000-\u001f\u007f]/.test(genormaliseerd) ? genormaliseerd : null;
  } catch {
    return null;
  }
}

export function graphPadIsGelijkOfOnder(pad: string, rootPad: string): boolean {
  const vergelijking = pad.toLocaleLowerCase("nl");
  const rootVergelijking = rootPad.toLocaleLowerCase("nl");
  return vergelijking === rootVergelijking || vergelijking.startsWith(`${rootVergelijking}/`);
}
