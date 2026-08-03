// ============================================================================
//  core/lib/audit-hmac.ts — Plateau A / A-7 (D-9): integriteitszegel over de
//  verwijderbare chatinhoud.
// ----------------------------------------------------------------------------
//  WAAROM
//
//  Plateau A haalt vraag en antwoord uit het append-only auditspoor en zet ze in
//  `governance_log_inhoud`, dat de gebruiker mag verwijderen. Daarmee verdwijnt
//  ook het bewijs dát een bepaalde tekst er ooit stond. De HMAC vult dat gat:
//  hij blijft in `governance_log` staan als de inhoud is verwijderd, en maakt
//  achteraf toetsbaar of een aangeboden tekst de oorspronkelijke was.
//
//  BEWIJSWAARDE — GENUANCEERD. De HMAC bewijst dat wie de sleutel heeft een
//  tekst kan bevestigen die hem wordt VOORGELEGD. Hij reconstrueert de tekst
//  niet, en hij bewijst niets tegen iemand die de sleutel bezit. Het is een
//  integriteitszegel, geen onweerlegbaar bewijsmiddel — presenteer het nooit als
//  het laatste.
//
//  SLEUTELBEHEER. De sleutel leeft als env-var in het tenant-project (besluit:
//  applicatielaag, niet `current_setting()` in de database — via de Supabase-
//  pooler is een per-connectie-instelling niet betrouwbaar vast te houden, en de
//  canonieke vorm zou dan niet in een sanitytest te bevriezen zijn). De route
//  berekent de HMAC en geeft hem als parameter mee aan `schrijf_ai_interactie`.
//
//  `hmac_sleutel_versie` maakt sleutelrotatie mogelijk zonder de bestaande
//  zegels ongeldig te maken: oude rijen blijven verifieerbaar met de oude
//  sleutel. `hmac_schema_versie` doet hetzelfde voor de canonieke vorm.
//
//  Pure functies op één na (`hmacSleutel()` leest de omgeving).
//  Getest via core/lib/audit-hmac.sanity.ts — die pint de uitkomst voor een
//  vaste invoer, zodat een onbedoelde wijziging van de canonieke vorm zichtbaar
//  faalt in plaats van stilzwijgend elk oud zegel te breken.
// ============================================================================

import { createHmac } from "node:crypto";

/**
 * Versie van de CANONIEKE VORM hieronder. Verhogen zodra `canoniekeInvoer()`
 * verandert — nooit een bestaande versie hergebruiken voor een andere vorm.
 */
export const HMAC_SCHEMA_VERSIE = 1;

/**
 * Canonieke JSON-representatie waarover de HMAC wordt berekend.
 *
 * Drie eigenschappen die niet mogen verschuiven:
 *  • De sleutelvolgorde ligt vast door de objectliteral — `JSON.stringify`
 *    bewaart insertievolgorde voor niet-numerieke sleutels.
 *  • Geen spacer in `JSON.stringify`, dus geen witruimte die per platform kan
 *    verschillen.
 *  • NFC-normalisatie, zodat een visueel identieke tekst met een andere
 *    Unicode-samenstelling (é als één codepoint versus e + combining accent)
 *    hetzelfde zegel oplevert.
 *
 * Bronmetadata zit er BEWUST niet in: die leeft deels in het spoor en deels in
 * de inhoud, en zou het zegel laten kantelen op een wijziging die de tekst
 * onberoerd laat.
 */
export function canoniekeInvoer(vraag: string, antwoord: string | null): string {
  return JSON.stringify({
    schema_version: HMAC_SCHEMA_VERSIE,
    question: vraag.normalize("NFC"),
    answer: (antwoord ?? "").normalize("NFC"),
  });
}

/**
 * Berekent het zegel over vraag en antwoord.
 *
 * @param sleutel De geheime serversleutel; zie `hmacSleutel()`.
 */
export function berekenInhoudHmac(
  vraag: string,
  antwoord: string | null,
  sleutel: string
): string {
  return createHmac("sha256", sleutel)
    .update(canoniekeInvoer(vraag, antwoord), "utf8")
    .digest("hex");
}

export interface InhoudZegel {
  inhoud_hmac: string;
  hmac_schema_versie: number;
  hmac_sleutel_versie: number;
}

/**
 * Leest sleutel en sleutelversie uit de omgeving.
 *
 * Ontbreekt de sleutel, dan levert dit `null` op en wordt er GEEN zegel gezet.
 * Dat is een bewuste keuze: een chatinteractie mag niet mislukken omdat een
 * env-var niet is uitgerold. De kolommen zijn daarom nullable en de rol-/
 * capabilitytestset toetst de aanwezigheid van het zegel apart.
 */
export function hmacSleutel(): { sleutel: string; versie: number } | null {
  const sleutel = process.env.AUDIT_HMAC_SLEUTEL;
  if (!sleutel) return null;
  const versie = Number.parseInt(process.env.AUDIT_HMAC_SLEUTEL_VERSIE ?? "1", 10);
  return { sleutel, versie: Number.isFinite(versie) ? versie : 1 };
}

/**
 * Bouwt de drie zegelkolommen voor `governance_log`, of `null` wanneer er geen
 * sleutel is geconfigureerd.
 */
export function bouwInhoudZegel(vraag: string, antwoord: string | null): InhoudZegel | null {
  const s = hmacSleutel();
  if (!s) return null;
  return {
    inhoud_hmac: berekenInhoudHmac(vraag, antwoord, s.sleutel),
    hmac_schema_versie: HMAC_SCHEMA_VERSIE,
    hmac_sleutel_versie: s.versie,
  };
}

/**
 * Verifieert een aangeboden tekst tegen een bestaand zegel. Vergelijkt in
 * constante tijd noch nodig noch zinvol hier — de vergelijking gebeurt
 * server-side op auditverzoek, niet in een authenticatiepad.
 */
export function verifieerInhoudHmac(
  vraag: string,
  antwoord: string | null,
  sleutel: string,
  zegel: string
): boolean {
  return berekenInhoudHmac(vraag, antwoord, sleutel) === zegel;
}
