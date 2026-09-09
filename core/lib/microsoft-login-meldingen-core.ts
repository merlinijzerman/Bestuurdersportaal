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

// ── Fase 1C (#344 PR-B): herstelflow en beheerteksten — browserveilig ───────

/** Vaste ingang van de beperkte koppel-/herstelsessie; de link is `/koppelen#<token>`. */
export const KOPPEL_PAD = "/koppelen";

/** Paden waarop de algemene root-layout GEEN analytics mag laden: de herstelflow
 *  draagt het herkoppeltoken tijdelijk in het URL-fragment, en `app/(herstel)/layout.tsx`
 *  is géén eigen root-layout (die is `app/layout.tsx`, mét <Analytics/>). */
export function analyticsUitgesloten(pathname: string | null | undefined): boolean {
  if (typeof pathname !== "string") return false;
  return pathname === KOPPEL_PAD || pathname.startsWith(`${KOPPEL_PAD}/`);
}

/** Vorm van het opake herkoppeltoken (32 bytes base64url = 43 tekens). Zegt niets
 *  over geldigheid — dat doet uitsluitend de database, atomisch en eenmalig. */
export const HERKOPPEL_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Leest het token uit een fragment (`#<token>`); alles wat afwijkt is null. */
export function tokenUitFragment(hash: string | null | undefined): string | null {
  if (typeof hash !== "string" || !hash.startsWith("#")) return null;
  const t = hash.slice(1);
  return HERKOPPEL_TOKEN_RE.test(t) ? t : null;
}

/** Eén tekst voor ongeldig, verlopen, ingetrokken én al gebruikt (geen orakel). */
export const UITNODIGING_ONGELDIG_MELDING = "Deze uitnodiging is niet (meer) geldig. Vraag uw beheerder om een nieuwe.";

/** Vaste beheerteksten (neutraal; geen accountinformatie). */
export const BEHEER_TEKSTEN = {
  intrekkenBevestiging:
    "Microsoft-koppeling intrekken? Inloggen met Microsoft wordt direct geblokkeerd. De gebruiker kan de koppeling daarna zelf losmaken en opnieuw koppelen.",
  afrondenBevestiging:
    "Intrekking definitief afronden? Gebruik dit alleen voor een vertrokken gebruiker. Let op: de Microsoft-identiteit blijft in Supabase Auth achter en kan hergebruik van hetzelfde Microsoft-account blokkeren totdat de gebruiker haar zelf ontkoppelt.",
  afrondenBevestigingswoord: "AFRONDEN",
  verplichtBevestiging:
    "Microsoft-login verplicht maken? Wachtwoordlogin wordt voor alle accounts van dit fonds geblokkeerd, ook magic link en wachtwoordherstel. Alleen accounts met een actieve koppeling of een noodtoegangsaanwijzing kunnen nog inloggen.",
  uitnodigingEenmalig:
    "Deze link wordt maar één keer getoond en nergens bewaard. Kopieer hem nu en geef hem via een beveiligd kanaal aan de gebruiker. Het token authenticeert niet: de gebruiker heeft daarnaast zijn wachtwoord nodig.",
} as const;

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
