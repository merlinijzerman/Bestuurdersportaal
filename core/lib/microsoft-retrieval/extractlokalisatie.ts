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
//  ── ZOEKEN OP DE ENE TEKST, KNIPPEN UIT DE ANDERE ──────────────────────────
//  De vergelijking gebeurt op een GENORMALISEERDE vorm (anders loopt een
//  inhoudelijk identiek extract stuk op opmaak), maar de passage moet uit de
//  LEESBARE tekst komen. Die twee hebben niet dezelfde lengte: witruimte wordt
//  samengetrokken, stuurtekens verdwijnen, kapitalisatie kan een teken langer
//  of korter maken. Een positie uit de ene tekst rechtstreeks op de andere
//  toepassen levert dus een venster op de verkeerde plek op — bij een segment
//  met veel dubbele spaties liep dat in de meting 600 tekens uiteen, ruim genoeg
//  om de treffer volledig buiten de passage te laten vallen.
//
//  Daarom levert de normalisatie een INDEXKAART mee: per teken in de
//  genormaliseerde tekst de positie waar het in de leesbare tekst begon. Er is
//  één normalisatiefunctie; `normaliseerVoorLokalisatie()` is niets anders dan
//  de tekst uit diezelfde kaart, zodat naald en hooiberg niet uiteen kunnen
//  lopen.
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

/** Typografische varianten die geen betekenisverschil dragen. */
const TYPOGRAFIE = new Map<string, string>([
  ["‘", "'"], ["’", "'"], ["‚", "'"], ["′", "'"],
  ["“", '"'], ["”", '"'], ["„", '"'], ["″", '"'],
  ["‐", "-"], ["‑", "-"], ["‒", "-"], ["–", "-"],
  ["—", "-"], ["―", "-"], ["−", "-"],
]);

/** Witruimte in brede zin: ook harde spaties en stuurtekens. */
function isWitruimte(teken: string): boolean {
  return /\s/.test(teken) || /[\u0000-\u001f\u007f\u00a0\u2007\u202f]/.test(teken);
}

export interface GenormaliseerdeTekst {
  /** Waarop wordt vergeleken. */
  tekst: string;
  /**
   * Per UTF-16-eenheid in `tekst` de startpositie in `leesbaar`. Zonder deze
   * kaart is een positie in de ene tekst betekenisloos in de andere.
   */
  naarLeesbaar: number[];
  /** De NFKC-vorm van de invoer; hieruit wordt de passage geknipt. */
  leesbaar: string;
}

/**
 * Normaliseert vorm, niet inhoud, en houdt bij waar elk teken vandaan komt.
 *
 * NFKC gebeurt in één keer over de hele string (combinerende tekens hebben hun
 * buren nodig); de resterende stappen zijn per teken en daarmee exact te
 * volgen. Kapitalisatie wordt per teken omgezet — voor een enkel schrift, zoals
 * Grieks aan woordeinde, wijkt dat theoretisch af van omzetting over de hele
 * string, maar de uitkomst blijft aan beide kanten van de vergelijking gelijk
 * omdat naald en hooiberg door dezelfde functie gaan.
 */
export function normaliseerMetIndexkaart(bron: string): GenormaliseerdeTekst {
  const leesbaar = bron.normalize("NFKC");
  let tekst = "";
  const naarLeesbaar: number[] = [];
  let positie = 0;
  let vorigeWasSpatie = true; // leidende witruimte valt weg (trim)

  for (const teken of leesbaar) {
    const start = positie;
    positie += teken.length;

    if (isWitruimte(teken)) {
      if (vorigeWasSpatie) continue; // samentrekken
      tekst += " ";
      naarLeesbaar.push(start);
      vorigeWasSpatie = true;
      continue;
    }
    vorigeWasSpatie = false;

    const vervangen = TYPOGRAFIE.get(teken) ?? teken;
    const klein = vervangen.toLocaleLowerCase("nl");
    tekst += klein;
    // Eén bronteken kan meerdere eenheden opleveren; ze wijzen alle naar de
    // plek waar het originele teken begon.
    for (let i = 0; i < klein.length; i++) naarLeesbaar.push(start);
  }

  if (tekst.endsWith(" ")) {
    tekst = tekst.slice(0, -1);
    naarLeesbaar.pop();
  }
  return { tekst, naarLeesbaar, leesbaar };
}

/**
 * De vergelijkingsvorm. Eén implementatie, gedeeld met de indexkaart: liepen ze
 * uiteen, dan zou de naald op een andere manier genormaliseerd zijn dan de
 * hooiberg en vond de lokalisatie stil niets meer.
 */
export function normaliseerVoorLokalisatie(tekst: string): string {
  return normaliseerMetIndexkaart(tekst).tekst;
}

/**
 * Knipt een leesbaar venster rond de treffer, op woordgrenzen.
 *
 * `start` en `eind` zijn posities in de LEESBARE tekst — vertaald via de
 * indexkaart, niet overgenomen uit de genormaliseerde vorm.
 */
function venster(leesbaar: string, start: number, eind: number): string {
  if (leesbaar.length <= MAX_PASSAGE_TEKENS) return leesbaar.trim();
  const trefferLengte = Math.max(0, eind - start);
  const ruimte = Math.max(0, MAX_PASSAGE_TEKENS - trefferLengte);
  const vanaf = Math.max(0, start - Math.floor(ruimte / 2));
  const tot = Math.min(leesbaar.length, vanaf + MAX_PASSAGE_TEKENS);
  const stuk = leesbaar.slice(vanaf, tot);

  // Halve woorden aan de randen eraf, maar nooit zo ver dat de treffer zelf
  // wegvalt: de passage moet bevatten waarop zij is gevonden.
  const trefferInStuk = start - vanaf;
  const eersteSpatie = stuk.indexOf(" ");
  const laatsteSpatie = stuk.lastIndexOf(" ");
  const knipVoor = vanaf > 0 && eersteSpatie >= 0 && eersteSpatie + 1 <= trefferInStuk ? eersteSpatie + 1 : 0;
  const knipNa = tot < leesbaar.length && laatsteSpatie > trefferInStuk + trefferLengte ? laatsteSpatie : stuk.length;
  return stuk.slice(knipVoor, knipNa).trim();
}

/**
 * Zoekt het extract in de eigen segmenten en eist precies één voorkomen.
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
    const { tekst, naarLeesbaar, leesbaar } = normaliseerMetIndexkaart(segment.tekst);
    if (tekst.length === 0) continue;

    let vanaf = 0;
    for (;;) {
      const positie = tekst.indexOf(naald, vanaf);
      if (positie === -1) break;

      // DE VERTAALSLAG. `positie` geldt in `tekst`; de passage komt uit
      // `leesbaar`, en die twee hebben niet dezelfde lengte.
      const start = naarLeesbaar[positie] ?? 0;
      const laatste = naarLeesbaar[positie + naald.length - 1] ?? start;
      // Het laatste bronteken kan meerdere eenheden beslaan; neem de volgende
      // grens als einde, of het einde van de tekst.
      const eind = naarLeesbaar[positie + naald.length] ?? leesbaar.length;
      treffers.push({
        passage: venster(leesbaar, start, Math.max(eind, laatste + 1)),
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
