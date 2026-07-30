// ============================================================================
//  lib/fts-terugval.ts — losse OR-terugval voor de Dutch-FTS-arm (30-07-2026).
// ----------------------------------------------------------------------------
//  PROBLEEM (geverifieerd op productie-logdata). `websearch_to_tsquery('dutch', …)`
//  maakt van een hele vraagzin een AND-keten: elk inhoudswoord moet in dezelfde
//  chunk staan. Een natuurlijke vraag als "documenten met beleggingsbeleid ken je?"
//  eist dan `documenten & beleggingsbeleid & ken` — en dat matcht niets, ook al
//  gaat er een compleet bestuursvoorstel over beleggingsbeleid.
//
//  Gevolg in de cascade van `zoekRelevanteChunksMetMeta`: poging 1 (gerangschikte
//  RPC) én poging 2 (`fts_plain`, eveneens AND) leveren niets, en de retrieval
//  landt op poging 3 — de **ilike**-vangnet. Dat pad heeft GEEN ranking
//  (`rang = null`), is uitgesloten van de reranker (`rerankToegestaan = false`) en
//  levert ilike-treffers die nooit citeerbaar zijn (R1.5 b1, besluit 0073). In het
//  governance-log stond `methode: "ilike"` bij precies deze vragen: de assistent
//  antwoordde dus op een ongerangschikt vangnet terwijl de gerangschikte paden
//  ongebruikt bleven.
//
//  OPLOSSING. Vóórdat de cascade naar het vangnet valt: één extra poging op de
//  GERANGSCHIKTE RPC met een verslapte query — de inhoudswoorden als OR-keten.
//  Zo blijft `ts_rank_cd`-ordening, bronsoort-weging, de reranker (R1.3) en de
//  relevantie-ondergrens (R1.5) van toepassing. Strikt beter dan het ilike-pad,
//  óók met de R1.3/R1.5-vlaggen uit: een gerangschikte OR-set verslaat een
//  ongerangschikte substring-set.
//
//  BEWUST GEEN vervanging van de strikte query. De AND-keten is precies wat een
//  meerwoordsvraag scherp houdt; die blijft poging 1. Dit is uitsluitend een
//  terugval wanneer streng zoeken NIETS oplevert — recall erbij zonder precisie
//  af te geven waar precisie werkt.
//
//  Pure, deterministische functie (geen DB/SDK). Sanity: lib/fts-terugval.sanity.ts.
// ============================================================================

/** Versiestempel; bump bij inhoudelijke wijziging zodat een gedragsverschil
 *  traceerbaar blijft in retrieval_meta.terugval-analyses. */
export const TERUGVAL_LEXICON_VERSIE = "terugval-v1";

/** Maximaal aantal OR-termen. Ruim boven een normale vraag, en een bovengrens
 *  tegen query-explosie bij een lange geplakte alinea. */
const MAX_TERMEN = 8;

/** Minimale lengte van een inhoudswoord. Bewust 4: "wet" en "abtn" zijn kort maar
 *  betekenisvol en staan daarom in KORTE_UITZONDERINGEN; de rest van de korte
 *  woorden in het Nederlands is functiewoord. */
const MIN_LENGTE = 4;

/** Korte woorden die wél inhoud dragen in dit domein. */
const KORTE_UITZONDERINGEN = new Set(["wet", "wtp", "abtn", "dnb", "afm", "vo", "alm", "esg"]);

/**
 * Functie- en vraagwoorden die geen onderscheidende kracht hebben. Bewust
 * gecureerd en klein: elk woord dat je hier weghaalt, haal je uit de OR-keten van
 * ELKE terugvalvraag. Woorden die in dit domein juist onderscheidend zijn
 * (bijvoorbeeld "besluit", "voorstel", "beleid") staan hier NIET in.
 */
const STOPWOORDEN = new Set([
  // lidwoorden, voornaamwoorden, voegwoorden, voorzetsels
  "een", "het", "de", "der", "des", "den", "dit", "dat", "die", "deze", "zijn", "haar",
  "onze", "ons", "mijn", "jouw", "uw", "hun", "wij", "jij", "jullie", "hij", "zij",
  "met", "voor", "over", "naar", "door", "vanuit", "binnen", "buiten", "tussen",
  "van", "aan", "bij", "uit", "tot", "onder", "boven", "zonder", "omtrent", "inzake",
  "en", "of", "maar", "want", "dus", "als", "dan", "ook", "nog", "wel", "niet", "geen",
  "er", "daar", "hier", "toen", "nu", "al", "reeds",
  // vraag- en werkwoorden zonder onderscheidende kracht
  "welke", "welk", "wat", "wie", "waar", "waarom", "hoe", "wanneer", "hoeveel",
  "ken", "kent", "kennen", "weet", "weten", "heb", "hebt", "heeft", "hebben",
  "ben", "bent", "is", "was", "waren", "wordt", "worden", "werd", "werden",
  "kan", "kunt", "kunnen", "kun", "mag", "mogen", "moet", "moeten", "zal", "zullen",
  "graag", "even", "eens", "misschien", "svp", "aub",
]);

export interface TerugvalQuery {
  /** De OR-keten zoals die aan websearch_to_tsquery wordt meegegeven. */
  query: string;
  /** De gekozen termen, in volgorde — voor het auditspoor. */
  termen: string[];
  versie: string;
}

/** Verwijdert diacritics en leestekens, en maakt lowercase. */
function normaliseer(tekst: string): string {
  return tekst
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ");
}

/**
 * Bouw een verslapte OR-query uit de inhoudswoorden van de vraag. Geeft `null`
 * terug wanneer er niets zinnigs overblijft — de aanroeper valt dan gewoon door
 * naar de bestaande cascade (geen gedragswijziging).
 *
 * Voorbeeld:
 *   "documenten met beleggingsbeleid ken je?" → "documenten OR beleggingsbeleid"
 *   (`met`, `ken`, `je` vallen af; de AND-keten die niets vond wordt een OR-keten
 *   die de bestuursvoorstel-chunks bereikt.)
 */
export function bouwTerugvalFtsQuery(vraag: string): TerugvalQuery | null {
  const woorden = normaliseer(vraag).split(/\s+/).filter(Boolean);
  const termen: string[] = [];
  const gezien = new Set<string>();

  for (const w of woorden) {
    if (termen.length >= MAX_TERMEN) break;
    if (STOPWOORDEN.has(w)) continue;
    if (w.length < MIN_LENGTE && !KORTE_UITZONDERINGEN.has(w)) continue;
    if (gezien.has(w)) continue;
    gezien.add(w);
    termen.push(w);
  }

  if (termen.length === 0) return null;
  // Eén term levert dezelfde query op als de strikte variant; dan heeft de
  // terugval geen toegevoegde waarde en slaan we hem over (geen dubbele RPC).
  if (termen.length === 1) return null;

  return { query: termen.join(" OR "), termen, versie: TERUGVAL_LEXICON_VERSIE };
}
