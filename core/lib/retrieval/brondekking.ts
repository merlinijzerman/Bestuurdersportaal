// ============================================================================
//  #548-R5 — Antwoordgrens voor afwezigheidsclaims bij juridische bronnen.
// ----------------------------------------------------------------------------
//  PUUR: geen I/O.
//
//  HET PROBLEEM (Productiehertest 6 oktober 2026). Op de brede vraag naar de
//  termijnen voor individuele waardeoverdracht noemde het antwoord de juiste
//  Besluitartikelen, maar beweerde dat art. 19a, 19b en 22 "niet in de bronset
//  zitten". De bronnen waren een SELECTIE: art. 19 en 20 verwijzen naar
//  "artikel 19a of artikel 19b", en de geselecteerde 19a/19b-passages waren
//  vervolgchunks zonder eigen artikelkop. Het model leidde uit "niet gezien"
//  af "ontbreekt".
//
//  DE GRENS. Staat er ten minste één JURIDISCHE bron (wetgeving of
//  wetsgeschiedenis, dezelfde duiding als de bronkop) in de aangeleverde
//  context, dan krijgt de gebruikersprompt een korte, vaste instructie:
//  afwezigheid alleen relatief aan de aangeleverde passages formuleren, nooit als eigenschap van het document; en gelijkgenummerde
//  artikelen uit verschillende regelingen niet verwisselen. Volledige dekking
//  van een document wordt in het gewone RAG-pad nooit vastgesteld; de
//  volledige-sectie- en documentroutes hebben hun eigen DEKKINGSCONTRACT en
//  vallen hier buiten.
//
//  BRONAFHANKELIJK, NIET INTENTIEAFHANKELIJK. De grens hangt aan wat er in de
//  context staat (juridische deelpassages), niet aan de R-2-classifier: die
//  mag in de route alleen naar audit en de centrale retrievallaag (invariant
//  R2-A3). Zonder juridische bron: `null` — de prompt blijft exact die van
//  vóór #548-R5 (gewone fondsvragen). De toon-systeemprompt wijzigt niet.
// ============================================================================
import { juridischeRolVan } from "./juridisch-beleid";

export const BRONDEKKING_INSTRUCTIE = `BRONDEKKING (juridische bronnen): u zag alleen geselecteerde passages, niet de volledige regelingen.
- Zeg nooit dat een artikel of bepaling in een regeling ontbreekt, niet bestaat of niet is aangeleverd. Formuleer hooguit: "Artikel … staat niet in de aangeleverde passages."
- Een passage zonder eigen artikelkop kan het vervolg van een artikel zijn; de bronkop vermeldt het artikel als dat bekend is.
- Een verwijzing naar een artikel in een passage betekent niet dat de tekst van dat artikel is aangeleverd.
- Een artikel met hetzelfde nummer uit een andere regeling is een ander artikel: noem bij elk artikel de regeling waaruit het komt en gebruik het nooit als vervanging.`;

/** De instructie voor deze beurt, of `null` (geen juridische bron in de context). */
export function brondekkingsinstructie(
  aangeleverd: readonly { documenttype?: string | null; wetsgeschiedenisSubtype?: string | null }[]
): string | null {
  return aangeleverd.some((b) => juridischeRolVan(b.documenttype, b.wetsgeschiedenisSubtype) !== null)
    ? BRONDEKKING_INSTRUCTIE
    : null;
}
