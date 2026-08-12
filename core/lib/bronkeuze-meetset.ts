// ============================================================================
//  lib/bronkeuze-meetset.ts — Increment I-2. Gelabelde meetset voor de
//  AUTOMATISCHE bronkeuze (FO v1.3 §11a).
// ----------------------------------------------------------------------------
//  Bestuurlijke vragen met een door gebruiker/compliance GEACCORDEERD label
//  (basis: 40 vragen, sign-off 2026-06-22; uitbreidingen 41-46 wettelijke-plicht,
//  47-54 persoonlijk/status contextbesef (besluit 0090), en 55-72 portaalobjecten
//  (besluit 0137, M-B4 — HER-ACCORDERING VÓÓR PRODUCTIE OPENSTAAND)). Dit is de
//  bron-van-waarheid waartegen de pure
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

  // ── Uitbreiding 2026-07-15 (wettelijke-plicht/kadervragen zonder anker) ──
  // Reële misclassificaties: kadervragen naar een wettelijke verplichting die
  // vóór de patroon-uitbreiding onterecht in de twijfelbak (mag-terugvragen)
  // vielen. Met de plicht-signalen classificeren ze nu als 'algemeen'. Het
  // contrastieve mag-terugvragen-item (45) borgt dat écht ankerloze/plichtloze
  // varianten nog steeds terugvragen.
  { id: 41, label: "algemeen", vraag: "Wat zijn de communicatieverplichtingen naar deelnemers bij een verlaging van de uitkering?", toelichting: '"verplichting", geen anker' },
  { id: 42, label: "algemeen", vraag: "Welke informatieverplichtingen gelden richting deelnemers?", toelichting: '"verplichting", geen anker' },
  { id: 43, label: "algemeen", vraag: "Wat houdt de zorgplicht van een pensioenfonds in?", toelichting: '"zorgplicht" + "wat houdt"' },
  { id: 44, label: "gecombineerd", vraag: "Voldoen wij aan de wettelijke informatieverplichtingen richting deelnemers?", toelichting: '"wij" + "wettelijk"/"verplichting"' },
  { id: 45, label: "mag-terugvragen", vraag: "Hoe zit het met de communicatie naar deelnemers?", toelichting: "geen anker, geen plicht-woord" },
  { id: 46, label: "algemeen", vraag: "Welke informatieplicht heeft een pensioenfonds bij een wijziging van de regeling?", toelichting: '"informatieplicht", geen anker' },

  // ── Uitbreiding 2026-07-29 (contextbesef, besluit 0090) — PERSOONLIJKE vragen ──
  // Een persoonlijk signaal (mijn/voor mij/moet ik/…) telt als fonds-anker: de
  // eigen proces-/taakstand bestaat alleen binnen dit fonds. Contrastief met de
  // tegenvoorbeelden hieronder (48/52/53) die persoonlijk-LIJKEN maar algemeen of
  // terugvraag moeten blijven, zodat de classificatie aantoonbaar op het SOORT
  // signaal let en niet op oppervlakkige "ik"-woorden.
  { id: 47, label: "fonds", vraag: "Wat is mijn volgende actie om op te pakken?", toelichting: '"mijn" — persoonlijk anker' },
  { id: 48, label: "fonds", vraag: "Wat moet ik nog oppakken voor de komende vergadering?", toelichting: '"moet ik" (geen "weten") — persoonlijk anker' },
  { id: 49, label: "fonds", vraag: "Welke stappen staan voor mij nog open?", toelichting: '"voor mij" — persoonlijk anker' },
  { id: 50, label: "fonds", vraag: "Op welke agendapunten moet ik nog inbreng leveren?", toelichting: '"moet ik" — persoonlijk anker' },
  // Persoonlijk anker ÉN generiek → gecombineerd (criterium 3).
  { id: 51, label: "gecombineerd", vraag: "Wat betekent de Wtp voor mijn rol?", toelichting: '"mijn" + "Wtp" → gecombineerd' },
  { id: 52, label: "gecombineerd", vraag: "Wat vraagt de wet van mij als bestuurder?", toelichting: '"van mij" + "wet" → gecombineerd' },
  // Tegenvoorbeelden: persoonlijk-lijkend maar géén taak-/proceszaak.
  // "moet ik WETEN" = kennisvraag (lookahead sluit het uit) + "zorgplicht"/plicht.
  { id: 53, label: "algemeen", vraag: "Wat moet ik weten over de zorgplicht?", toelichting: '"moet ik weten" uitgesloten; "zorgplicht" → algemeen' },
  { id: 54, label: "algemeen", vraag: "Wat betekent invaren in de Wtp?", toelichting: '"wat betekent"/"Wtp", geen persoonlijk anker' },

  // ── Uitbreiding 2026-08-06 (besluit 0137, M-B4) — PORTAALOBJECT-vragen ──
  // De geaccordeerde set bevatte géén portaalobject-vragen (besluiten, agendapunten,
  // notulen, vergaderingen, voorstellen, risicomatrix, acties, jaarplan), terwijl in
  // echt gebruik 17 van 18 zulke vragen in de twijfelbak vielen (0091). Een
  // portaalobject verwijst per definitie naar de eigen inhoud van dít fonds; met de
  // FONDS_INTENT-uitbreiding classificeren die nu als 'fonds'/zeker. Contrastief
  // geborgd: (a) object-woord ÉN generiek → 'gecombineerd' (het object-woord forceert
  // dus niet blind 'fonds'); (b) een VERBVORM ("besloten") of een KAAL onderwerpwoord
  // ("risico's", zónder "matrix") blijft terugvragen — bewijs dat de patronen niet te
  // breed zijn. Onder de bronkeuze-modus 'antwoord_eerst' (0137) materialiseert een
  // 'mag-terugvragen'-uitkomst als de niet-blokkerende chip ónder het antwoord.
  // Vergt her-accordering door compliance vóór productie (0070/0091).
  { id: 55, label: "fonds", vraag: "Welke besluiten zijn er genomen over het beleggingsbeleid?", toelichting: 'object "besluit"' },
  { id: 56, label: "fonds", vraag: "Toon de laatste bestuursbesluiten.", toelichting: 'samenstelling "bestuursbesluit" (geen leidende \\b)' },
  { id: 57, label: "fonds", vraag: "Welke agendapunten staan er op de komende vergadering?", toelichting: 'object "agendapunt"/"vergadering"' },
  { id: 58, label: "fonds", vraag: "Wat zijn de openstaande agendapunten?", toelichting: 'object "agendapunt"' },
  { id: 59, label: "fonds", vraag: "Wat staat er in de notulen van de vorige vergadering?", toelichting: 'object "notulen"/"vergadering"' },
  { id: 60, label: "fonds", vraag: "Vat de notulen van de junivergadering samen.", toelichting: 'object "notulen"/"vergadering"' },
  { id: 61, label: "fonds", vraag: "Is er een bestuursvoorstel over het beleggingsbeleid?", toelichting: 'object "bestuursvoorstel"/"voorstel"' },
  { id: 62, label: "fonds", vraag: "Welke voorstellen liggen er ter besluitvorming?", toelichting: 'object "voorstel"/"besluit"' },
  { id: 63, label: "fonds", vraag: "Welke risico's staan er in de risicomatrix?", toelichting: 'object "risicomatrix"' },
  { id: 64, label: "fonds", vraag: "Welke acties staan er nog open?", toelichting: 'object "acties"' },
  { id: 65, label: "fonds", vraag: "Wat moet er nog gebeuren voor de bestuursvergadering?", toelichting: 'object "vergadering"' },
  { id: 66, label: "fonds", vraag: "Wat staat er in het jaarplan?", toelichting: 'object "jaarplan"' },
  { id: 67, label: "fonds", vraag: "Welk agendapunt gaat over de uitbesteding?", toelichting: 'object "agendapunt"' },
  { id: 68, label: "fonds", vraag: "Welke actiepunten heb ik nog?", toelichting: 'object "actiepunt"' },
  // Contrastief: object-woord ÉN generiek → gecombineerd (niet blind fonds).
  { id: 69, label: "gecombineerd", vraag: "Welke besluiten moet een pensioenfondsbestuur wettelijk registreren?", toelichting: '"besluit" + "wettelijk" → gecombineerd' },
  { id: 70, label: "gecombineerd", vraag: "Wat moet er volgens de wet in de notulen staan?", toelichting: '"notulen" + "de wet" → gecombineerd' },
  // Contrastief: verbvorm en kaal onderwerpwoord blijven terugvragen (patronen niet te breed).
  { id: 71, label: "mag-terugvragen", vraag: "Wat is er besloten over de premie?", toelichting: '"besloten" (verbvorm) ≠ "besluit"; geen anker' },
  { id: 72, label: "mag-terugvragen", vraag: "Hoe zit het met de risico's?", toelichting: 'kaal "risico\'s" (geen "matrix"); geen anker' },
];

