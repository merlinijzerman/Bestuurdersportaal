// Pure providerfout-classificatie. Bewust los van SDK-types: zowel Anthropic,
// Mistral als fetch-wrappers geven de HTTP-status via een structureel veld of
// alleen via de foutmelding door. De worker gebruikt dit uitsluitend om een
// permanente configuratiefout (ongeldige/ingetrokken sleutel) niet zinloos te
// retrien en direct zichtbaar te maken als mislukte verwerking.

export function isProviderAuthenticatieFout(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (status === 401) return true;
  }

  const melding = error instanceof Error ? error.message : String(error ?? "");
  return /\b401\b|authentication_error|api key is invalid|invalid api key/i.test(melding);
}

/** Publicatiepoort voor contextuele indexatie. `metPrefix=false` is een bewuste
 * baseline-modus; `metPrefix=true` zonder sleutel is juist een configuratiefout. */
export function zijnVereistePrefixesVolledig(input: {
  metPrefix: boolean;
  keyBeschikbaar: boolean;
  aantalPrefixes: number;
  aantalChunks: number;
}): boolean {
  if (input.aantalChunks === 0 || !input.metPrefix) return true;
  return input.keyBeschikbaar && input.aantalPrefixes === input.aantalChunks;
}
