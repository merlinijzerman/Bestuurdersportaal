// ============================================================================
//  core/lib/microsoft-login-error-core.ts — PURE foutcategorieën Microsoft-login
//  (fase 1B, #335 T2, besluit 0211). Geen I/O; wél Node-afhankelijk via
//  binding-core (node:crypto) — daarom NOOIT in een "use client"-component
//  importeren. De browserveilige publieke teksten/codes staan in
//  microsoft-login-meldingen-core.ts en worden hier re-geëxporteerd voor de
//  server-kant.
// ----------------------------------------------------------------------------
//  Intern kent de flow veel categorieën (audit, runtime-log, supportcode). Extern
//  bestaan er precies TWEE oppervlakken met vaste, neutrale teksten:
//    • loginscherm  — één melding voor élke mislukte externe login (V11);
//    • profielkaart — drie meldingen (koppelen mislukt · verlopen · ontkoppelen).
//  Ruwe provider-, GoTrue- of databasemeldingen bereiken de gebruiker nooit.
// ============================================================================

import { LOGIN_GATEWAY_FOUTCATEGORIEEN, type LoginGatewayFoutcategorie } from "@/core/lib/microsoft-login-binding-core";
import type { ProfielMicrosoftLoginCode } from "@/core/lib/microsoft-login-meldingen-core";

export {
  LOGIN_MICROSOFT_MELDING,
  LOGIN_FOUT_PARAM,
  LOGIN_FOUT_WAARDE,
  SUPPORTCODE_PARAM,
  SUPPORTCODE_RE,
  PROFIEL_MICROSOFT_LOGIN_CODES,
  PROFIEL_MICROSOFT_LOGIN_MELDINGEN,
  isProfielMicrosoftLoginCode,
  supportcode,
  VERBODEN_MELDINGWOORDEN,
  type ProfielMicrosoftLoginCode,
} from "@/core/lib/microsoft-login-meldingen-core";

export const MICROSOFT_LOGIN_FOUTCATEGORIEEN = [
  // configuratie / infrastructuur
  "config_ontbreekt",
  "discovery_fout",
  "jwks_fout",
  "gateway_db_onbereikbaar",
  "gateway_fout",
  // flow / transactie
  "ratelimit",
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
  "ontkoppelen_verplicht",
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

/** Beeldt een interne categorie af op de publieke profielcode. Alles wat geen
 *  verval of unlink is, is 'koppelen' — bewust grof. */
export function profielCodeVoor(categorie: MicrosoftLoginFoutcategorie): ProfielMicrosoftLoginCode {
  if (categorie === "pending_verlopen") return "verlopen";
  if (categorie === "unlink_mislukt") return "ontkoppelen";
  // Fase 1C (#344): in modus `verplicht` ligt de lifecycle bij het fondsbeheer;
  // dat is geen fout van de gebruiker en verdient een eigen, sturende tekst.
  if (categorie === "ontkoppelen_verplicht") return "beheer";
  return "koppelen";
}
