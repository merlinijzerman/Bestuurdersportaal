// ============================================================================
//  Voorbeeldvragen bij de vrije vraag — vaste, generieke set (P2 Deel A).
// ----------------------------------------------------------------------------
//  Bewust GEEN context-afgeleide vragen meer. Reden (opdrachtgever, 29-07): een
//  vraag die een specifiek stuk/agendapunt bij naam noemt zonder dat het gekoppeld
//  is, "slaat nergens op" — en wie een vraag over een document heeft, gebruikt de
//  taakkaart "Een document doorgronden" (die zet wél de scope). Onder "Een vrije
//  vraag stellen" horen daarom generieke starters die altijd zinnig zijn en geen
//  grounding op één specifiek stuk vereisen.
//
//  Neutraal-kritisch, nooit richting een uitkomst (mockup "blinde vlek"):
//  vraagvormen, geen oordeel of aanbeveling. Vast (geen modelaanroep, geen query,
//  geen latency) — een prefill die direct staat.
//
//  BRON-INTENTIE PER VRAAG (ingreep 1, 30-07-2026)
//  ----------------------------------------------------------------------------
//  Elke startvraag draagt een VASTE bron-intentie mee. Reden: de copy is van ons,
//  dus de heuristiek (lib/vraagtype.ts → bepaalBronIntent) hoeft er niet over te
//  gokken — en gokte er in de praktijk ook naast. Gemeten op de set zoals die
//  hiervoor bestond:
//    • "Welke stappen doorloopt een besluit …"  → fonds/ONZEKER → blokkerende
//      terugvraag op een vraag die het portaal zélf voorstelt.
//    • "Waar moet ik als bestuurder op letten …" → fonds/zeker via /\bmoet ik\b/,
//      terwijl het een generieke governance-vraag is.
//  Scherpere patronen lossen dit niet op (getest): een regex kan de bedoeling van
//  onze eigen copy niet raden, terwijl die bedoeling bij het schrijven al vaststaat.
//  De intentie reist als `bron_intent_override` mee (route.ts) en zet daarmee het
//  vertrouwen op "zeker" — géén wijziging in de geaccordeerde classificatie
//  (Increment I-2, FO §11a), dus geen her-accordering nodig. Herkomst blijft
//  herleidbaar via retrieval_meta.bron_intent_bron = "startvraag".
//
//  LET OP bij het toevoegen van een startvraag: de intentie is een BEWUSTE keuze,
//  geen formaliteit. "algemeen" = wet/kader/definitie, los van dit fonds.
//  "fonds" = de vraag gaat over de eigen stukken, besluiten of stand van zaken.
// ============================================================================

/** De bron-intentie die de startvraag bevestigt (subset van BronIntent die de
 *  route als override accepteert; "gecombineerd" is bewust geen optie — dat is
 *  een uitkomst van de heuristiek, geen prefill-keuze). */
export type StartvraagIntent = "fonds" | "algemeen";

export interface Startvraag {
  vraag: string;
  intent: StartvraagIntent;
}

/** De generieke voorbeeldvragen op de lege staat van /ai. Vast en neutraal. */
export const GENERIEKE_STARTVRAGEN: readonly Startvraag[] = [
  {
    vraag:
      "Wat betekent besluitrijpheid, en waaraan herken ik of een voorstel er klaar voor is?",
    intent: "algemeen",
  },
  {
    vraag:
      "Welke stappen doorloopt een besluit — van beeldvorming naar oordeels- en besluitvorming?",
    intent: "algemeen",
  },
  {
    vraag:
      "Waar moet ik als bestuurder op letten bij een voorstel dat om een besluit vraagt?",
    intent: "algemeen",
  },
  {
    vraag: "Wat houdt de Wet toekomst pensioenen (Wtp) op hoofdlijnen in?",
    intent: "algemeen",
  },
];
