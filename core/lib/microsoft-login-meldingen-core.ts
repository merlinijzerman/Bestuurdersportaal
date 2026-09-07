// ============================================================================
//  core/lib/microsoft-login-meldingen-core.ts — BROWSERVEILIGE publieke teksten,
//  URL-parameters en codes van de Microsoft-login (fase 1B, #335 T2).
// ----------------------------------------------------------------------------
//  Dit is de ENIGE microsoft-login-module die een "use client"-component mag
//  importeren. Hij importeert zelf NIETS (geen node:*, geen andere core-module),
//  zodat hij in de clientbundel terecht kan. De interne foutcategorieën en de
//  server-side afbeelding daarop leven in microsoft-login-error-core.ts (Node),
//  die deze module re-exporteert. De grens wordt bewaakt door
//  tests/cross-tenant/microsoft-login-t2-contract.test.ts (reviewbevinding PR #339:
//  een clientcomponent trok via error-core → binding-core `node:crypto` de
//  productiebuild om).
// ============================================================================

/** Loginscherm: één neutrale melding (V11) voor élke mislukte externe login —
 *  `?fout=microsoft` én het bestaande `?error=auth_callback` — zonder provider- of
 *  accountdetails, ongeacht de interne categorie. */
export const LOGIN_MICROSOFT_MELDING =
  "Inloggen is niet gelukt. Log in met uw e-mailadres en wachtwoord of probeer het later opnieuw; neem contact op met uw beheerder als het probleem aanhoudt.";

/** Querysleutels op /login: alleen de vaste waarde `microsoft` plus een supportcode. */
export const LOGIN_FOUT_PARAM = "fout";
export const LOGIN_FOUT_WAARDE = "microsoft";
export const SUPPORTCODE_PARAM = "sc";
/** Supportcode-vorm zoals de URL en de UI haar tonen (acht hoofdletters/cijfers). */
export const SUPPORTCODE_RE = /^[A-Z0-9]{8}$/;

/** Loginscherm, fase 1C (#344): het fonds staat op modus `verplicht` en GoTrue
 *  weigerde de wachtwoorduitgifte via de Auth-hook. Deze melding verschijnt pas
 *  ná geldige credentials en onderscheidt dus geen bestaande van niet-bestaande
 *  accounts — géén accountenumeratie. Zij zegt alleen wat de gebruiker moet doen. */
export const LOGIN_VERPLICHT_MELDING =
  "Voor deze omgeving logt u in met Microsoft. Gebruik de knop hieronder; neem contact op met uw beheerder als dat niet lukt.";

/** Profielkaart: vier publieke codes, vier teksten. */
export const PROFIEL_MICROSOFT_LOGIN_CODES = ["koppelen", "verlopen", "ontkoppelen", "beheer"] as const;
export type ProfielMicrosoftLoginCode = (typeof PROFIEL_MICROSOFT_LOGIN_CODES)[number];

export const PROFIEL_MICROSOFT_LOGIN_MELDINGEN: Readonly<Record<ProfielMicrosoftLoginCode, string>> = {
  koppelen:
    "Koppelen is niet gelukt. Controleer of dit Microsoft-account al aan een ander portaalaccount is gekoppeld, of neem contact op met uw beheerder.",
  verlopen: "De koppeling is verlopen. Start het koppelen opnieuw.",
  ontkoppelen: "Ontkoppelen is nog niet afgerond. Probeer het opnieuw.",
  // Fase 1C (#344): in modus `verplicht` beheert de organisatie de koppeling.
  beheer: "Uw organisatie beheert deze koppeling. Neem contact op met uw beheerder om opnieuw te koppelen.",
};

export function isProfielMicrosoftLoginCode(v: unknown): v is ProfielMicrosoftLoginCode {
  return typeof v === "string" && (PROFIEL_MICROSOFT_LOGIN_CODES as readonly string[]).includes(v);
}

/** Supportcode = eerste 8 tekens van de correlatie-id (UUID); geen inhoud. */
export function supportcode(correlatieId: string): string {
  return correlatieId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Woorden die in geen enkele externe melding mogen staan (contracttest §C6). */
export const VERBODEN_MELDINGWOORDEN = [
  "tenant",
  "gast",
  "ingetrokken",
  "onbekend account",
  "bestaat niet",
  "pending",
  "revok",
  "@",
  "token",
  "claim",
] as const;
