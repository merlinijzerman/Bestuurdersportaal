// ============================================================================
//  core/lib/microsoft-login-beleid-core.ts — PURE beslislaag van het
//  organisatiebrede Microsoft-loginbeleid (fase 1C, #344, besluit 0212).
// ----------------------------------------------------------------------------
//  ISOMORF: geen I/O, geen node:-imports, geen server-only. Een client-component
//  mag hieruit de modus en de zichtbaarheidsregels lezen (net als
//  capabilities-map). Alleen `import type` uit binding-core — dat wordt bij het
//  compileren gewist, zodat node:crypto niet in een browserbundel belandt.
//
//  De DATABASE is de autoriteit: login_private.wachtwoordlogin_toegestaan en de
//  Custom Access Token Hook beslissen over tokenuitgifte, login_private.
//  start_intrekking over persoonlijk ontkoppelen, en login_private.zet_modus
//  over de omslag naar `verplicht`. Deze module spiegelt die regels zodat de
//  app-laag ze vóór een databaseronde kan toepassen (defence-in-depth, nooit de
//  primaire controle) en zodat ze zonder database toetsbaar zijn.
//
//  MODI
//    uit        — Microsoft-login niet beschikbaar; knop weg, start/callback dicht.
//    optioneel  — wachtwoord én Microsoft; persoonlijk koppelen én ontkoppelen.
//    verplicht  — uitsluitend Microsoft voor normale fondsgebruikers; wachtwoord
//                 dicht, persoonlijk ontkoppelen dicht, lifecycle bij fondsbeheer.
// ============================================================================

import type { BindingStatus } from "@/core/lib/microsoft-login-binding-core";

export const LOGIN_MODI = ["uit", "optioneel", "verplicht"] as const;
export type LoginModus = (typeof LOGIN_MODI)[number];

export function isLoginModus(v: unknown): v is LoginModus {
  return typeof v === "string" && (LOGIN_MODI as readonly string[]).includes(v);
}

/** Onbekende/ontbrekende waarde → `uit`: geen beleid betekent geen Microsoft-login. */
export function loginModus(v: unknown): LoginModus {
  return isLoginModus(v) ? v : "uit";
}

/** De databaserol die de Auth-hook aan een beperkte sessie geeft. PostgREST doet
 *  hier `set role` op; de rol mag niets behalve de eigen profielrij lezen. */
export const ROL_BEPERKT = "portaal_beperkt";

/** De enige paden die een beperkte sessie mag raken: het koppelpad en de pagina
 *  waar zij naartoe wordt gestuurd (MFA-stap of koppelknop). */
export const BEPERKTE_SESSIE_PAD = "/beperkte-toegang";
export const BEPERKTE_SESSIE_ROUTES = [
  "/api/microsoft-login/koppeling",
  "/api/microsoft-login/koppelen/start",
  "/api/microsoft-login/verhoging",
] as const;

export function magBeperkteSessieRoute(pad: string | null | undefined): boolean {
  if (typeof pad !== "string") return false;
  return BEPERKTE_SESSIE_ROUTES.some((r) => pad === r || pad.startsWith(`${r}/`));
}

/** De stand van één account tegenover het fondsbeleid (login_private.sessiebeleid). */
export type Sessiebeleid = {
  readonly fondsId: string;
  readonly modus: LoginModus;
  /** Het profiel bestaat, maar er is geen configuratierij — dat is DRIFT. Elke
   *  fonds krijgt zo'n rij uit de migratie en de trigger, dus het ontbreken ervan
   *  is geen "geen beleid" maar een defect, en dat is fail-closed. */
  readonly configOntbreekt: boolean;
  readonly bindingStatus: BindingStatus | null;
  /** Levende, MFA-plichtige break-glassAANWIJZING (duurzaam tot intrekking). */
  readonly breakGlass: boolean;
  /** Einde van het lopende activeringsvenster van die aanwijzing, of null. */
  readonly breakglassVensterTot: Date | null;
  /** Geopend venster van een beperkte koppel-/herstelsessie. */
  readonly linkOnly: boolean;
};

