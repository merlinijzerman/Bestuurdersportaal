// ============================================================================
//  Gedeeld veldcontract + validatie voor het publieke contactformulier (W2a).
// ----------------------------------------------------------------------------
//  Eén bron van waarheid voor zowel de client (toegankelijke foutweergave in
//  ContactForm.tsx) als de server (autoritatieve check in /api/contact). De
//  server is leidend; de client-validatie is alleen UX. Pure functie, geen
//  I/O — daardoor programmatisch na te rekenen (zie contact-validatie.sanity.ts).
//
//  Veldcontract ↔ datamodel (supabase/migrations/2026_06_29_contact_aanvragen):
//    naam, organisatie, email    → verplicht
//    rol, bericht                → optioneel (besluit 0037 #2); de DB-kolommen
//                                  zijn NOT NULL, dus we slaan '' op bij leeg
//                                  (geen migratie). De publieke UI toont rol
//                                  niet meer als veld.
//    telefoon                    → optioneel (→ null bij leeg)
//    type_verzoek ∈ {demo,pilot,vraag,samenwerking}
//  Foutsleutels zijn de FORM-veld-ids (type i.p.v. type_verzoek) zodat de
//  client ze direct aan het juiste invoerveld kan koppelen.
// ============================================================================

export const TYPE_VERZOEK_OPTIES = [
  "demo",
  "pilot",
  "vraag",
  "samenwerking",
] as const;
export type TypeVerzoek = (typeof TYPE_VERZOEK_OPTIES)[number];

/** Maximale lengtes — defense-in-depth tegen oversized payloads/opslag-misbruik. */
export const VELD_MAX = {
  naam: 200,
  organisatie: 200,
  rol: 200,
  email: 254, // RFC 5321 max
  telefoon: 50,
  bericht: 5000,
} as const;

/** Form-veld-ids (== error-sleutels en input-id's in de UI). */
export type ContactVeld =
  | "naam"
  | "organisatie"
  | "rol"
  | "email"
  | "telefoon"
  | "type"
  | "bericht";

/** Ruwe invoer zoals de client 'm POST (alles mag onbekend/leeg binnenkomen). */
export type ContactInvoer = {
  naam?: unknown;
  organisatie?: unknown;
  rol?: unknown;
  email?: unknown;
  telefoon?: unknown;
  type_verzoek?: unknown;
  bericht?: unknown;
};

/** Genormaliseerde, gevalideerde waarden klaar voor opslag. */
export type ContactSchoon = {
  naam: string;
  organisatie: string;
  rol: string;
  email: string;
  telefoon: string | null;
  type_verzoek: TypeVerzoek;
  bericht: string;
};

export type ValidatieResultaat =
  | { ok: true; schoon: ContactSchoon; fouten: Record<string, never> }
  | { ok: false; schoon: null; fouten: Partial<Record<ContactVeld, string>> };

// Bewust simpel/breed e-mailpatroon: geen poging tot RFC-volledige validatie
// (onmogelijk + foutgevoelig). Echte verificatie = de reply die naar dit adres
// gaat. We weren alleen evidente onzin.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function alsTekst(waarde: unknown): string {
  return typeof waarde === "string" ? waarde.trim() : "";
}

/**
 * Valideer en normaliseer een contactinzending.
 *
 * Retourneert óf `{ ok: true, schoon }` met opslag-klare waarden, óf
 * `{ ok: false, fouten }` met per-veld een korte NL-melding. De server
 * gebruikt alleen `ok` (generieke 400 naar buiten); de client toont `fouten`.
 */
export function valideerContact(invoer: ContactInvoer): ValidatieResultaat {
  const fouten: Partial<Record<ContactVeld, string>> = {};

  const naam = alsTekst(invoer.naam);
  const organisatie = alsTekst(invoer.organisatie);
  const rol = alsTekst(invoer.rol);
  const email = alsTekst(invoer.email);
  const telefoon = alsTekst(invoer.telefoon);
  const typeRuw = alsTekst(invoer.type_verzoek);
  const bericht = alsTekst(invoer.bericht);

  if (!naam) fouten.naam = "Vul uw naam in.";
  else if (naam.length > VELD_MAX.naam) fouten.naam = "Naam is te lang.";

  if (!organisatie) fouten.organisatie = "Vul uw organisatie in.";
  else if (organisatie.length > VELD_MAX.organisatie)
    fouten.organisatie = "Organisatie is te lang.";

  // rol is optioneel (besluit 0037 #2): alleen lengte begrenzen; leeg → '' opslaan.
  if (rol && rol.length > VELD_MAX.rol) fouten.rol = "Rol of functie is te lang.";

  if (!email) fouten.email = "Vul een geldig e-mailadres in.";
  else if (email.length > VELD_MAX.email || !EMAIL_RE.test(email))
    fouten.email = "Vul een geldig e-mailadres in.";

  if (telefoon && telefoon.length > VELD_MAX.telefoon)
    fouten.telefoon = "Telefoonnummer is te lang.";

  const typeGeldig = (TYPE_VERZOEK_OPTIES as readonly string[]).includes(typeRuw);
  if (!typeRuw) fouten.type = "Kies een type verzoek.";
  else if (!typeGeldig) fouten.type = "Ongeldig type verzoek.";

  // bericht is optioneel (besluit 0037 #2): alleen lengte begrenzen; leeg → '' opslaan.
  if (bericht && bericht.length > VELD_MAX.bericht)
    fouten.bericht = "Bericht is te lang.";

  if (Object.keys(fouten).length > 0) {
    return { ok: false, schoon: null, fouten };
  }

  return {
    ok: true,
    fouten: {},
    schoon: {
      naam,
      organisatie,
      rol,
      email,
      telefoon: telefoon || null,
      type_verzoek: typeRuw as TypeVerzoek,
      bericht,
    },
  };
}
