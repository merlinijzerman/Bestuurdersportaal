// ============================================================================
//  Documentspoor — een letterlijk genoemd (niet-juridisch) document in een
//  vrije vraag.
// ----------------------------------------------------------------------------
//  PUUR en PROVIDERNEUTRAAL: geen I/O, geen DB, geen chunkvorm.
//
//  HET PROBLEEM. Een vrije vraag naar een openbaar DNB-document noemt de
//  volledige titel, maar heeft geen gekozen documentscope. Als het hybride
//  pad na een DB-time-out terugvalt op tekstzoeken, krijgt de OR-terugval
//  veel titelwoorden. `zoek_vector` bevat de contextprefix (met de titel)
//  van ELKE chunk; daardoor wonnen de titel- en inleidingspagina's (p. 1/3/5)
//  de rangschikking. De
//  maatregelen op p. 17 kwamen niet in de antwoordcontext. De twee bestaande
//  bindingen dekten de vraag niet: M3 (`resolveerGenoemdDocument`) staat achter
//  de vlag `vraagrouter_v2`, en #548-R5 bindt alleen juridische documenten.
//
//  DE OPLOSSING (aanvullend, geen scope). Noemt de vraag letterlijk de
//  VOLLEDIGE titel van precies één toegankelijk document, dan zoekt de adapter
//  daarnaast binnen dat document met de vraag zónder die titel, en zet de
//  beste passages vooraan in de kandidatenpool. De gewone retrieval blijft
//  staan; het antwoord wordt niet tot het document beperkt en er verschijnt
//  geen keuzevraag. Twee of meer passende titels: geen binding (exact het
//  gedrag van vóór deze wijziging).
//
//  BEWUST NIET `resolveerGenoemdDocument`. Die laat naast een volledige titel
//  ook één los titelwoord van ≥ 8 tekens tellen; "pensioenfondsen" zou dan elke
//  DNB-good-practice raken en de vraag ambigu maken of aan een verkeerd
//  document binden. Hier geldt het strikte #548-R5-predicaat: de volledige
//  titelkern met woordgrenzen, de langste naam wint, plus een minimale
//  titellengte zodat een kale titel als "Beleggingsbeleid" niet elke vraag
//  over beleggingsbeleid aan één document hangt.
// ============================================================================
import { genoemdeJuridischeDocumenten, naamvorm, titelkern } from "./artikelverwijzing";

/** Minimaal aantal woorden in de titelkern. */
export const MIN_TITELWOORDEN = 3;
/** Minimale lengte van de genormaliseerde titelkern. */
export const MIN_TITELTEKENS = 16;

export interface BenoembaarDocument {
  id: string;
  titel: string | null;
}

export type DocumentspoorBinding =
  | { status: "geen" }
  /** Meer dan één document past letterlijk: niet gokken, geen binding. */
  | { status: "meerdere"; aantal: number }
  /**
   * Precies één document. `restvraag` is de vraag zonder de titel; zo bepaalt
   * de titel niet langer welke passage binnen het document wint.
   */
  | { status: "eenduidig"; documentId: string; restvraag: string };

function isNoembaar(titel: string | null): boolean {
  const kern = titelkern(titel ?? "");
  return kern.length >= MIN_TITELTEKENS && kern.split(" ").length >= MIN_TITELWOORDEN;
}

/**
 * Bindt de vraag aan een letterlijk genoemd document, of niet. De documenten
 * zijn de aanroeper zijn verantwoordelijkheid: alleen wat onder RLS zichtbaar,
 * actief, geïndexeerd en (WP3) schoon gescand is.
 *
 * `teksten` volgt #548-R5: [zoekvraag, origineleVraag]. Een herformulering van
 * een vervolgvraag kan de letterlijk genoemde titel verliezen; de oorspronkelijke
 * gebruikerstaal bindt dan nog. Noemen de teksten samen meer dan één document
 * (ook: elk een ander), dan is er geen binding. De restvraag komt uit de EERSTE
 * tekst die de titel letterlijk bevat, zodat de zoekslag past bij de tekst die
 * de binding droeg.
 */
export function bindGenoemdDocument(
  teksten: string | readonly (string | null | undefined)[],
  documenten: readonly BenoembaarDocument[]
): DocumentspoorBinding {
  const lijst = (typeof teksten === "string" ? [teksten] : teksten)
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  const noembaar = documenten.filter((d) => isNoembaar(d.titel));
  if (lijst.length === 0 || noembaar.length === 0) return { status: "geen" };
  const treffers = genoemdeJuridischeDocumenten(lijst, noembaar);
  if (treffers.length === 0) return { status: "geen" };
  if (treffers.length > 1) return { status: "meerdere", aantal: treffers.length };

  const documentId = treffers[0];
  const kern = titelkern(noembaar.find((d) => d.id === documentId)?.titel ?? "");
  const bron = lijst.find((t) => naamvorm(t).includes(` ${kern} `)) ?? lijst[0];
  let rest = naamvorm(bron);
  while (rest.includes(` ${kern} `)) rest = rest.replace(` ${kern} `, " ");
  const restvraag = rest.trim();
  // Zonder resterende inhoud ("Good practice ESG risicobeheer pensioenfondsen?")
  // zoekt het spoor op de volledige tekst; de titel is dan de vraag.
  return { status: "eenduidig", documentId, restvraag: restvraag.length > 0 ? restvraag : bron };
}

/** Minimale lengte van een woord dat de titelopzoeking mag versmallen. */
export const MIN_ZOEKTERM = 6;
/** Maximaal aantal zoektermen in de titelopzoeking (tegen query-explosie). */
export const MAX_ZOEKTERMEN = 8;

/**
 * De woorden waarmee de adapter de titelopzoeking versmalt: een titel kan
 * alleen letterlijk in de vraag staan als zijn woorden dat ook doen, dus elk
 * kandidaatdocument bevat minstens één van deze woorden (de langste eerst).
 * Leeg = geen woord lang genoeg = geen documentquery. Alleen letters en
 * cijfers, zodat een term nooit de PostgREST-filtersyntaxis raakt.
 *
 * Grens, bewust fail-safe: een titel waarvan elk woord korter is dan
 * MIN_ZOEKTERM, of een vraag met meer dan MAX_ZOEKTERMEN langere woorden, kan
 * een binding missen. Dan blijft het gedrag van vóór dit spoor.
 */
export function titelzoektermen(teksten: string | readonly (string | null | undefined)[]): string[] {
  const lijst = (typeof teksten === "string" ? [teksten] : teksten).filter((t): t is string => typeof t === "string");
  const woorden = lijst.flatMap((t) => naamvorm(t).trim().split(" "))
    .filter((w) => w.length >= MIN_ZOEKTERM && /^[\p{L}\p{N}]+$/u.test(w));
  return [...new Set(woorden)]
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_ZOEKTERMEN);
}