/**
 * Waarom de gateway geen beleid kon leveren.
 *  • "geen"   — beleid opgehaald.
 *  • "config" — er is in deze omgeving geen logingateway geconfigureerd. Dan kan
 *               er ook geen fonds op `verplicht` staan (de modus zetten loopt via
 *               diezelfde gateway), dus dit is géén reden om sessies te beëindigen.
 *               Zonder dat onderscheid zou een omgeving zonder Microsoft-login al
 *               haar wachtwoordgebruikers uitloggen.
 *  • "fout"   — de gateway is er wél maar antwoordde niet: FAIL-CLOSED.
 */
export type GatewayUitval = "geen" | "config" | "fout";

export type PortaalSessieOordeel =
  | { toegestaan: true; beperkt: false; reden: "geen-beleid" | "gateway-niet-geconfigureerd" | "actieve-binding" | "wachtwoord-toegestaan" | "break-glass" }
  /** Toegestaan, maar UITSLUITEND op het koppel-/herstelpad: het token draagt de
   *  rol `portaal_beperkt`, dus de datalaag geeft deze sessie sowieso niets. */
  | { toegestaan: true; beperkt: true; reden: "koppelsessie" | "break-glass-niet-verhoogd" }
  | { toegestaan: false; beperkt: false; reden: "geen-binding" | "binding-niet-actief" | "gateway-fout" | "wachtwoord-geblokkeerd" | "config-drift" };

/**
 * Het oordeel van guard L3 over de HUIDIGE sessie.
 *
 * `isOAuth` komt uit het access-token (amr), `beleid` uit de gateway. Een
 * oauth-sessie eist een `active` binding (fase 1B, ongewijzigd). Een niet-oauth-
 * sessie is nieuw in fase 1C: in `verplicht` mag zij alleen doorlopen met een
 * levende uitzondering (break-glass of een geopende koppel-/herstelsessie).
 */
export function beoordeelPortaalSessieKern(args: {
  isOAuth: boolean;
  beleid: Sessiebeleid | null;
  uitval?: GatewayUitval;
  /** De `role`-claim uit het access-token. Is dat `portaal_beperkt`, dan HEEFT de
   *  hook de sessie al afgeschaald en is dit de waarheid — niet een afgeleide. */
  rol?: string | null;
}): PortaalSessieOordeel {
  const uitval = args.uitval ?? "geen";
  if (uitval === "fout") return { toegestaan: false, beperkt: false, reden: "gateway-fout" };
  if (uitval === "config") {
    // Een oauth-sessie kán niet bestaan zonder gateway; is zij er tóch, dan is er
    // iets mis en weigeren we. Voor een wachtwoordsessie betekent een ontbrekende
    // gateway simpelweg dat Microsoft-login in deze omgeving niet bestaat.
    return args.isOAuth
      ? { toegestaan: false, beperkt: false, reden: "gateway-fout" }
      : { toegestaan: true, beperkt: false, reden: "gateway-niet-geconfigureerd" };
  }

  if (args.isOAuth) {
    if (!args.beleid || args.beleid.bindingStatus === null) return { toegestaan: false, beperkt: false, reden: "geen-binding" };
    if (args.beleid.bindingStatus !== "active") return { toegestaan: false, beperkt: false, reden: "binding-niet-actief" };
    return { toegestaan: true, beperkt: false, reden: "actieve-binding" };
  }

  // Geen fondsprofiel (platformidentiteit): valt buiten het fondsbeleid.
  if (!args.beleid) return { toegestaan: true, beperkt: false, reden: "geen-beleid" };
  // Profiel zonder configuratierij is drift, en drift is dicht (bevinding 3).
  if (args.beleid.configOntbreekt) return { toegestaan: false, beperkt: false, reden: "config-drift" };

  // De hook heeft de sessie afgeschaald: dat is bindend, ongeacht wat wij verder
  // van het beleid vinden. Alleen het koppel-/herstelpad blijft open.
  if (args.rol === ROL_BEPERKT) {
    return { toegestaan: true, beperkt: true, reden: args.beleid.linkOnly ? "koppelsessie" : "break-glass-niet-verhoogd" };
  }

  if (args.beleid.modus !== "verplicht") return { toegestaan: true, beperkt: false, reden: "wachtwoord-toegestaan" };
  if (args.beleid.linkOnly) return { toegestaan: true, beperkt: true, reden: "koppelsessie" };
  if (args.beleid.breakGlass) return { toegestaan: true, beperkt: false, reden: "break-glass" };
  return { toegestaan: false, beperkt: false, reden: "wachtwoord-geblokkeerd" };
}

