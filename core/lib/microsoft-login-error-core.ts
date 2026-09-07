// ============================================================================
//  core/lib/microsoft-login-error-core.ts — PURE foutcategorieën Microsoft-login
//  (fase 1B, #335 T2, besluit 0211). Geen I/O, geen server-imports.
// ----------------------------------------------------------------------------
//  Intern kent de flow veel categorieën (audit, runtime-log, supportcode). Extern
//  bestaan er precies TWEE oppervlakken met vaste, neutrale teksten:
//    • loginscherm  — één melding voor élke mislukte Microsoft-login (V11: ook
//                     voor het bestaande `?error=auth_callback`); geen onderscheid
//                     onbekend account / andere tenant / gast / ingetrokken / pending.
//    • profielkaart — drie meldingen (koppelen mislukt · reservering verlopen ·
//                     ontkoppelen niet afgerond).
//  Ruwe provider-, GoTrue- of databasemeldingen bereiken de gebruiker nooit.
// ============================================================================

import { LOGIN_GATEWAY_FOUTCATEGORIEEN, type LoginGatewayFoutcategorie } from "@/core/lib/microsoft-login-binding-core";

export const MICROSOFT_LOGIN_FOUTCATEGORIEEN = [
  // configuratie / infrastructuur
  "config_ontbreekt",
  "discovery_fout",
  "jwks_fout",
  "gateway_db_onbereikbaar",
  "gateway_fout",
  // flow / transactie
  "transactie_ongeldig",
  "host_mismatch",
  "geweigerd_door_gebruiker",
  "token_exchange",
  "token_response_ongeldig",
  "handtekening_ongeldig",
  // claims
  "claim_iss",
  "claim_aud",
  "claim_exp",
  "claim_ver",
  "claim_nonce",
  "claim_tid",
  "claim_msa",
  "claim_idp",
  "claim_acct",
  "claim_oid_sub",
  // binding / sessie
  "binding_ontbreekt",
  "fonds_mismatch",
  "login_uit",
  "tenant_mismatch",
  "binding_conflict",
  "ongeldige_overgang",
  "onbekende_binding",
  "pending_verlopen",
  "profiel_ontbreekt",
  "sessie_mismatch",
  "identiteit_mismatch",
  "hook_geweigerd",
  "link_geweigerd",
  "activering_mislukt",
  "unlink_mislukt",
  "onverwachte_fout",
] as const;
export type MicrosoftLoginFoutcategorie = (typeof MICROSOFT_LOGIN_FOUTCATEGORIEEN)[number];

export function isMicrosoftLoginFoutcategorie(v: unknown): v is MicrosoftLoginFoutcategorie {
  return typeof v === "string" && (MICROSOFT_LOGIN_FOUTCATEGORIEEN as readonly string[]).includes(v);
}

/** Categorieën die de gebruiker niets over zijn account leren — ze zijn bewust
 *  ALLEMAAL op dezelfde externe melding afgebeeld (geen orakel). */
export class MicrosoftLoginError extends Error {
  readonly categorie: MicrosoftLoginFoutcategorie;
  constructor(categorie: MicrosoftLoginFoutcategorie, oorzaak?: unknown) {
    // Geen oorzaakinhoud in de message: die kan een providertekst of claim dragen.
    super(`Microsoft-login mislukt in fase: ${categorie}`, oorzaak instanceof Error ? { cause: oorzaak } : undefined);
    this.name = "MicrosoftLoginError";
    this.categorie = categorie;
  }
}

/** Vertaalt een willekeurige fout naar een vaste categorie. Een gatewayfout
 *  (T1, `MicrosoftLoginGatewayError.categorie`) wordt 1-op-1 overgenomen; alles
 *  wat niet herkend wordt is `onverwachte_fout`. Nooit een ruwe melding. */
export function microsoftLoginFoutcategorie(fout: unknown): MicrosoftLoginFoutcategorie {
  if (fout instanceof MicrosoftLoginError) return fout.categorie;
  const cat = (fout as { categorie?: unknown } | null)?.categorie;
  if (typeof cat === "string" && (LOGIN_GATEWAY_FOUTCATEGORIEEN as readonly string[]).includes(cat)) {
    return cat as LoginGatewayFoutcategorie;
  }
  return "onverwachte_fout";
}

// ── Externe oppervlakken ─────────────────────────────────────────────────────

/** Loginscherm: één neutrale melding (V11) voor élke mislukte externe login —
 *  `?fout=microsoft` én het bestaande `?error=auth_callback` — zonder provider- of
 *  accountdetails, ongeacht de interne categorie. */
export const LOGIN_MICROSOFT_MELDING =
  "Inloggen is niet gelukt. Log in met uw e-mailadres en wachtwoord of probeer het later opnieuw; neem contact op met uw beheerder als het probleem aanhoudt.";

/** Querysleutel op /login: alleen de vaste waarde `microsoft` plus een supportcode. */
export const LOGIN_FOUT_PARAM = "fout";
export const LOGIN_FOUT_WAARDE = "microsoft";
export const SUPPORTCODE_PARAM = "sc";

/** Profielkaart: drie publieke codes, drie teksten. */
export const PROFIEL_MICROSOFT_LOGIN_CODES = ["koppelen", "verlopen", "ontkoppelen"] as const;
export type ProfielMicrosoftLoginCode = (typeof PROFIEL_MICROSOFT_LOGIN_CODES)[number];

export const PROFIEL_MICROSOFT_LOGIN_MELDINGEN: Readonly<Record<ProfielMicrosoftLoginCode, string>> = {
  koppelen:
    "Koppelen is niet gelukt. Controleer of dit Microsoft-account al aan een ander portaalaccount is gekoppeld, of neem contact op met uw beheerder.",
  verlopen: "De koppeling is verlopen. Start het koppelen opnieuw.",
  ontkoppelen: "Ontkoppelen is nog niet afgerond. Probeer het opnieuw.",
};

/** Beeldt een interne categorie af op de publieke profielcode. Alles wat geen
 *  verval of unlink is, is 'koppelen' — bewust grof. */
export function profielCodeVoor(categorie: MicrosoftLoginFoutcategorie): ProfielMicrosoftLoginCode {
  if (categorie === "pending_verlopen") return "verlopen";
  if (categorie === "unlink_mislukt") return "ontkoppelen";
  return "koppelen";
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
