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

import { z } from "zod";

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

// ── W9 — het contract als zod-schema ────────────────────────────────────────
//  De publieke contactroute valt buiten `withFondsRoute` (geen sessie), maar is
//  de ENIGE publiek bereikbare body-lezer. Daarom krijgt hij een echt schema,
//  hier gedeclareerd en inline toegepast in /api/contact via `valideerContact`.
//
//  `valideerContact` DELEGEERT zijn validatie sinds W9 aan dit schema — de
//  logica is één-op-één overgezet, GEEN aanscherping: elke `.transform(alsTekst)`
//  spiegelt de oude coercie (niet-string → '' → verplicht-fout), elke lengte- en
//  formaatcheck komt uit `superRefine` met exact dezelfde melding en veldsleutel.
//  Dat `contact-validatie.sanity.ts` ongewijzigd groen blijft, IS het bewijs dat
//  de omzetting niets heeft aangescherpt (TICKET-W9 §4).
//
//  R-13 (herkomst-spoofing) en R-14 (fail-open Turnstile, `contact/route.ts:105`)
//  blijven ONGEMOEID open — een schema is geen botbescherming. Zie het issue.
// `.optional()` zodat een ONTBREKENDE key wordt geaccepteerd (zod 4 weigert
// `z.unknown()` anders als "nonoptional"); de transform coerceert dan
// undefined/niet-string → '' — precies de oude `alsTekst`-coercie.
const tekst = z.unknown().optional().transform(alsTekst);

export const contactSchema = z
  .object({
    naam: tekst,
    organisatie: tekst,
    rol: tekst,
    email: tekst,
    telefoon: tekst,
    type_verzoek: tekst,
    bericht: tekst,
  })
  .passthrough()
  .superRefine((v, ctx) => {
    const fout = (veld: ContactVeld, message: string) =>
      ctx.addIssue({ code: "custom", path: [veld], message });

    if (!v.naam) fout("naam", "Vul uw naam in.");
    else if (v.naam.length > VELD_MAX.naam) fout("naam", "Naam is te lang.");

    if (!v.organisatie) fout("organisatie", "Vul uw organisatie in.");
    else if (v.organisatie.length > VELD_MAX.organisatie)
      fout("organisatie", "Organisatie is te lang.");

    // rol optioneel (besluit 0037 #2): alleen lengte; leeg → '' opslaan.
    if (v.rol && v.rol.length > VELD_MAX.rol) fout("rol", "Rol of functie is te lang.");

    if (!v.email) fout("email", "Vul een geldig e-mailadres in.");
    else if (v.email.length > VELD_MAX.email || !EMAIL_RE.test(v.email))
      fout("email", "Vul een geldig e-mailadres in.");

    if (v.telefoon && v.telefoon.length > VELD_MAX.telefoon)
      fout("telefoon", "Telefoonnummer is te lang.");

    const typeGeldig = (TYPE_VERZOEK_OPTIES as readonly string[]).includes(v.type_verzoek);
    if (!v.type_verzoek) fout("type", "Kies een type verzoek.");
    else if (!typeGeldig) fout("type", "Ongeldig type verzoek.");

    // bericht optioneel: alleen lengte; leeg → '' opslaan.
    if (v.bericht && v.bericht.length > VELD_MAX.bericht)
      fout("bericht", "Bericht is te lang.");
  });

/**
 * Valideer en normaliseer een contactinzending.
 *
 * Retourneert óf `{ ok: true, schoon }` met opslag-klare waarden, óf
 * `{ ok: false, fouten }` met per-veld een korte NL-melding. De server
 * gebruikt alleen `ok` (generieke 400 naar buiten); de client toont `fouten`.
 *
 * W9: delegeert aan {@link contactSchema}; gedrag identiek (sanity-suite = tegenproef).
 */
export function valideerContact(invoer: ContactInvoer): ValidatieResultaat {
  const res = contactSchema.safeParse(invoer);
  if (!res.success) {
    const fouten: Partial<Record<ContactVeld, string>> = {};
    for (const issue of res.error.issues) {
      const veld = issue.path[0] as ContactVeld | undefined;
      if (veld && fouten[veld] === undefined) fouten[veld] = issue.message;
    }
    return { ok: false, schoon: null, fouten };
  }
  const v = res.data;
  return {
    ok: true,
    fouten: {},
    schoon: {
      naam: v.naam,
      organisatie: v.organisatie,
      rol: v.rol,
      email: v.email,
      telefoon: v.telefoon || null,
      type_verzoek: v.type_verzoek as TypeVerzoek,
      bericht: v.bericht,
    },
  };
}
