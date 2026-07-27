// ============================================================================
//  Gedeelde types/constanten voor het tenant-gebruikersscherm (P3-B).
// ----------------------------------------------------------------------------
//  BEWUST los van acties.ts: een "use server"-module mag UITSLUITEND async
//  functies exporteren. Waarden/types die zowel de server-actions als de
//  client-UI nodig hebben, leven hier (geen "use server", geen server-only —
//  puur, veilig te importeren in een client component).
// ============================================================================

/** Rol-whitelist = de profielen.rol-CHECK (DB is de backstop, P3B-4). */
export const TENANT_ROLLEN = ["bestuurder", "voorzitter", "beheerder"] as const;
export type TenantRol = (typeof TENANT_ROLLEN)[number];

/** Ondergrens wachtwoordsterkte (B-3: lengte-eis, geen verdere hardening). */
export const MIN_WACHTWOORD_LENGTE = 12;

/** Leesbare labels (UI). Bron-van-waarheid voor de codes blijft de CHECK. */
export const ROL_LABEL: Record<TenantRol, string> = {
  bestuurder: "Bestuurder",
  voorzitter: "Voorzitter",
  beheerder: "Beheerder",
};

export type GebruikersResultaat =
  | { ok: true; bericht: string }
  | { ok: false; foutcode: string; melding: string };

export function isTenantRol(r: string): r is TenantRol {
  return (TENANT_ROLLEN as readonly string[]).includes(r);
}

/** Pure basisvalidatie van een aanmaakverzoek — GEEN DB, GEEN wachtwoordwaarde
 *  (uitsluitend de lengte, zodat het wachtwoord nooit in deze testbare laag
 *  belandt). De fondsEXISTENTIE-check hoort in de server-action (DB). Los
 *  testbaar (tests/cross-tenant/p3b-gebruikersbeheer.test.ts). */
export function valideerAanmaakBasis(i: {
  fondsId: string;
  email: string;
  naam: string;
  rol: string;
  reden: string;
  wachtwoordLengte: number;
}): { ok: true } | { ok: false; foutcode: string; melding: string } {
  if (!i.reden.trim()) return { ok: false, foutcode: "reden_verplicht", melding: "Reden is verplicht bij het aanmaken van een gebruiker." };
  if (!i.fondsId) return { ok: false, foutcode: "fonds_verplicht", melding: "Kies expliciet een fonds; er is bewust geen default." };
  if (!i.email.trim()) return { ok: false, foutcode: "email_verplicht", melding: "E-mailadres is verplicht." };
  if (!i.naam.trim()) return { ok: false, foutcode: "naam_verplicht", melding: "Naam is verplicht." };
  if (!isTenantRol(i.rol)) return { ok: false, foutcode: "ongeldige_rol", melding: "Onbekende rol." };
  if (i.wachtwoordLengte < MIN_WACHTWOORD_LENGTE) {
    return { ok: false, foutcode: "wachtwoord_te_zwak", melding: `Wachtwoord te zwak: minimaal ${MIN_WACHTWOORD_LENGTE} tekens.` };
  }
  return { ok: true };
}
