// ============================================================================
//  Capability-enforce — pure zou-beslissing + env-schakelaar voor de wrapper.
//  (W6, EPIC W, deploy 3 — het MECHANISME, niet de invulling.)
// ----------------------------------------------------------------------------
//  Deze module beantwoordt één vraag, zonder I/O en zonder Next-runtime:
//
//      gegeven de capability die een route DECLAREERT en de rol die de sessie
//      DRAAGT — zou dit request door mogen?
//
//  De wrapper (core/lib/route-wrapper.ts) doet met dat oordeel twee dingen,
//  afhankelijk van één env-vlag:
//
//    ENFORCE_CAPABILITY uit  → doorlaten en LOGGEN (observe). Dat log is de
//                              dataset waarmee W7 begint: route + rol +
//                              zou-beslissing, ook zonder productieverkeer.
//    ENFORCE_CAPABILITY aan  → handhaven: een negatief oordeel wordt 403.
//
//  PUUR, spiegelend op core/lib/tenant-enforce.ts: de caller levert capability,
//  rol en de env-schakelaar aan. Zo blijft dit server-loos testbaar
//  (capability-enforce.sanity.ts) en importeerbaar buiten de Next-runtime.
//
//  DEFENSE-IN-DEPTH, GEEN VERVANGING. De route-eigen gates (requireCapability,
//  de inline rolstrings, de bureau-gate) en RLS blijven ONVERKORT staan. Een
//  declaratie in de wrapper kan RUIMER zijn dan de inline gate; zolang beide
//  draaien is dat onschadelijk, maar wie de inline gate weghaalt in het
//  vertrouwen dat de wrapper hem overneemt, verzwakt de route zonder dat een
//  test dat ziet. Zie TICKET-W6 §3.
// ============================================================================

import type { Capability } from "./capabilities-map";
import { rolHeeftCapability } from "./capabilities-map";

/**
 * Wat een route in zijn {@link RouteSpecV1} declareert. Naast de echte
 * capabilities uit `capabilities-map.ts` zijn er drie bijzondere waarden, en ze
 * bestaan alle drie omdat een AFWEZIGE waarde niet te onderscheiden is van een
 * VERGETEN waarde — dezelfde regel als `hostGuard: "route-eigen"` in W4:
 *
 *   "iedere-ingelogde"  expliciet: elke geauthenticeerde gebruiker van het fonds
 *                       mag dit. Gebruik dit ook waar vandaag een capability
 *                       staat die NUL rollen uitsluit (zie §4 van het ticket):
 *                       dan staat er wat er bedoeld wordt, en telt het niet mee
 *                       als autorisatie in latere metingen.
 *   "publiek"           expliciet: geen sessie vereist. NB: `withFondsRoute`
 *                       zelf eist altijd een sessie (401 bij `!user`), dus deze
 *                       waarde is in W6 op geen enkele gewrapte route in gebruik;
 *                       hij bestaat voor de routes die W5b/W7 nog binnenhaalt.
 *   "TE_BEPALEN"        tijdelijk. Onder de vlag → 403. W7 vervangt hem door een
 *                       echte declaratie; W13 laat CI falen op elke rest.
 *
 * BESLUIT (W6): het ticket schetst deze union als `Capability` en hernoemt de
 * bestaande map-union naar `CapabilityNaam`. Dat is hier NIET gedaan. De naam
 * `Capability` uit `capabilities-map.ts` staat in 20 route-imports en in
 * `requireCapability()`; hem hernoemen zou een codemod over onaangeraakte
 * autorisatiecode zijn in het ticket dat juist belooft niets te veranderen.
 * Vandaar `RouteCapability`: een eigen naam voor een eigen begrip.
 */
export type RouteCapability =
  | Capability
  | "iedere-ingelogde"
  | "publiek"
  | "TE_BEPALEN";

export type CapabilityRedenToegestaan =
  | "publiek"
  | "iedere-ingelogde"
  | "rol-heeft-capability";

export type CapabilityRedenGeweigerd =
  | "te-bepalen"
  | "geen-rol"
  | "rol-mist-capability";

/** De zou-beslissing. Vlag-loos: hij zegt wat er ZOU gebeuren, niet wat er
 *  gebeurt. De wrapper beslist op grond van de vlag of hij hem uitvoert. */
export type CapabilityOordeel =
  | { toegestaan: true; reden: CapabilityRedenToegestaan }
  | { toegestaan: false; reden: CapabilityRedenGeweigerd };

/**
 * Bepaalt of capability-afdwinging actief is voor deze deployment.
 *
 * BEWUST ANDERS DAN {@link tenantEnforceVoorOmgeving}. Die functie zet
 * productie/preview/staging ALTIJD fail-closed, ook zonder env-waarde. Dat is
 * daar juist, want de tenantgrens is uitgekristalliseerd. Hier zou het de
 * belofte van W6 breken: met 95 routes op `TE_BEPALEN` zou een omgevings-
 * default betekenen dat de eerste preview-deploy het hele portaal op 403 zet.
 *
 * W6 landt daarom met een KALE opt-in schakelaar: alleen `ENFORCE_CAPABILITY=on`
 * zet hem aan, overal. De omgevings-default flipt naar fail-closed aan het EIND
 * van deploy 3 — als eigen `BESLUIT:` op een eigen moment, pas nadat W7 de
 * declaraties heeft ingevuld en `TE_BEPALEN` is verdwenen. Die flip hoort hier,
 * in deze functie, en nergens anders.
 */
export function capabilityEnforceVoorOmgeving(args: {
  enforceCapability?: string | null;
}): boolean {
  return (args.enforceCapability?.trim().toLowerCase() ?? "") === "on";
}

/** Leest de env-vlag. Apart van de pure functie zodat die testbaar blijft. */
export function capabilityEnforceAan(): boolean {
  return capabilityEnforceVoorOmgeving({
    enforceCapability: process.env.ENFORCE_CAPABILITY,
  });
}

/**
 * De zou-beslissing, puur.
 *
 * - `"publiek"`           → toegestaan (de wrapper heeft dan al een sessie
 *                           afgedwongen; de declaratie zegt alleen dat de route
 *                           er zelf geen nodig heeft);
 * - `"iedere-ingelogde"`  → toegestaan; de sessie is de enige eis;
 * - `"TE_BEPALEN"`        → GEWEIGERD. Dit is het hele punt: onder de vlag valt
 *                           elke nog niet gedeclareerde route dicht, en die 403
 *                           is de ontdekkingslijst voor W7;
 * - echte capability      → `rolHeeftCapability(rol, cap)`; geen rol = geweigerd.
 */
export function beoordeelCapability(args: {
  capability: RouteCapability;
  rol: string | null | undefined;
}): CapabilityOordeel {
  const { capability, rol } = args;

  if (capability === "publiek") return { toegestaan: true, reden: "publiek" };
  if (capability === "iedere-ingelogde") {
    return { toegestaan: true, reden: "iedere-ingelogde" };
  }
  if (capability === "TE_BEPALEN") {
    return { toegestaan: false, reden: "te-bepalen" };
  }
  if (!rol) return { toegestaan: false, reden: "geen-rol" };
  return rolHeeftCapability(rol, capability)
    ? { toegestaan: true, reden: "rol-heeft-capability" }
    : { toegestaan: false, reden: "rol-mist-capability" };
}