// ── T1-NULMETING (2026-08-11, beslisnotitie v0.4 Deel A) — "begrip × wettelijke
//    toets" — HER-ACCORDERING VÓÓR PRODUCTIE OPENSTAAND ────────────────────────
//  BEWUST NIET opgenomen in BRONKEUZE_MEETSET en NIET door de classificatie-
//  runner (lib/bronkeuze-classificatie.sanity.ts) geëvalueerd: dit is een
//  NULMETING, geen geaccordeerd label. Deze vragen combineren een (impliciet
//  fondsspecifiek) begrip met een wettelijke toets — het gewenste label is
//  `gecombineerd`, maar de HUIDIGE classifier landt op `algemeen`/generiek
//  (partnerbegrip-casus: 7 generieke citaties, 0 fondsbronnen). T1 levert het
//  MECHANISME (representatie-constraints); T2 verfijnt de classifier (contrast-
//  patroon → `gecombineerd`) zodat de JUISTE constraints worden gekozen. Pas met
//  T1 + T2 samen is deze set end-to-end opgelost. Het `label`-veld = het GEWENSTE
//  eindlabel (nulmeting-doel), niet de huidige uitkomst.
//
//  Compliance: nog te her-accorderen (meetset-first, zie ticket-DoD). Zodra T2
//  landt en compliance tekent, verhuizen de geaccordeerde items naar
//  BRONKEUZE_MEETSET en gaan ze mee in de pass/fail-drempels.
//
//  ── STATUS NA T2 (2026-08-12) ────────────────────────────────────────────────
//  T2 GELAND. bepaalBronsoortprofiel (weeg-bronsoort.ts, stuurt de constraints) +
//  bepaalBronIntent (vraagtype.ts, stuurt de framing) classificeren nu ALLE
//  onderstaande items als `gecombineerd`/zeker — nagerekend in
//  weeg-bronsoort.sanity.ts (contrast + negatieve controls). De "nu → algemeen"-
//  toelichtingen beschrijven dus de NULMETING (vóór T2), niet meer de uitkomst.
//  Items 87-89 zijn de ankerloze contrastvarianten (zonder ons/onze) die de
//  robuustheidsgrens markeren. De set blijft NON-graded tot compliance tekent.
export const BRONKEUZE_NULMETING_T1: MeetsetVraag[] = [
  { id: 73, label: "gecombineerd", vraag: "Valt een samenwonende partner onder ons partnerbegrip volgens de Pensioenwet?", toelichting: "partnerbegrip (fondsspecifiek) × wettelijke toets; nu → algemeen" },
  { id: 74, label: "gecombineerd", vraag: "Is ons partnerbegrip in lijn met de wettelijke definitie van partner?", toelichting: "eigen begrip × wet; nu → algemeen" },
  { id: 75, label: "gecombineerd", vraag: "Voldoet onze definitie van arbeidsongeschiktheid aan de wettelijke eisen?", toelichting: "begrip × wettelijke eis; nu → algemeen" },
  { id: 76, label: "gecombineerd", vraag: "Sluit ons begrip van gemoedsbezwaarde aan bij de Pensioenwet?", toelichting: "begrip × wet; nu → algemeen" },
  { id: 77, label: "gecombineerd", vraag: "Hoe verhoudt onze uitleg van het begrip pensioengevend salaris zich tot de fiscale grenzen?", toelichting: "begrip × fiscaal kader; nu → algemeen" },
  { id: 78, label: "gecombineerd", vraag: "Is ons begrip van scheiding en verevening consistent met de Wet verevening pensioenrechten?", toelichting: "begrip × specifieke wet; nu → algemeen" },
  { id: 79, label: "gecombineerd", vraag: "Voldoet onze definitie van wezenpensioen aan de wettelijke leeftijdsgrenzen?", toelichting: "begrip × wettelijke grens; nu → algemeen" },
  { id: 80, label: "gecombineerd", vraag: "Past ons begrip van deeltijdpensioen binnen de fiscale spelregels?", toelichting: "begrip × fiscaal; nu → algemeen" },
  { id: 81, label: "gecombineerd", vraag: "Sluit ons hanteren van de AOW-franchise aan bij de wettelijke minimumfranchise?", toelichting: "begrip × wettelijk minimum; nu → algemeen" },
  { id: 82, label: "gecombineerd", vraag: "Is onze uitleg van het nabestaandenpensioen op risicobasis in lijn met de Wtp?", toelichting: "begrip × Wtp-toets; nu → algemeen" },
  { id: 83, label: "gecombineerd", vraag: "Voldoet ons begrip van de pensioenrichtleeftijd aan de wettelijke koppeling aan de AOW-leeftijd?", toelichting: "begrip × wettelijke koppeling; nu → algemeen" },
  { id: 84, label: "gecombineerd", vraag: "Hoe verhoudt onze definitie van waardeoverdracht zich tot het wettelijke recht op waardeoverdracht?", toelichting: "begrip × wettelijk recht; nu → algemeen" },
  { id: 85, label: "gecombineerd", vraag: "Is ons begrip van de afkoopgrens gelijk aan de wettelijke afkoopgrens voor kleine pensioenen?", toelichting: "begrip × wettelijke grens; nu → algemeen" },
  { id: 86, label: "gecombineerd", vraag: "Sluit onze hantering van het begrip gewezen deelnemer aan bij de definitie in de Pensioenwet?", toelichting: "begrip × wettelijke definitie; nu → algemeen" },
  // ── T2-uitbreiding (2026-08-12) — ANKERLOZE contrastvarianten (geen ons/onze) ──
  // Robuustheidsgrens: "het huidige [begrip]" telt als fonds-anker (weeg +
  // vraagtype), dus deze halen `gecombineerd` zónder bezittelijk voornaamwoord.
  { id: 87, label: "gecombineerd", vraag: "Hoe verhoudt het huidige partnerbegrip zich tot de Pensioenwet?", toelichting: "'het huidige [begrip]' (ankerloos) × Pensioenwet" },
  { id: 88, label: "gecombineerd", vraag: "Sluit de huidige definitie van arbeidsongeschiktheid aan bij de wettelijke eisen?", toelichting: "'de huidige [definitie]' (ankerloos) × wettelijke eis" },
  { id: 89, label: "gecombineerd", vraag: "Past het huidige begrip van deeltijdpensioen binnen de fiscale grenzen?", toelichting: "'het huidige [begrip]' (ankerloos) × fiscaal kader" },
];
