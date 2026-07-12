// ============================================================================
//  lib/bronkeuze-meetset.ts — Increment I-2. Gelabelde meetset voor de
//  AUTOMATISCHE bronkeuze (FO v1.3 §11a).
// ----------------------------------------------------------------------------
//  40 bestuurlijke vragen met een door gebruiker/compliance GEACCORDEERD label
//  (sign-off 2026-06-22). Dit is de bron-van-waarheid waartegen de pure
//  classificatie (lib/vraagtype.ts → bepaalBronIntent) wordt geijkt en
//  bewaakt — zie de runner lib/bronkeuze-classificatie.sanity.ts met de
//  (eveneens geaccordeerde) drempels.
//
//  De set is bewust CONTRASTIEF: hetzelfde onderwerp keert terug met een ander
//  label, zodat de classificatie aantoonbaar op de INTENTIE (anker-/signaal-
//  woorden) let en niet op het onderwerp. De ondergrens (`gecombineerd` en
//  vooral `mag-terugvragen`) is waar de grens ligt; daar legt compliance het
//  beleid vast over "aannemen versus doorvragen".
//
//  `mag-terugvragen` is een MEETSET-label, geen classificatie-uitkomst: het
//  betekent "de assistent hoort hier te verduidelijken" → bron_intent met
//  vertrouwen "onzeker" (geen fonds-/generiek-anker).
// ============================================================================

/** Het verwachte gedrag per vraag. De eerste drie sturen een zekere auto-keuze;
 *  `mag-terugvragen` hoort een verduidelijkingsvraag uit te lokken. */
export type Bronlabel = "fonds" | "algemeen" | "gecombineerd" | "mag-terugvragen";

export interface MeetsetVraag {
  id: number;
  vraag: string;
  label: Bronlabel;
  /** Waarom dit label — het onderscheidende signaal. Documentatie, niet getest. */
  toelichting: string;
}