/**
 * Mag deze sessie een activeringsvenster openen (de verhogingsroute)?
 *
 * Uitsluitend een break-glassaccount dat de MFA-stap heeft afgerond en daardoor
 * op AAL2 zit, maar nog géén venster heeft. De sessie is op dat moment nog
 * BEPERKT — de hook geeft de normale rol pas als het venster bestaat. Zo is het
 * openen een expliciete, geaudite handeling en kan een client de app niet
 * overslaan door rechtstreeks bij GoTrue te refreshen (reviewbevinding P1).
 */
export function magBreakglassVerhogen(args: {
  beleid: Sessiebeleid | null;
  aal?: string | null;
  /** Tijdstip van de MFA-verificatie uit het token. Ontbreekt het, dan is er
   *  niets om de verhoging aan te hangen en gaat de poort dicht. */
  mfaGeverifieerdOp?: Date | null;
}): boolean {
  return (
    !!args.beleid &&
    args.beleid.breakGlass &&
    args.aal === "aal2" &&
    args.mfaGeverifieerdOp instanceof Date &&
    args.beleid.breakglassVensterTot === null
  );
}

/** Standaardduur van een break-glassverhoging. Kort en apart geaudit; de
 *  AANWIJZING zelf blijft bestaan tot zij wordt ingetrokken. */
export const BREAKGLASS_VENSTER_SECONDEN = 60 * 60;

/** Bestaat de knop "Inloggen met Microsoft" en zijn start/callback open? */
export function microsoftLoginBeschikbaar(modus: LoginModus): boolean {
  return modus !== "uit";
}

/** Mag de gebruiker zelf een koppeling starten? In `verplicht` alleen binnen een
 *  beheerder-uitgegeven koppel-/herstelsessie. */
export function magZelfKoppelen(modus: LoginModus, linkOnly = false): boolean {
  if (modus === "uit") return false;
  if (modus === "optioneel") return true;
  return linkOnly;
}

/** Mag de gebruiker zelf ontkoppelen? Spiegelt login_private.start_intrekking. */
export function magZelfOntkoppelen(modus: LoginModus, linkOnly = false): boolean {
  if (modus !== "verplicht") return true;
  return linkOnly;
}

/** Toont de profielkaart de beheeracties, of alleen de status? */
export function profielkaartStand(modus: LoginModus, linkOnly = false): "verbergen" | "beheerbaar" | "alleen-status" {
  if (modus === "uit") return "verbergen";
  if (modus === "optioneel") return "beheerbaar";
  return linkOnly ? "beheerbaar" : "alleen-status";
}

// ── Preflight en beheer ─────────────────────────────────────────────────────

