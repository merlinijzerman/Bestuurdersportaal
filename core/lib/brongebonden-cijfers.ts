/**
 * Smalle antwoordpoort voor vragen die een kwantitatieve waarde én een
 * controleerbare bron vragen. De inhoudelijke juistheid van een [Bron N]-claim
 * kan hiermee niet worden bewezen; de poort voorkomt wel dat een bronloos
 * bedrag of percentage al tijdens het streamen zichtbaar wordt.
 */

const KWANTITATIEVE_VRAAG = /\b(?:hoeveel|gemiddeld(?:e)?|kosten|bedrag(?:en)?|cijfer(?:s)?|percentage(?:s)?|rendement|dekkingsgraad|per deelnemer|euro)\b|€/i;
const BRONVRAAG = /\b(?:bron(?:nen)?|rapportage(?:s)?|jaarverslag(?:en)?|verslagjaar|publicatie(?:s)?)\b/i;
const GELD = /(?:€\s*\d|\b(?:EUR|euro)\s*\d|\b\d[\d.,]*\s*(?:€|euro|EUR)(?![\p{L}\d])|\b\d[\d.,]*\s*,\s*-\s*(?=\s|$)|\b\d[\d.,]*\s*(?:miljoen|miljard)\b)/iu;
const PERCENTAGE = /\b\d[\d.,]*\s*(?:%|procent(?:punt)?|basispunten|bp)(?![\p{L}\d])/iu;
const VERVOLG = /^(?:en\s+)?(?:voor\s+\d{4}\b|hoe\s+zit\s+het\s+met\b|geef\s+(?:dan\s+)?(?:een\s+)?(?:indicatie|schatting|bandbreedte)\b|en\s+(?:in|voor|bij)\b)/i;
const BRONMARKER = /\[Bron\s+(\d+)\]/gi;
const ALGEMENE_MARKER = /\[(?:Algemene kennis|Volgens wetgeving)\]/i;

export const BRONGEBONDEN_CIJFERS_INSTRUCTIE = `Deze vraag verlangt een cijfer met een controleerbare bron. Voor bedragen, percentages en andere gevraagde kengetallen gaat bronplicht vóór de algemene-kennisregel. Noem alleen een waarde als die in de aangeleverde passages staat en citeer de bijbehorende [Bron N] direct in dezelfde zin, lijstregel of tabelrij. Ontbreekt zo'n passage, zeg dan dat u geen verantwoord cijfer met de gevraagde bron en periode kunt geven. Geef ook geen schatting, bandbreedte of ordegrootte uit uw algemene kennis. U mag wel uitleggen welk type openbare rapportage nodig is.`;

export const BRONGEBONDEN_CIJFERS_TERUGVAL =
  "Ik kan op basis van de geraadpleegde passages geen verantwoord cijfer met de gevraagde bron en verslagperiode geven. Raadpleeg een openbare sectorrapportage of de jaarverslagen en vergelijk de gebruikte definities en jaren.";

export function vraagtBrongebondenCijfer(vraag: string): boolean {
  return KWANTITATIEVE_VRAAG.test(vraag) && BRONVRAAG.test(vraag);
}

/** Bewaar de bronplicht bij korte vervolgvragen over hetzelfde cijfer. */
export function vraagtBrongebondenCijferInGesprek(
  vraag: string,
  eerdereGebruikersvragen: string[]
): boolean {
  if (vraagtBrongebondenCijfer(vraag)) return true;
  if (!VERVOLG.test(vraag.trim())) return false;
  return eerdereGebruikersvragen.slice(-3).some(vraagtBrongebondenCijfer);
}

/**
 * Vangt bedragen en percentages zonder eigen documentcitatie. Jaar- en
 * artikelnummers blijven buiten deze detector. Er is bewust geen poging tot
 * semantische verificatie van de passage achter een geldige marker.
 */
export function heeftBronloosCijfer(antwoord: string, aantalBronnen: number): boolean {
  const eenheden = antwoord.split(/\n|(?<=[.!?])\s+(?=[\p{Lu}])/u);
  return eenheden.some((eenheid) => {
    if (!GELD.test(eenheid) && !PERCENTAGE.test(eenheid)) return false;
    if (ALGEMENE_MARKER.test(eenheid)) return true;
    const citaties = [...eenheid.matchAll(BRONMARKER)];
    return !citaties.some((match) => {
      const nummer = Number(match[1]);
      return Number.isInteger(nummer) && nummer >= 1 && nummer <= aantalBronnen;
    });
  });
}
