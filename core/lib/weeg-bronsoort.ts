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
import type { RepresentatieConstraints } from "./rag-select";

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

// ── T1 — Afleiding van representatie-constraints uit het bronsoortprofiel ─────
//  De weging (weegBronsoort) herordent alleen; ze garandeert geen minimum-
//  representatie. Deze afleiding vertaalt het profiel naar de deterministische
//  constraints die selecteerMetConstraints (lib/rag-select.ts) afdwingt VÓÓR de
//  budget-afkap. De classificatie stuurt zo de constraints aan; de constraints
//  doen het werk (de classificatie is niet langer zelf de oplossing).

/** Profiel dat constraints stuurt. Bronsoortprofiel + de vergelijkmodus (T5).
 *  "vergelijking" is nog geen retrieval-modus in productie; het veld is hier
 *  voorbereid zodat T5 alleen de afleiding hoeft aan te zetten. */
export type RepresentatieProfiel = Bronsoortprofiel | "vergelijking";

/** Budget/plafonds die uit de aanroeper komen (maxResults/maxPerDoc) plus het
 *  per-bron-quotum q voor de vergelijkmodus (T5; default 1). */
export interface ConstraintBudget {
  maxTotal: number;
  maxPerSource: number;
  vergelijkMin?: number;
}

/**
 * Leid de representatie-constraints af uit het profiel:
 *   generiek/undefined → geen quotum (fondsMin 0)  — zuiver generieke vraag.
 *   fonds              → fondsMin 1.
 *   gecombineerd       → fondsMin 1 + generiekMin 1.
 *   vergelijking       → perSourceMin q  (T5; toepassing volgt daar).
 * De basis (alle minima 0) reproduceert exact het huidige selecteerChunks-gedrag,
 * zodat de flag-uit-toestand non-regressief is.
 */
export function constraintsVoorProfiel(
  profiel: RepresentatieProfiel | undefined,
  budget: ConstraintBudget
): RepresentatieConstraints {
  const basis: RepresentatieConstraints = {
    fondsMin: 0,
    generiekMin: 0,
    perSourceMin: 0,
    maxPerSource: budget.maxPerSource,
    maxTotal: budget.maxTotal,
  };
  switch (profiel) {
    case "fonds":
      return { ...basis, fondsMin: 1 };
    case "gecombineerd":
      return { ...basis, fondsMin: 1, generiekMin: 1 };
    case "vergelijking":
      return { ...basis, perSourceMin: budget.vergelijkMin ?? 1 };
    case "generiek":
    default:
      return basis;
  }
}
