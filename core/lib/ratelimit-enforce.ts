// ============================================================================
//  Ratelimit-enforce — pure zou-beslissing + env-schakelaar voor de wrapper.
//  (W10, EPIC W, deploy 3 — het MECHANISME, niet de invulling.)
// ----------------------------------------------------------------------------
//  Spiegelt core/lib/capability-enforce.ts. Twee verschillen, allebei omdat een
//  rate limit als enige control TOESTANDSAFHANKELIJK is (hij beslist uit de
//  geschiedenis, niet uit het verzoek):
//
//    1. De "zou-beslissing" leunt op een DB-teller (`fn_rate_limit_check` via
//       `controleerLimiet`). Die I/O wordt in de wrapper geïNJECTEERD, zodat
//       deze module puur en server-loos testbaar blijft (ratelimit-enforce.sanity.ts).
//       Wat hier puur is: de vlag, en het mappen van een `LimietBeslissing` +
//       vlagstand op door/observe/weiger.
//
//    2. `"route-eigen"` bestaat hier WÉL (anders dan bij audit onder besluit
//       0190), omdat de wrapper en de route op ÉÉN gedeelde resource botsen: de
//       teller op de endpoint-sleutel. Belt de wrapper `controleerLimiet` voor
//       een route die dat zelf al doet, dan telt één request dubbel en loopt het
//       budget op halve snelheid vol. Zie de gedeelde-resource-regel in besluit
//       0190. Voor die routes doet de wrapper NIETS.
//
//  KALE OPT-IN. Net als ENFORCE_CAPABILITY zet alleen `ENFORCE_RATELIMIT=on` de
//  handhaving aan; er is GEEN omgevings-default. Het veld landt optioneel en op
//  geen enkele route gedeclareerd, dus bij landing is deze poort volledig inert
//  (byte-identiek). #183 vult de declaraties; de vlag-default flipt aan het eind
//  van deploy 3 (tweefasen-model, besluit 0189), niet hier.
// ============================================================================

// UITSLUITEND TYPE-IMPORTS. Een waarde-import van `LIMIETEN` zou de rate-limit-
// module meetrekken, en die is via `logAppFout` server-only getaint. Types worden
// bij compilatie gewist, dus deze module blijft server-loos testbaar — precies de
// eis uit het ticket. `LimietNaam` leeft daarom in rate-limit.ts.
import type { LimietNaam, LimietBeslissing } from "./rate-limit";

export type { LimietNaam };

/**
 * Wat een route in zijn {@link RouteSpecV1} declareert voor rate limiting. Naast
 * een echte limietnaam zijn er twee bijzondere waarden; ze bestaan omdat een
 * AFWEZIGE waarde niet te onderscheiden is van een VERGETEN waarde:
 *
 *   "geen"         expliciet: deze route kent geen tempolimiet.
 *   "route-eigen"  de route roept `controleerLimiet` ZELF aan (de 16 bestaande
 *                  adopters). De wrapper blijft eruit — anders dubbele telling op
 *                  de gedeelde teller. Per besluit 0190 corollarium A wordt deze
 *                  keuze PER LIMIETSLEUTEL genomen: alle routes die een sleutel
 *                  delen krijgen dezelfde waarde.
 */
export type RateLimitDeclaratie = LimietNaam | "geen" | "route-eigen";

/**
 * De kostendragende endpoints die fail-CLOSED horen te zijn (H-12, review 30-07):
 * bij een mislukte teller-check breekt de functie liever dan de providerrekening
 * te laten doorlopen. Hier — server-loos en COMPILE-gecheckt tegen `LimietNaam`,
 * dus een hernoemde/verwijderde sleutel breekt direct op `tsc`.
 *
 * BEWUST NIET als vlag op de `LIMIETEN`-entry (besluit 0190 gaf die voorkeur,
 * maar hij bleek onhoudbaar): `rate-limit.ts` is via `logAppFout` server-only
 * getaint en dus onimporteerbaar in de tsx-sanity — een entry-vlag zou daar
 * ontoetsbaar zijn, en een handmatige spiegel zou stil kunnen driften (precies
 * de "meet, geen spiegel"-regel uit CLAUDE.md). Deze pure set is de ENIGE bron.
 */
export const FAIL_CLOSED_LIMIETEN: ReadonlySet<LimietNaam> = new Set<LimietNaam>([
  "chat",
  "zoeken",
  "her_extract",
  "backfill",
  "segmenteer",
]);

/** Of een limietsleutel fail-closed is (zie {@link FAIL_CLOSED_LIMIETEN}). */
export function isFailClosed(naam: LimietNaam): boolean {
  return FAIL_CLOSED_LIMIETEN.has(naam);
}

/**
 * Bepaalt of rate-limit-handhaving actief is voor deze deployment. BEWUST kale
 * opt-in, net als {@link capabilityEnforceVoorOmgeving} en anders dan
 * `tenantEnforceVoorOmgeving`: geen omgevings-default. De flip naar fail-closed
 * hoort in DEZE functie thuis, op een eigen moment, ná #183.
 */
export function ratelimitEnforceVoorOmgeving(args: {
  enforceRateLimit?: string | null;
}): boolean {
  return (args.enforceRateLimit?.trim().toLowerCase() ?? "") === "on";
}

/** Leest de env-vlag. Apart van de pure functie zodat die testbaar blijft. */
export function ratelimitEnforceAan(): boolean {
  return ratelimitEnforceVoorOmgeving({
    enforceRateLimit: process.env.ENFORCE_RATELIMIT,
  });
}

/**
 * MOET de wrapper voor deze declaratie de teller raadplegen? Type-guard: narrowt
 * naar {@link LimietNaam} zodat `LIMIETEN[decl]` typecheckt. `"geen"` en
 * `"route-eigen"` → de wrapper doet niets (en telt dus ook niet — corollarium B).
 */
export function wrapperTeltVoor(
  decl: RateLimitDeclaratie
): decl is LimietNaam {
  return decl !== "geen" && decl !== "route-eigen";
}

/** De zou-uitkomst, vlag-bewust. `observe` = vlag uit, zou geweigerd zijn (alleen
 *  loggen). `weiger` = vlag aan, 429. */
export type RateLimitUitkomst =
  | { actie: "door" }
  | { actie: "observe"; resetAt: Date | null }
  | { actie: "weiger"; resetAt: Date | null };

/**
 * Mapt een {@link LimietBeslissing} (uit `controleerLimiet`) + de vlagstand op de
 * actie van de wrapper. Puur: geen I/O, leest geen env — de wrapper reikt
 * `handhaven` aan.
 */
export function beoordeelRateLimitUitkomst(args: {
  beslissing: LimietBeslissing;
  handhaven: boolean;
}): RateLimitUitkomst {
  if (args.beslissing.toegestaan) return { actie: "door" };
  return args.handhaven
    ? { actie: "weiger", resetAt: args.beslissing.resetAt }
    : { actie: "observe", resetAt: args.beslissing.resetAt };
}
