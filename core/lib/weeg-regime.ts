// ============================================================================
//  lib/weeg-regime.ts — T4 Regime-borging (Deel B). Regime-DEMOTIE (geen engine).
// ----------------------------------------------------------------------------
//  Pure, testbare herordening die het GELDENDE wettelijk regime van het fonds
//  leidend maakt en een NIET-geldend regime demoveert — niet uitsluit. Spiegelt
//  lib/weeg-bronsoort.ts: geen aparte engine, geen DB-toegang, herordent alleen
//  de over-fetch-kandidatenset ná retrieval (programmatisch na te rekenen via
//  lib/weeg-regime.sanity.ts).
//
//  De software stelt de JURIDISCHE KWALIFICATIE niet zelf vast: het geldende
//  regime komt uit beheerde data (fondsen.primair_wettelijk_regime) en het
//  documentfacet uit compliance-curatie (documenten.wettelijk_regime, gedenorm.
//  naar document_chunks). Deze module past die data alleen toe.
//
//  KERN (T4-DoD):
//   - Fonds met een SPECIFIEK regime (pw óf wvb): chunks met het TEGENGESTELDE
//     specifieke regime zakken naar onderaan (blijven beschikbaar als extern
//     kader — GEEN harde uitsluiting).
//   - `beide` / `algemeen` / NULL (cross-cutting) worden NOOIT gedemoveerd.
//   - Fonds zonder specifiek regime (beide/algemeen/NULL): geen demotie.
//
//  Plek in de bewerkingsvolgorde (T1): ná de bronsoort-weging, vóór de
//  representatie-constraints. Zie lib/rag.ts (gereserveerde plek).
// ============================================================================

/** De vier regime-waarden. NULL in de data ≡ 'algemeen' (cross-cutting). */
export type Regime = "pw" | "wvb" | "beide" | "algemeen";

/** Alleen deze twee zijn "specifiek" en kunnen leiden tot demotie van hun
 *  tegenpool. `beide`/`algemeen` zijn cross-cutting (nooit leidend/gedemoveerd). */
function isSpecifiek(regime: string | null | undefined): regime is "pw" | "wvb" {
  return regime === "pw" || regime === "wvb";
}

/**
 * Is `regime` voor een fonds met `fondsRegime` een NIET-geldend (extern) kader?
 * True uitsluitend wanneer beide specifiek én tegengesteld zijn (pw vs. wvb).
 * `beide`/`algemeen`/NULL zijn nooit extern; een fonds zonder specifiek regime
 * demoveert niets. Herbruikt door de prompt-labeling (B6) én de demotie-weging,
 * zodat "gelabeld als extern kader" en "gedemoveerd" exact dezelfde definitie
 * volgen.
 */
export function isExternKaderVoorFonds(
  regime: string | null | undefined,
  fondsRegime: string | null | undefined
): boolean {
  if (!isSpecifiek(fondsRegime)) return false; // fonds zonder specifiek regime
  const r = regime ?? "algemeen"; // NULL ≡ algemeen
  if (r === "beide" || r === "algemeen") return false; // cross-cutting nooit extern
  return r !== fondsRegime; // specifiek én tegengesteld
}

/** Prioriteit (lager = eerder). 1 = gedemoveerd (extern kader), 0 = behouden. */
function prioriteit(
  regime: string | null | undefined,
  fondsRegime: string | null | undefined
): number {
  return isExternKaderVoorFonds(regime, fondsRegime) ? 1 : 0;
}

/**
 * Herorden `items` zodat chunks met een niet-geldend (tegengesteld) regime ná de
 * geldende/cross-cutting chunks komen, met een STABIELE sortering (de volgorde
 * binnen een prioriteitsgroep — al bepaald door relevantie + bronsoort-weging —
 * blijft behouden). Niets wordt weggegooid: een gedemoveerd regime blijft als
 * AANVULLEND extern kader beschikbaar (T4-DoD: geen harde uitsluiting van PW).
 *
 * `regimeVan` ontkoppelt de helper van de chunk-vorm (DocumentChunk nest
 * wettelijk_regime onder `documenten`), zodat de functie puur en herbruikbaar
 * blijft — net als bibliotheekVan bij weegBronsoort.
 *
 * Is `fondsRegime` niet specifiek (beide/algemeen/NULL/undefined), dan is de
 * functie een no-op: exact de ingangsvolgorde terug (non-regressief).
 */
export function weegRegime<T>(
  items: T[],
  regimeVan: (item: T) => string | null | undefined,
  fondsRegime: string | null | undefined
): T[] {
  if (!isSpecifiek(fondsRegime)) return items; // niets te demoveren
  return items
    .map((item, index) => ({ item, index, p: prioriteit(regimeVan(item), fondsRegime) }))
    .sort((a, b) => a.p - b.p || a.index - b.index) // stabiel op originele index
    .map((x) => x.item);
}
