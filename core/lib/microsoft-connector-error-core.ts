export const MICROSOFT_KOPPEL_FOUTCATEGORIEEN = [
  "oauth_transactie",
  "oauth_decryptie",
  "token_exchange",
  "identity_validation",
  "graph_me",
  "vault_save",
  "onverwachte_fout",
] as const;

export const MICROSOFT_TEST_FOUTCATEGORIEEN = [
  "test_cache_read",
  "test_cache_decryptie",
  "test_account_lookup",
  "test_silent_token",
  "test_graph_me",
  "test_cache_save",
  "test_status_save",
  "test_onverwachte_fout",
] as const;

export type MicrosoftKoppelFoutcategorie = typeof MICROSOFT_KOPPEL_FOUTCATEGORIEEN[number];
export type MicrosoftTestFoutcategorie = typeof MICROSOFT_TEST_FOUTCATEGORIEEN[number];
export type MicrosoftConnectorFoutcategorie = MicrosoftKoppelFoutcategorie | MicrosoftTestFoutcategorie;

export class MicrosoftConnectorError extends Error {
  readonly categorie: MicrosoftConnectorFoutcategorie;

  constructor(categorie: MicrosoftConnectorFoutcategorie, oorzaak?: unknown) {
    super(`Microsoft-koppeling mislukt in fase: ${categorie}`, { cause: oorzaak });
    this.name = "MicrosoftConnectorError";
    this.categorie = categorie;
  }
}

export function microsoftKoppelfoutcategorie(fout: unknown): MicrosoftKoppelFoutcategorie {
  return fout instanceof MicrosoftConnectorError
    && (MICROSOFT_KOPPEL_FOUTCATEGORIEEN as readonly string[]).includes(fout.categorie)
    ? fout.categorie as MicrosoftKoppelFoutcategorie
    : "onverwachte_fout";
}

export function microsoftTestFoutcategorie(fout: unknown): MicrosoftTestFoutcategorie {
  return fout instanceof MicrosoftConnectorError
    && (MICROSOFT_TEST_FOUTCATEGORIEEN as readonly string[]).includes(fout.categorie)
    ? fout.categorie as MicrosoftTestFoutcategorie
    : "test_onverwachte_fout";
}