/** Vaste, inhoudsvrije categorieën van het beheerpad (spiegelt de gatewayfuncties). */
export const BELEID_FOUTCATEGORIEEN = [
  "ongeldige_modus",
  "config_ontbreekt",
  "tenant_ontbreekt",
  "dekking_onvolledig",
  "breakglass_ontbreekt",
  "breakglass_onverifieerbaar",
  "zelf_toekennen",
  "ongeldige_reden",
  "ongeldige_geldigheid",
  "ongeldig_token",
  "uitnodiging_ongeldig",
  "mfa_ontbreekt",
  "mfa_verlopen",
  "mfa_hergebruikt",
  "tenant_mismatch",
  "fonds_mismatch",
  "onbekende_binding",
  "onbekende_uitzondering",
  "ontkoppelen_verplicht",
] as const;
export type BeleidFoutcategorie = (typeof BELEID_FOUTCATEGORIEEN)[number];

export function isBeleidFoutcategorie(v: unknown): v is BeleidFoutcategorie {
  return typeof v === "string" && (BELEID_FOUTCATEGORIEEN as readonly string[]).includes(v);
}

export type Preflight = {
  readonly gereed: boolean;
  readonly categorie: BeleidFoutcategorie | null;
  readonly ongedekteAccounts: number;
  readonly breakglassAccounts: number;
  /** Verloopbewaking: aanwijzingen die herzien moeten worden. Blokkeert NIET —
   *  een noodpad dat vanzelf verdampt is geen noodpad — maar hoort zichtbaar te
   *  zijn in preflight, beheeroverzicht en runbook. */
  readonly breakglassHerzieningVerlopen: number;
};

/**
 * Mag de omslag naar `verplicht` doorgaan? De database hertoetst dit binnen de
 * schrijftransactie (zet_modus, achter een advisory lock); deze functie is de
 * app-spiegel voor de bevestigingsdialoog en het blokkeeroverzicht.
 */
export function magActiveren(preflight: Preflight): boolean {
  return preflight.gereed && preflight.categorie === null && preflight.ongedekteAccounts === 0 && preflight.breakglassAccounts >= 1;
}

/** Neutrale, mensleesbare reden bij een geweigerde activering. Geen accountnamen. */
export function activeringWeigering(categorie: BeleidFoutcategorie | null, ongedekt = 0): string {
  switch (categorie) {
    case "dekking_onvolledig":
      return ongedekt === 1
        ? "Eén account heeft nog geen actieve Microsoft-koppeling."
        : `${ongedekt} accounts hebben nog geen actieve Microsoft-koppeling.`;
    case "breakglass_ontbreekt":
      return "Er is geen noodtoegangsaccount met bevestigde tweestapsverificatie.";
    case "breakglass_onverifieerbaar":
      return "De tweestapsverificatie van het noodtoegangsaccount kan niet worden gecontroleerd.";
    case "mfa_ontbreekt":
    case "mfa_verlopen":
    case "mfa_hergebruikt":
      return "Voer de tweestapsverificatie opnieuw uit om noodtoegang te openen.";
    case "tenant_ontbreekt":
      return "Er is nog geen Microsoft-tenant vastgelegd voor dit fonds.";
    case "config_ontbreekt":
      return "Voor dit fonds staat geen Microsoft-logininstelling klaar.";
    default:
      return "De overgang naar verplichte Microsoft-login kan nu niet worden voltooid.";
  }
}

// ── Beperkte koppel-/herstelsessie ──────────────────────────────────────────

/** Standaardgeldigheid van de uitnodiging (uitgifte → eerste gebruik). */
export const HERKOPPEL_GELDIGHEID_SECONDEN = 24 * 60 * 60;
/** Venster ná activering waarin het koppelpad openstaat. */
export const HERKOPPEL_VENSTER_SECONDEN = 15 * 60;
/** Lengte van het opake token in bytes (base64url → 43 tekens). */
export const HERKOPPEL_TOKEN_BYTES = 32;

/** Vormcontrole op een aangeboden token. Zegt niets over geldigheid — dat doet
 *  uitsluitend de database, atomisch en eenmalig. */
export function isHerkoppelTokenVorm(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}
