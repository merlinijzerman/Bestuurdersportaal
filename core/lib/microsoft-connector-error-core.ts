export const MICROSOFT_KOPPEL_FOUTCATEGORIEEN = [
  "oauth_transactie",
  "oauth_decryptie",
  "token_exchange",
  "identity_validation",
  "graph_me",
  "vault_save",
  "onverwachte_fout",
] as const;

export type MicrosoftKoppelFoutcategorie = typeof MICROSOFT_KOPPEL_FOUTCATEGORIEEN[number];

export class MicrosoftConnectorError extends Error {
  readonly categorie: MicrosoftKoppelFoutcategorie;

  constructor(categorie: MicrosoftKoppelFoutcategorie, oorzaak?: unknown) {
    super(`Microsoft-koppeling mislukt in fase: ${categorie}`, { cause: oorzaak });
    this.name = "MicrosoftConnectorError";
    this.categorie = categorie;
  }
}

export function microsoftKoppelfoutcategorie(fout: unknown): MicrosoftKoppelFoutcategorie {
  return fout instanceof MicrosoftConnectorError ? fout.categorie : "onverwachte_fout";
}
