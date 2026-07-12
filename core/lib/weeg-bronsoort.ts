// ============================================================================
//  lib/weeg-bronsoort.ts — Increment G. Bronsoort-weging (geen aparte engine).
// ----------------------------------------------------------------------------
//  Pure, testbare rang-boost die de fonds-vs.-generiek-volgorde stuurt op basis
//  van het VRAAGTYPE — niet via een nieuwe RPC-parameter, maar door de
//  over-fetch-kandidatenset ná retrieval te herordenen (besluit 2, bevestigd
//  20-06-2026). De zoek-RPC levert `bibliotheek` per chunk (denorm); deze
//  module weegt zónder DB-toegang en is daarom programmatisch na te rekenen
//  (lib/weeg-bronsoort.sanity.ts) — precies wat regressietests #17/#18/#24
//  nodig hebben.
//
//  GEEN harde uitsluiting: een lager gewogen bronsoort blijft beschikbaar als
//  AANVULLEND kader. Voor een gecombineerde vraag worden beide bronsoorten
//  opgehaald en blijft de scheiding een PROMPT-zaak (route-side), niet hier.
// ============================================================================

import type { Bronsoort } from "./bronsoort";

/**
 * Welke bronsoort is PRIMAIR voor deze vraag?
 *   "fonds"        → fondsvraag: fondsdocumenten primair, generiek aanvullend.
 *   "generiek"     → sector-/toezicht-/wetgevingsvraag: generiek primair.
 *   "gecombineerd" → beide signalen: beide primair, antwoord gescheiden.
 */
export type Bronsoortprofiel = Bronsoort | "gecombineerd";

// Signaalwoorden voor een GENERIEKE (extern kader / sector / toezicht) vraag.
// Gecureerd en navolgbaar; elke toevoeging is een expliciete keuze.
const GENERIEK_PATRONEN: RegExp[] = [
  /\bdnb\b/,
  /\bafm\b/,
  /pensioenfederatie/,
  /\bszw\b/,
  /\btoezicht/,
  /toezichthouder/,
  /\bwetgeving\b/,
  /\bwettelijk/,
  /\bregelgeving\b/,
  /\bpensioenwet\b/,
  /\bwtp\b/,
  /wet toekomst pensioenen/,
  /\bsector(?:breed|norm|guidance)?\b/,
  /\brichtlijn(?:en)?\b/,
  /\bguidance\b/,
  /extern(?:e)? kader/,
  /\bnorm(?:en|kader)?\b/,
  /algemeen(?:e)? (?:kader|praktijk)/,
];

// Signaalwoorden voor een FONDS-specifieke vraag.
const FONDS_PATRONEN: RegExp[] = [
  /\bons fonds\b/,
  /\bonze\b/,
  /\bons (?:beleid|bestuur|dossier|besluit)/,
  /\bdit fonds\b/,
  /\bbinnen ons\b/,
  /\bintern(?:e)?\b/,
  /\beigen (?:beleid|fonds|stukken)/,
  /\bons portaal\b/,
];

/** Detecteer het bronsoortprofiel. Default "fonds": het portaal is
 *  fondsgericht, dus zonder extern signaal zijn fondsdocs primair. */
export function bepaalBronsoortprofiel(vraag: string): Bronsoortprofiel {
  const g = vraag
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const generiek = GENERIEK_PATRONEN.some((p) => p.test(g));
  const fonds = FONDS_PATRONEN.some((p) => p.test(g));
  if (generiek && fonds) return "gecombineerd";
  if (generiek) return "generiek";
  return "fonds";
}

/** Prioriteit (lager = eerder) van een bibliotheek-waarde binnen een profiel. */
function prioriteit(
  bibliotheek: string | null | undefined,
  profiel: Bronsoortprofiel
): number {
  const isGeneriek = bibliotheek === "generiek";
  if (profiel === "gecombineerd") return 0; // beide gelijk → originele volgorde
  if (profiel === "generiek") return isGeneriek ? 0 : 1;
  // profiel === "fonds"
  return isGeneriek ? 1 : 0;
}

/**
 * Herorden `items` zodat de primaire bronsoort vóór de aanvullende komt, met
 * een STABIELE sortering (de relevantievolgorde binnen een bronsoortgroep
 * blijft behouden). Generiek wordt nooit weggegooid — alleen lager geplaatst —
 * dus blijft het als aanvullend kader beschikbaar (test #24).
 *
 * `bibliotheekVan` ontkoppelt de helper van de chunk-vorm (DocumentChunk nest
 * bibliotheek onder `documenten`), zodat de functie puur en herbruikbaar blijft.
 */
export function weegBronsoort<T>(
  items: T[],
  bibliotheekVan: (item: T) => string | null | undefined,
  profiel: Bronsoortprofiel
): T[] {
  return items
    .map((item, index) => ({ item, index, p: prioriteit(bibliotheekVan(item), profiel) }))
    .sort((a, b) => (a.p - b.p) || (a.index - b.index)) // stabiel op originele index
    .map((x) => x.item);
}
