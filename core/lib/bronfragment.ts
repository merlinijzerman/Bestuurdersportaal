// ============================================================================
//  bronfragment — het citaat onder een [Bron N]-verwijzing
// ----------------------------------------------------------------------------
//  Het fragment is sinds tranche 2 het BEWIJSSTUK: het staat in de hover-preview
//  op de pill, waar de bestuurder een bewering controleert zonder naar het
//  onderbouwingspaneel te scrollen. Daar is `chunk.tekst.substring(0, 150) + "..."`
//  te kort en te grof — het kapt midden in een zin, en plakte de puntjes er óók
//  aan als de chunk kórter was dan 150 tekens (schijnzekerheid: het suggereerde
//  een afkapping die er niet was).
//
//  Deze module is bewust puur en Supabase-vrij: de regel moet reproduceerbaar en
//  testbaar zijn (bronfragment.sanity.ts), want hij bepaalt wat er als citaat in
//  gesprekken.berichten en in governance_log.bronnen belandt.
//
//  NB — het fragment gaat NIET naar de prompt. maakContext() bouwt de
//  modelcontext uit expliciet benoemde velden (bronlabel, locatie, brontekst);
//  het bronnen-array wordt nergens geserialiseerd. Deze lengte kost dus geen
//  modeltokens, alleen payload- en auditomvang.
// ============================================================================

/** Bovengrens van het citaat in tekens. */
export const FRAGMENT_MAX = 300;

/**
 * Minimaal deel van FRAGMENT_MAX dat een zinsgrens moet halen om te winnen van
 * een woordgrens. Zonder deze ondergrens zou één vroege punt ("Zie art. 3.") een
 * citaat van vier woorden opleveren, terwijl er 300 tekens beschikbaar waren.
 */
const ZINSGRENS_ONDERGRENS = 0.6;

/**
 * Afkapmarkering. Staat er ALTIJD als er tekst is weggelaten — óók wanneer het
 * citaat toevallig netjes op een punt eindigt.
 *
 * Dit is een governance-eis, geen typografie. Een zin is niet hetzelfde als het
 * einde van de brontekst: "Het bestuur stelt de regeling vast." leest als een
 * compleet citaat, terwijl de weggevallen volgende zin "Deze regeling geldt niet
 * voor deelnemers die vóór 2020 zijn uitgetreden." de strekking omkeert. Zonder
 * markering ziet de bestuurder niet dát er iets volgde.
 */
const AFKAPMARKERING = "…";

/**
 * Zinseinde: . ! of ? met optioneel sluitend aanhalingsteken/haakje, gevolgd door
 * witruimte. Bewust als BRON en niet als gedeeld RegExp-object: een `g`-regex
 * draagt zijn eigen `lastIndex` mee, en dat is muteerbare state in een module die
 * verder puur is. Elke aanroep krijgt een verse instantie.
 */
const ZINSEINDE_BRON = /[.!?]["'”’)\]]?\s/g;

/**
 * Bouwt het citaat bij een bronvermelding.
 *
 * Regels, in volgorde:
 *  1. Witruimte (inclusief regeleindes) wordt genormaliseerd tot enkele spaties —
 *     het citaat wordt als lopende tekst getoond, niet als brok bestandsopmaak.
 *  2. Past de tekst binnen `max`, dan komt hij ONGEWIJZIGD terug: geen puntjes.
 *  3. Anders wordt afgekapt op de laatste zinsgrens binnen `max`, mits die ten
 *     minste 60% van `max` haalt.
 *  4. Lukt dat niet, dan op de laatste woordgrens; is er ook geen spatie, dan
 *     hard op `max` (één lang woord).
 *  5. Is er afgekapt — op wélke grens dan ook — dan sluit het citaat af met één
 *     beletselteken. Zie AFKAPMARKERING: ook een citaat dat op een punt eindigt
 *     kan een voorbehoud hebben weggesneden.
 */
export function bouwBronfragment(tekst: string, max: number = FRAGMENT_MAX): string {
  const genormaliseerd = tekst.replace(/\s+/g, " ").trim();
  if (genormaliseerd.length <= max) return genormaliseerd;

  // Eén teken extra meenemen, zodat een zinseinde exact óp de grens (dat een
  // volgende spatie nodig heeft) nog gevonden wordt.
  const venster = genormaliseerd.slice(0, max + 1);

  let zinsgrens = -1;
  for (const m of venster.matchAll(new RegExp(ZINSEINDE_BRON))) {
    // Einde van de leestekens, vóór de witruimte.
    const einde = (m.index ?? 0) + m[0].length - 1;
    if (einde <= max) zinsgrens = einde;
  }
  if (zinsgrens >= max * ZINSGRENS_ONDERGRENS) {
    // Het leesteken van de zin blijft staan — dat hoort bij het citaat. Daarachter
    // komt de markering, zodat "…vast. …" leest als "en er volgde nog iets".
    return `${genormaliseerd.slice(0, zinsgrens).trim()} ${AFKAPMARKERING}`;
  }

  const kaal = genormaliseerd.slice(0, max);
  const spatie = kaal.lastIndexOf(" ");
  const kort = spatie > 0 ? kaal.slice(0, spatie) : kaal;
  // Afsluitende leestekens weghalen zodat er nooit ",…" of ".…" ontstaat.
  return `${kort.replace(/[\s.,;:]+$/, "")}${AFKAPMARKERING}`;
}
