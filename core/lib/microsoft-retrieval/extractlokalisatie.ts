// ============================================================================
//  #413 T4-C — Het Microsoft-extract lokaliseren in de EIGEN extractie.
// ----------------------------------------------------------------------------
//  DIT IS DE PLEK WAAR HET EXTRACT ZIJN ROL VERLIEST. Copilot levert per hit
//  een stuk tekst. Dat stuk gaat NOOIT naar het model, nooit in een citaat en
//  nooit in de audit: het is uitsluitend een AANWIJZER. Wij zoeken het terug in
//  de tekst die wij zelf uit het actuele bestand hebben gehaald, en wat het
//  model ziet is die eigen passage.
//
//  Waarom dat verschil ertoe doet: het extract is tekst uit een index die
//  minuten of dagen oud kan zijn, en waarvan wij de herkomst niet kunnen
//  controleren. De eigen extractie komt uit bytes die wij in deze beurt hebben
//  gedownload, tussen twee gelijke versiebewijzen in.
//
//  ── UNIEK, OF NIET ─────────────────────────────────────────────────────────
//  Het extract moet PRECIES ÉÉN keer voorkomen. Twee treffers betekenen dat
//  niet is aan te wijzen wélke passage geciteerd wordt — en een citaat dat naar
//  de verkeerde plek in hetzelfde document wijst, is net zo fout als een citaat
//  uit het verkeerde document. Nul treffers betekent dat het extract niet meer
//  in de actuele tekst staat. Beide vallen fail-closed af.
//
//  ── NORMALISEREN, MAAR NIET MEER DAN NODIG ─────────────────────────────────
//  Word en PDF leveren dezelfde zin met andere aanhalingstekens, streepjes en
//  witruimte dan de index. Zonder normalisatie zou een inhoudelijk identiek
//  extract op opmaak stuklopen. De normalisatie raakt daarom alleen vorm:
//  Unicode-vorm, typografische leestekens, witruimte en kapitalisatie. Zij
//  verwijdert nooit woorden en verandert nooit de volgorde.
// ============================================================================
import type { TekstSegment } from "../document-extractie";

/**
 * Onder deze lengte telt een extract niet als bewijs. Een kort fragment ("de
 * termijn") komt in elk document meermaals voor; uniciteit zegt dan niets.
 */
export const MIN_EXTRACT_TEKENS = 24;

/** Bovengrens op de passage die het model te zien krijgt. */
export const MAX_PASSAGE_TEKENS = 1_200;

export type LokalisatieAfwijzing = "extractie" | "lokalisatie";

export interface Lokalisatie {
  /** ALTIJD uit de eigen extractie; nooit de Microsoft-tekst. */
  passage: string;
  pagina: number | null;
  paragraaf: string | null;
}

/**
 * Normaliseert vorm, niet inhoud. Beide kanten van de vergelijking gaan hier
 * doorheen, zodat een verschil in opmaak geen verschil in betekenis wordt.
 */
export function normaliseerVoorLokalisatie(tekst: string): string {
  return tekst
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("nl");
}

/** Een venster rond de treffer, op woordgrenzen afgekapt. */
function venster(tekst: string, positie: number, lengte: number): string {
  if (tekst.length <= MAX_PASSAGE_TEKENS) return tekst.trim();
  const ruimte = Math.max(0, MAX_PASSAGE_TEKENS - lengte);
  const start = Math.max(0, positie - Math.floor(ruimte / 2));
  const eind = Math.min(tekst.length, start + MAX_PASSAGE_TEKENS);
  const stuk = tekst.slice(start, eind);
  // Eerste en laatste (mogelijk halve) woord eraf, tenzij we aan de rand zitten.
  const vanaf = start > 0 ? stuk.indexOf(" ") + 1 : 0;
  const tot = eind < tekst.length ? stuk.lastIndexOf(" ") : stuk.length;
  return stuk.slice(vanaf, tot > vanaf ? tot : undefined).trim();
}

/**
 * Zoekt het extract in de eigen segmenten en eist precies één voorkomen.
 *
 * De posities worden bepaald op de GENORMALISEERDE tekst, maar de passage komt
 * uit de ORIGINELE segmenttekst: wat het model ziet moet leesbaar zijn, niet
 * ontdaan van hoofdletters en leestekens.
 */
export function lokaliseerExtract(
  segmenten: readonly TekstSegment[],
  extract: string,
): { ok: true; lokalisatie: Lokalisatie } | { ok: false; afwijzing: LokalisatieAfwijzing } {
  const naald = normaliseerVoorLokalisatie(extract);
  // Te kort om iets te bewijzen — en dat is een eigenschap van het EXTRACT,
  // niet van onze extractie.
  if (naald.length < MIN_EXTRACT_TEKENS) return { ok: false, afwijzing: "extractie" };

  const treffers: Lokalisatie[] = [];
  for (const segment of segmenten) {
    const genormaliseerd = normaliseerVoorLokalisatie(segment.tekst);
    if (genormaliseerd.length === 0) continue;

    let vanaf = 0;
    for (;;) {
      const positie = genormaliseerd.indexOf(naald, vanaf);
      if (positie === -1) break;
      treffers.push({
        passage: venster(segment.tekst, positie, naald.length),
        pagina: segment.pagina,
        paragraaf: segment.paragraaf,
      });
      // Twee is al genoeg om ambigu te zijn; verder zoeken heeft geen zin.
      if (treffers.length > 1) return { ok: false, afwijzing: "lokalisatie" };
      vanaf = positie + naald.length;
    }
  }

  if (treffers.length !== 1) return { ok: false, afwijzing: "lokalisatie" };
  const gevonden = treffers[0];
  // Een lege passage kan nooit een citaat dragen.
  if (gevonden.passage.trim().length === 0) return { ok: false, afwijzing: "lokalisatie" };
  return { ok: true, lokalisatie: gevonden };
}

/**
 * Probeert de aangeboden extracts op volgorde en neemt de EERSTE die uniek te
 * lokaliseren is.
 *
 * Waarom niet "de beste": er is geen maat om extracts onderling te wegen zonder
 * het oordeel van de provider over te nemen. De volgorde is die van Copilot;
 * wat wij toevoegen is de eis dat het terug te vinden is in onze eigen tekst.
 */
export function lokaliseerEersteBruikbare(
  segmenten: readonly TekstSegment[],
  extracts: readonly string[],
): { ok: true; lokalisatie: Lokalisatie } | { ok: false; afwijzing: LokalisatieAfwijzing } {
  if (extracts.length === 0) return { ok: false, afwijzing: "extractie" };
  let laatste: LokalisatieAfwijzing = "extractie";
  for (const extract of extracts) {
    const uitkomst = lokaliseerExtract(segmenten, extract);
    if (uitkomst.ok) return uitkomst;
    laatste = uitkomst.afwijzing;
  }
  return { ok: false, afwijzing: laatste };
}