export const BRONKEUZE_MEETSET: MeetsetVraag[] = [
  // ── Label `fonds` (14) — fondsanker of expliciet eigen beleid/besluit ──
  { id: 1, label: "fonds", vraag: "Hoe is onze solidariteitsreserve ingericht?", toelichting: 'anker "onze"' },
  { id: 2, label: "fonds", vraag: "Welke besluiten heeft het bestuur genomen over het beleggingsbeleid?", toelichting: "het bestuur + besluit" },
  { id: 3, label: "fonds", vraag: "Wat is ons beleid bij een tegenstrijdig belang?", toelichting: '"ons beleid"' },
  { id: 4, label: "fonds", vraag: "Voldoet ons bestuur aan de geschiktheidseisen?", toelichting: '"ons bestuur"' },
  { id: 5, label: "fonds", vraag: "Wat staat er in onze abtn over de premiedekking?", toelichting: '"onze"' },
  { id: 6, label: "fonds", vraag: "Welke risicobereidheid heeft ons fonds vastgesteld?", toelichting: '"ons fonds"' },
  { id: 7, label: "fonds", vraag: "Hoe is de uitbesteding aan onze vermogensbeheerder geregeld?", toelichting: '"onze"' },
  { id: 8, label: "fonds", vraag: "Wat is de actuele dekkingsgraad van ons fonds?", toelichting: '"ons fonds"' },
  { id: 9, label: "fonds", vraag: "Welke afspraken gelden binnen ons fonds voor de klachtenregeling?", toelichting: '"binnen ons fonds"' },
  { id: 10, label: "fonds", vraag: "Wat heeft het bestuur besloten over het transitieplan?", toelichting: "het bestuur + besluit" },
  { id: 11, label: "fonds", vraag: "Hoe ziet onze governance rond het verantwoordingsorgaan eruit?", toelichting: '"onze"' },
  { id: 12, label: "fonds", vraag: "Welke uitgangspunten hanteren wij voor het invaren?", toelichting: '"wij"' },
  { id: 13, label: "fonds", vraag: "Wat is in onze gedragscode opgenomen over nevenfuncties?", toelichting: '"onze"' },
  { id: 14, label: "fonds", vraag: "Welke besluiten liggen vast in onze besluitenregistratie over de premie?", toelichting: '"onze" + besluit' },

  // ── Label `algemeen` (10) — definitie/wettelijk in algemene zin, geen anker ──
  { id: 15, label: "algemeen", vraag: "Wat is een dekkingsgraad?", toelichting: "definitie" },
  { id: 16, label: "algemeen", vraag: "Wat houdt de Wet toekomst pensioenen op hoofdlijnen in?", toelichting: "wet, generiek" },
  { id: 17, label: "algemeen", vraag: "Wat is het verschil tussen de SPR en de FPR onder de Wtp?", toelichting: "definitie/wet" },
  { id: 18, label: "algemeen", vraag: "Wat is een solidariteitsreserve?", toelichting: "definitie" },
  { id: 19, label: "algemeen", vraag: "Welke wettelijke deskundigheidseisen gelden voor pensioenfondsbestuurders?", toelichting: '"wettelijk"' },
  { id: 20, label: "algemeen", vraag: "Wat houdt de 'prudent person'-regel in?", toelichting: "definitie" },
  { id: 21, label: "algemeen", vraag: "Wat is de rol van DNB bij het toezicht op pensioenfondsen?", toelichting: "DNB/toezicht generiek" },
  { id: 22, label: "algemeen", vraag: "Wat betekent 'invaren' in de pensioentransitie?", toelichting: "definitie" },
  { id: 23, label: "algemeen", vraag: "Welke eisen stelt de wet aan een verantwoordingsorgaan?", toelichting: "wet, generiek" },
  { id: 24, label: "algemeen", vraag: "Wat is het verschil tussen een uitkerings- en een premieovereenkomst?", toelichting: "definitie" },

  // ── Label `gecombineerd` (8) — fondsanker én generiek/markt-signaal ──
  { id: 25, label: "gecombineerd", vraag: "Is de inrichting van onze solidariteitsreserve gebruikelijk in de markt?", toelichting: "onze + markt" },
  { id: 26, label: "gecombineerd", vraag: "Wat zegt de Wtp over de risicohouding, en hoe hebben wij die ingevuld?", toelichting: "wet + wij" },
  { id: 27, label: "gecombineerd", vraag: "Hoe verhoudt ons beleggingsbeleid zich tot de DNB-leidraad?", toelichting: "ons + DNB" },
  { id: 28, label: "gecombineerd", vraag: "Voldoet onze gedragscode aan de eisen van de Pensioenfederatie?", toelichting: "onze + Pensioenfederatie" },
  { id: 29, label: "gecombineerd", vraag: "Is ons transitieplan in lijn met wat sectorbreed gebruikelijk is?", toelichting: "ons + sectorbreed" },
  { id: 30, label: "gecombineerd", vraag: "Hoe scoort onze dekkingsgraad ten opzichte van vergelijkbare fondsen?", toelichting: "onze + vergelijking" },
  { id: 31, label: "gecombineerd", vraag: "Wat zegt de wet over uitbesteding, en hoe is dat bij ons geregeld?", toelichting: "wet + bij ons" },
  { id: 32, label: "gecombineerd", vraag: "Wijkt ons premiebeleid af van het wettelijk kader?", toelichting: "ons + wettelijk" },

  // ── Label `mag-terugvragen` (8) — geen anker, intentie kan beide kanten op ──
  { id: 33, label: "mag-terugvragen", vraag: "Hoe zit het met de solidariteitsreserve?", toelichting: "geen anker; ons vs. algemeen" },
  { id: 34, label: "mag-terugvragen", vraag: "Wat zijn de deskundigheidseisen voor bestuurders?", toelichting: "wet óf eigen geschiktheidsbeleid" },
  { id: 35, label: "mag-terugvragen", vraag: "Wat is het beleggingsbeleid?", toelichting: "ons beleid óf algemeen begrip" },
  { id: 36, label: "mag-terugvragen", vraag: "Hoe werkt de klachtenregeling?", toelichting: "onze regeling óf algemeen" },
  { id: 37, label: "mag-terugvragen", vraag: "Wat vind je van de dekkingsgraad?", toelichting: "ons cijfer óf het begrip" },
  { id: 38, label: "mag-terugvragen", vraag: "Hoe gaat het met het invaren?", toelichting: "onze voortgang óf het proces" },
  { id: 39, label: "mag-terugvragen", vraag: "Wat moet ik weten over tegenstrijdig belang?", toelichting: "onze gedragscode óf algemeen" },
  { id: 40, label: "mag-terugvragen", vraag: "Hoe staat het met het transitieplan?", toelichting: "ons plan óf algemeen" },
];
