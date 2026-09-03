// ============================================================================
// Vraagtype-detectie en strategiekeuze — document-scope increment 2
// ----------------------------------------------------------------------------
// Pure, transparante heuristiek (geen modelaanroep) die bepaalt of een
// gescoopte vraag dekkingsbreed is (samenvatten, beoordelen, risico's/besluiten
// benoemen) of specifiek. Voorspelbaar en uitlegbaar — past bij de governance-
// lijn — en programmatisch na te rekenen (zie lib/vraagtype.sanity.ts). Het
// query-reformulatie-pad mag later als verfijning; bewust niet nu.
//
// Strategiekeuze (ontwerp §5):
//   specifiek                       → "targeted"       (increment 1, ongewijzigd)
//   breed & tekst ≤ drempel         → "full_document"  (hele tekst in de prompt)
//   breed & tekst >  drempel        → "map_reduce"     (in batches verwerken)
// ============================================================================

export type Vraagtype = "breed" | "specifiek";
export type Strategie = "targeted" | "full_document" | "map_reduce";

// Signaalwoorden voor een dekkingsbrede vraag. Bewust een gecureerde lijst:
// elke toevoeging is een expliciete, navolgbare keuze.
const BREED_PATRONEN: RegExp[] = [
  /\bvat\b[^.?!]*\bsamen/, // "vat (dit/het) samen"
  /samenvatt/, // samenvatting, samenvatten
  /\boverzicht\b/,
  /\bbeoordeel\b/,
  /\bbeoordeling\b/,
  /waar gaat (dit|het|deze|dat)[^.?!]*\bover\b/,
  /welke risico/,
  /welke besluit/,
  /welke aandachtspunt/,
  /welke (kritische )?vrag/,
  /kritische vrag/,
  /\bhoofdpunten\b/,
  /\brode draad\b/,
  /\bstrekking\b/,
  /\bkernpunten\b/,
  /analyse van (dit|het|deze)/,
  /\bevalueer\b/,
  /\bvat dit document\b/,
];

/** Verwijdert diacritics en maakt lowercase voor robuuste matching. */
function normaliseer(tekst: string): string {
  return tekst
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Bepaal of een vraag dekkingsbreed of specifiek is. Default: "specifiek"
 * (alleen bij een herkenbaar breed signaalwoord wordt het "breed").
 */
export function bepaalVraagtype(vraag: string): Vraagtype {
  const genormaliseerd = normaliseer(vraag);
  return BREED_PATRONEN.some((p) => p.test(genormaliseerd)) ? "breed" : "specifiek";
}

/**
 * Ruwe tokenschatting voor Nederlandse tekst (≈ 4 tekens per token). Bewust een
 * eenvoudige proxy: één plek, geen externe tokenizer-dependency.
 */
export function schatTokens(tekst: string): number {
  return Math.ceil(tekst.length / 4);
}

/**
 * Kies de retrievalstrategie op basis van vraagtype en (bij breed) de geschatte
 * documentgrootte t.o.v. de drempel.
 */
export function kiesStrategie(
  vraagtype: Vraagtype,
  geschatteTokens: number,
  drempel: number
): Strategie {
  if (vraagtype === "specifiek") return "targeted";
  return geschatteTokens <= drempel ? "full_document" : "map_reduce";
}

/**
 * Verdeel geordende items in batches op tokenbudget, met een harde bovengrens op
 * het aantal batches (kostenbewaking). Wordt de grens overschreden, dan worden
 * de resterende items NIET stil weggelaten: `afgekapt` wordt true zodat de
 * aanroeper de gebruiker kan melden dat de dekking gedeeltelijk is.
 */
export function maakBatches<T extends { tekst: string }>(
  items: T[],
  batchTokens: number,
  maxBatches: number
): { batches: T[][]; afgekapt: boolean } {
  const batches: T[][] = [];
  let huidige: T[] = [];
  let huidigeTokens = 0;

  for (const item of items) {
    const t = schatTokens(item.tekst);
    // Start een nieuwe batch als de huidige vol is (en niet leeg).
    if (huidige.length > 0 && huidigeTokens + t > batchTokens) {
      batches.push(huidige);
      if (batches.length >= maxBatches) {
        // Grens bereikt en er zijn nog items over → gedeeltelijke dekking.
        return { batches, afgekapt: true };
      }
      huidige = [];
      huidigeTokens = 0;
    }
    huidige.push(item);
    huidigeTokens += t;
  }

  if (huidige.length > 0) batches.push(huidige);
  return { batches, afgekapt: false };
}

// ============================================================================
// Antwoordmodusfamilie (Increment G, FO §12–§13 / besluit B8)
// ----------------------------------------------------------------------------
// De ANTWOORDMODUS bepaalt hóe de assistent antwoordt (feitelijk, duiding,
// sparring, …). Dit is een ORTHOGONALE as naast de bron-modi
// (documenten|combineren|algemeen, in app/api/chat/route.ts) en naast het
// vraagtype (breed|specifiek) hierboven. Pure, transparante NL-heuristiek —
// geen modelcall — zodat de keuze uitlegbaar en programmatisch toetsbaar is
// (lib/vraagtype.sanity.ts). De antwoordmodus stuurt óók de RETRIEVAL-modus
// (p_modus van de zoek-RPC's) via retrievalModusVoor().
// ============================================================================

export type Antwoordmodus =
  | "feitelijk"
  | "bronoverzicht"
  | "historisch"
  | "duiding"
  | "besluitrijpheid"
  | "sparring"
  | "persoonlijke_voorbereiding";

export const ANTWOORDMODI: Antwoordmodus[] = [
  "feitelijk",
  "bronoverzicht",
  "historisch",
  "duiding",
  "besluitrijpheid",
  "sparring",
  "persoonlijke_voorbereiding",
];

export const ANTWOORDMODUS_LABEL: Record<Antwoordmodus, string> = {
  feitelijk: "Feitelijk antwoord",
  bronoverzicht: "Bronoverzicht",
  historisch: "Historische context",
  duiding: "Bestuurlijke duiding",
  besluitrijpheid: "Besluitrijpheid",
  sparring: "Sparring",
  persoonlijke_voorbereiding: "Persoonlijke voorbereiding",
};

/** Retrieval-scope die de zoek-RPC's verstaan (p_modus). */
export type RetrievalModus = "actueel" | "historisch" | "besluitvorming" | "alles";

/**
 * Welke retrieval-scope hoort bij een antwoordmodus. Default is 'actueel':
 * duiding/sparring/feitelijk bouwen op de ACTUELE bron (concept/verlopen
 * tellen niet mee). Historisch verbreedt; besluitrijpheid activeert de
 * besluitvorming-scope (rang-boost + Decision Object-injectie, route-side).
 */
export function retrievalModusVoor(modus: Antwoordmodus): RetrievalModus {
  switch (modus) {
    case "historisch":
      return "historisch";
    case "besluitrijpheid":
      return "besluitvorming";
    default:
      return "actueel";
  }
}

// Geordende detectieregels: de EERSTE match wint. Volgorde = sterkte van het
// signaal. Reflectieve/afwegende intentie (sparring) en expliciete
// besluitrijpheid gaan vóór de zwakkere duidings-/overzichtssignalen.
const ANTWOORDMODUS_PATRONEN: { modus: Antwoordmodus; patronen: RegExp[] }[] = [
  {
    modus: "sparring",
    patronen: [
      /\bspar\b/,
      /\bspar(?:ren|partner)/,
      /speel (?:eens )?(?:de )?advocaat van de duivel/,
      /tegenargument/,
      /\btegenspraak\b/,
      /zwakke (?:plek|plekken|punten)/,
      /\bblinde vlek/,
      /wat (?:zie|mis) ik (?:over het hoofd|niet)/,
      /wat mis ik/,
      /\b(?:wees |wat )?kritisch\b/,
      /daag (?:me|mij|dit) uit/,
      /\buitdagen\b/,
      /overtuig me/,
      /help me (?:na)?denken/,
      /\breflecteer\b/,
      /wat vind (?:je|jij)/,
      /wat zou (?:je|jij) (?:hiervan |ervan )?(?:vinden|denken)/,
      /waar zou ik (?:me )?zorgen over (?:moeten )?maken/,
    ],
  },
  {
    modus: "besluitrijpheid",
    patronen: [
      /besluitrijp/,
      /besluitklaar/,
      /klaar (?:om|voor) (?:te )?beslui/,
      /rijp voor besluitvorming/,
      /kunnen we (?:hier(?:over)? )?(?:al )?beslui/,
      /voldoende onderbouwd om te beslui/,
      /is dit (?:al )?klaar voor (?:de )?bestuursvergadering/,
    ],
  },
  {
    modus: "historisch",
    patronen: [
      /\bhistor(?:ie|isch)/,
      /in het verleden/,
      /\bdestijds\b/,
      /\bvroeger\b/,
      /oude (?:versie|versies)/,
      /vorige (?:versie|versies)/,
      /eerder (?:vastgesteld|besloten)/,
      /\bgeschiedenis\b/,
      /wat was (?:de|het|er) (?:toen|destijds)/,
    ],
  },
  {
    modus: "besluitrijpheid",
    patronen: [/besluitvorming/, /\bbesluitregistratie\b/],
  },
  {
    modus: "duiding",
    patronen: [
      /\bduid\b/,
      /\bduiding\b/,
      /\bduiden\b/,
      /bestuurlijke (?:betekenis|relevantie)/,
      /wat betekent dit voor (?:ons|het) bestuur/,
      /hoe moet ik dit (?:lezen|interpreteren|begrijpen)/,
      /\bimplicaties?\b/,
      /wat zijn de gevolgen voor/,
      /waarom is dit (?:relevant|belangrijk) voor/,
    ],
  },
  {
    modus: "bronoverzicht",
    patronen: [
      // Verbreed 30-07-2026: "welke …" is niet de enige vorm waarin naar de
      // inventaris wordt gevraagd. Deze varianten kwamen in echt gebruik langs en
      // vielen op 'feitelijk' → retrievalmodus 'actueel' → concepten onzichtbaar.
      /\bzijn er (?:al )?(?:nog )?(?:documenten|stukken|bronnen|voorstellen)/,
      /\bhebben we (?:documenten|stukken|bronnen|iets)\b/,
      /\bwat hebben we\b[^.?!]*\b(?:over|rond|inzake)\b/,
      /\bwelke informatie (?:is er|hebben we)\b/,
      /welke (?:documenten|bronnen|stukken)/,
      /overzicht van (?:de )?(?:documenten|bronnen|stukken)/,
      /\bbronnenlijst\b/,
      /waar (?:staat|vind ik) dit/,
      /welke (?:beleids)?stukken (?:gaan|zijn er) over/,
    ],
  },
  {
    modus: "persoonlijke_voorbereiding",
    patronen: [
      /bereid me voor/,
      /mijn voorbereiding/,
      /help me (?:me )?voorbereiden/,
      /voorbereiden op (?:de|deze) (?:vergadering|bespreking)/,
    ],
  },
];

// ============================================================================
// Voorstel-/conceptvragen — retrievalmodus los van de antwoordmodus (30-07-2026)
// ----------------------------------------------------------------------------
// PROBLEEM (geverifieerd). De actualiteitsfilter in de zoek-RPC's laat onder
// p_modus='actueel' uitsluitend documentstatus 'vastgesteld'/'van_kracht' door —
// de harde conceptregel (FO §6 / TO §3.1, zie document-status-transities.ts).
// Een BESTUURSVOORSTEL is per definitie nog niet vastgesteld. Een vraag als
// "Welke bestuursvoorstellen liggen er voor wijziging van het beleggingsbeleid?"
// detecteert geen antwoordmodus → 'feitelijk' → retrievalmodus 'actueel' → het
// voorstel valt VÓÓR de ranking weg. De assistent meldt dan "geen relevante
// fondsdocumenten gevonden", terwijl het stuk er wél is. Dat is de omgekeerde
// conclusie van de werkelijkheid en daarmee schadelijker dan een terugvraag.
//
// KEUZE. We verschuiven bewust alléén de RETRIEVALMODUS, niet de antwoordmodus.
// Zou de vraag 'besluitrijpheid' worden, dan verandert ook de promptframing én
// wordt de Decision Object-besluitregistratie ingespoten (route.ts, gekoppeld aan
// antwoordmodus === "besluitrijpheid"). Dat is een veel grotere gedragswijziging
// dan nodig: we willen enkel dat niet-vastgestelde stukken zichtbaar worden. De
// bronkaarten dragen hun statuslabel (concept/ter bespreking), dus er ontstaat
// geen schijnzekerheid over de status van wat er ligt.
//
// 'besluitvorming' is de retrievalmodus die de actualiteitsfilter laat vallen
// (de RPC toetst enkel `p_modus is distinct from 'actueel'`) en die semantisch
// klopt in het auditspoor: de vraag gaat over stukken in besluitvorming.
// ============================================================================

// Gecureerd; elke toevoeging is een navolgbare keuze. Bewust GEEN kale
// onderwerpwoorden: het signaal moet over de STAAT van een stuk gaan (voorstel,
// concept, ter bespreking, "wat ligt er voor"), niet over het onderwerp.
const VOORSTELVRAAG_PATRONEN: RegExp[] = [
  // Bewust ZONDER leidende \b: in Nederlandse samenstellingen staat geen
  // woordgrens vóór het kernwoord (bestuursvoorstel, beleidsvoorstel,
  // wijzigingsvoorstel). Zelfde overweging als bij de plicht-patronen hieronder.
  /voorstel(?:len)?\b/,
  // CORRECTIE 12-08-2026. De sluitende \b stond direct achter een VASTE
  // suffixlijst, en in Nederlandse samenstellingen staat er geen woordgrens ná
  // het kernwoord. "conceptnotulen", "conceptbegroting", "conceptjaarverslag",
  // "conceptbeleidsplan" en "conceptrapportage" matchten dus NIET, terwijl
  // "concept", "concepten" en "conceptstuk" dat wél deden. Dat verklaart het
  // "soms wel, meestal niet"-gedrag bij expliciet vragen naar een conceptstuk:
  // dezelfde vraag viel wel of niet binnen de filter, puur op woordvorm.
  // Nu een open staart, met een negatieve lookahead voor conceptueel/
  // conceptualiseren — die gaan over een denkkader, niet over de staat van een
  // stuk (die grens wordt in vraagtype.sanity.ts vastgehouden).
  /\bconcept(?!ueel|uele|ualis)\w*/,
  /ter (?:bespreking|besluitvorming|vaststelling|advisering)/,
  /\bligt er\b/,
  /\bliggen er\b/,
  /\bwat ligt (?:er )?voor\b/,
  /nog niet vastgesteld/,
  /\bin voorbereiding\b/,
  /agendastuk(?:ken)?\b/,
  // TOEVOEGING 12-08-2026 — vergaderstuk-vocabulaire. Een vergaderstuk is geen
  // aparte entiteit maar een rij in `documenten` met agendapunt_id/vergadering_id,
  // en het vergaderstuk-uploadpad levert geen `status` mee → DB-default 'concept'
  // (zie app/api/documents/upload/route.ts). Vergaderstukken zijn daarmee PER
  // CONSTRUCTIE onvindbaar onder modus 'actueel', terwijl wie ernaar vraagt
  // vrijwel nooit het woord "concept" gebruikt. Deze woorden gaan alle over de
  // STAAT van een stuk (het ligt voor), niet over een onderwerp — de gecureerde
  // lijn hierboven blijft dus gelden.
  /vergaderstuk(?:ken)?\b/,
  /bestuursstuk(?:ken)?\b/,
  /\bopleg(?:ger|gers|notitie|notities|memo)\b/,
  /\bter agendering\b/,
  /\bgeagendeerd\b/,
  /\bop de agenda\b/,
  /\bstukken voor de (?:komende |volgende |aanstaande )?vergadering\b/,
];

/**
 * Vraagt deze vraag naar stukken die (nog) NIET zijn vastgesteld — voorstellen,
 * concepten, wat er ter besluitvorming voorligt? Pure heuristiek, programmatisch
 * toetsbaar (lib/vraagtype.sanity.ts).
 */
export function isVoorstelvraag(vraag: string): boolean {
  const g = normaliseer(vraag);
  return VOORSTELVRAAG_PATRONEN.some((p) => p.test(g));
}

// ============================================================================
// Opsteltaak-detectie (B1, 2026-08-10) — register-correctie bij opsteltaken.
// ----------------------------------------------------------------------------
// Vraagt de bestuurder om een STUK te PRODUCEREN (memo, notitie, oplegger, brief,
// nota, concept, voorstel), dan hoort het antwoord in het opsteller-register te
// staan — het document richt zich tot de lezer (het bestuur), niet tot de
// opdrachtgever ("uw signaal is terecht"/"goede vraag"). De route geeft dit als
// `opstelToon` door aan bouwSysteemBlokken; het ontsluit GEEN bevoegdheid (anders
// dan de bureau-stand) — het corrigeert alleen de toon.
//
// Bewust STRENG: een producerend werkwoord ÉN een documentsoort moeten beide
// aanwezig zijn. Zo blijft "wat staat er in de notitie?" (vraag ÓVER een stuk)
// buiten schot, terwijl "stel een memo op" / "schrijf een notitie" wél vuren.
// ============================================================================

// Producerende intentie: een werkwoord dat om het maken van een stuk vraagt.
const OPSTEL_INTENTIE_PATRONEN: RegExp[] = [
  /\bopstell?en\b/, // opstellen / opstelen (typo-tolerant)
  /\bopgesteld\b/,
  /\bschrijf\b/,
  /\bschrijven\b/,
  /\bformuleer\b/,
  /\bformuleren\b/,
  /\bstel\b[^.?!]{0,40}\bop\b/, // "stel ... op"
  /\bmaak\b[^.?!]{0,40}\b(memo|notitie|oplegger|brief|nota|concept|voorstel)\b/,
];

// Documentsoort. 'voorstel' bewust zonder leidende \b (samenstellingen als
// bestuursvoorstel/beleidsvoorstel), gelijk aan VOORSTELVRAAG_PATRONEN. Bewust
// GEEN kaal "stuk" — te generiek, zou met een producerend werkwoord vals vuren.
const OPSTEL_DOCUMENT_PATRONEN: RegExp[] = [
  /\b(memo|memorandum|notitie|oplegger|aanbiedingsbrief|brief|nota)\b/,
  /\bconcept(?:memo|notitie|versie)?\b/,
  /voorstel(?:len)?\b/,
  /\b(bestuursstuk|agendastuk)\b/,
];

/**
 * Vraagt deze vraag om het OPSTELLEN van een stuk (memo/notitie/oplegger/brief/
 * nota/concept/voorstel)? Vereist zowel een producerend werkwoord als een
 * documentsoort — "wat staat er in de notitie?" is dus géén opsteltaak. Pure
 * heuristiek, programmatisch toetsbaar (lib/vraagtype.sanity.ts).
 */
export function isOpsteltaak(vraag: string): boolean {
  const g = normaliseer(vraag);
  return (
    OPSTEL_INTENTIE_PATRONEN.some((p) => p.test(g)) &&
    OPSTEL_DOCUMENT_PATRONEN.some((p) => p.test(g))
  );
}

/**
 * De retrievalmodus voor DEZE vraag: als basis de modus van de antwoordmodus
 * (retrievalModusVoor), maar een voorstel-/conceptvraag die anders op 'actueel'
 * zou uitkomen krijgt 'besluitvorming' — anders is het gevraagde stuk per
 * definitie onvindbaar. Een expliciet historische of besluitvormingsgerichte
 * modus blijft ongemoeid (die filteren al niet op actualiteit).
 */
export function retrievalModusVoorVraag(
  modus: Antwoordmodus,
  vraag: string
): RetrievalModus {
  const basis = retrievalModusVoor(modus);
  if (basis !== "actueel") return basis;
  // CATALOGUSVRAAG (30-07-2026, tweede ronde). "Welke documenten/stukken/bronnen
  // zijn er over X?" vraagt naar wat er BESTAAT, niet naar wat geldend beleid is.
  // Onder 'actueel' verdwijnen concepten en vervallen stukken uit die inventaris en
  // meldt de assistent dat er niets is — de omgekeerde conclusie. Een inventaris
  // hoort volledig te zijn; de statuslabels op de bronkaarten dragen de nuance.
  if (modus === "bronoverzicht") return "alles";
  if (isVoorstelvraag(vraag)) return "besluitvorming";
  return basis;
}

/**
 * Detecteer de antwoordmodus uit de vraag. Default "feitelijk" (alleen bij een
 * herkenbaar signaal wijkt het af). Pure heuristiek; de gebruiker kan de modus
 * altijd vastzetten/overrulen (gesprekken.actieve_antwoordmodus).
 */
export function bepaalAntwoordmodus(vraag: string): Antwoordmodus {
  const g = normaliseer(vraag);
  for (const { modus, patronen } of ANTWOORDMODUS_PATRONEN) {
    if (patronen.some((p) => p.test(g))) return modus;
  }
  return "feitelijk";
}

/**
 * Moet er een zichtbare wissel-melding komen (FO §13)? Alleen bij AUTODETECTIE
 * (de gebruiker heeft niets vastgezet) én een afwijking van de neutrale default
 * "feitelijk". Een vastgezette modus is een bewuste keuze → geen verrassing,
 * geen melding.
 */
export function moetWisselMeldingTonen(
  gedetecteerd: Antwoordmodus,
  vastgezet: Antwoordmodus | null
): boolean {
  return vastgezet === null && gedetecteerd !== "feitelijk";
}

// ============================================================================
// Increment I-1 — presentatie-/sturingslaag (FO v1.3 §11c, §12, §13)
// ----------------------------------------------------------------------------
// Vereenvoudiging van de bestuurlijke UX: vier zichtbare antwoordmodi, rustige
// weergave met inline-meldingen alleen bij relevante uitzonderingen, en
// contextbewuste vervolgacties. Dit is bewust een PRESENTATIELAAG: niets
// hieronder wijzigt retrieval, filtering of weging (dat blijft Increment G).
// Alle functies zijn pure heuristiek, programmatisch toetsbaar
// (lib/vraagtype.sanity.ts). De interne Antwoordmodus-waarden (historisch,
// besluitrijpheid, …) blijven volledig bestaan; alleen de knoppen krimpen.
// ============================================================================

/**
 * De antwoordmodi die de bestuurder als KNOP ziet. Naast Auto (= autodetectie,
 * antwoordmodus === null) nog uitsluitend Sparren. Reden: Feiten en Duiding zijn
 * geen blijvende HOUDING maar een bewerking van één concreet antwoord — die horen
 * als vervolgactie ná het antwoord (bepaalVervolgacties: "Maak feitelijker" /
 * "Geef bestuurlijke duiding"), niet als voorafkeuze. Sparren is wél een houding
 * voor het hele gesprek en houdt daarom een knop. De overige interne modi
 * (feitelijk, duiding, historisch, besluitrijpheid, bronoverzicht,
 * persoonlijke_voorbereiding) blijven onder de motorkap bestaan via auto-detectie
 * en vervolgacties.
 */
export const ZICHTBARE_ANTWOORDMODI: Antwoordmodus[] = ["sparring"];

/** Bron-modus zoals de chat-route die kent (documenten|combineren|algemeen). */
export type BronModus = "documenten" | "combineren" | "algemeen";

// ── Inline-meldingen (FO §11c, zes uitzonderingen) ──────────────────────────
// In I-1 vallen #1 (geen fondstreffer) en #4 (algemene kennis bij fondsgebonden
// vraag) samen wanneer er geen treffers zijn: dat is exact dezelfde situatie
// (de route schakelt dan terug op algemene kennis). #4 verschijnt als aparte
// melding wanneer er WÉL treffers zijn maar het antwoord aanvult met algemene
// kennis (post-stream gedetecteerd via [Algemene kennis]-markeringen).

export type InlineMeldingType =
  | "geen_fondstreffer"
  | "alleen_fondsdocumenten"
  | "onvoldoende_basis"
  | "algemene_kennis_fonds"
  | "interpretatieve_duiding"
  | "onzekerheid_besluit"
  | "afgekapt"
  // 30-07-2026 — de actualiteitsfilter nam ALLE treffers weg: er zijn wél
  // fondsstukken over dit onderwerp, maar ze zijn niet vastgesteld. Vervangt
  // 'geen_fondstreffer', want die melding leidt hier tot de omgekeerde conclusie.
  | "niet_vastgestelde_stukken";

export interface InlineMelding {
  type: InlineMeldingType;
  tekst: string;
}

// FO-formuleringen. Bewust géén schijnzekerheid: nooit een "actuele fondsbron"
// suggereren die er niet is (CLAUDE.md-guardrail).
const INLINE_MELDING_TEKST: Record<InlineMeldingType, string> = {
  geen_fondstreffer:
    "Geen relevante fondsdocumenten gevonden. Dit antwoord is gebaseerd op algemene kennis.",
  alleen_fondsdocumenten:
    "Antwoord uitsluitend gebaseerd op de geraadpleegde fondsdocumenten.",
  onvoldoende_basis:
    "De geraadpleegde fondsdocumenten bieden onvoldoende basis; dit kan ik hieruit niet vaststellen.",
  algemene_kennis_fonds:
    "Naast fondsdocumenten is ook algemene kennis gebruikt; zie 'Onderbouwing en bronnen'.",
  interpretatieve_duiding:
    "De duiding is interpretatief; zie 'Onderbouwing en bronnen' voor de bronnen en aannames.",
  onzekerheid_besluit:
    "Dit antwoord weegt besluitvorming en kan aannames en openstaande punten bevatten; zie de onderbouwing.",
  afgekapt:
    "Dit antwoord is afgekapt op de lengtelimiet. Vraag om een vervolg of om het resterende deel.",
  // Placeholder: de zichtbare tekst is afhankelijk van het AANTAL en wordt
  // opgebouwd door meldingNietVastgesteldeStukken(). Deze vaste variant wordt
  // alleen gebruikt als er (onverwacht) geen aantal bekend is.
  niet_vastgestelde_stukken:
    "Er zijn wel fondsstukken over dit onderwerp, maar die zijn nog niet vastgesteld en gelden daarom niet als actuele bron.",
};

/**
 * Melding bij nul actuele treffers TERWIJL er niet-vastgestelde fondsstukken over
 * het onderwerp bestaan (30-07-2026). Maakt de blokker expliciet i.p.v. een
 * misleidende "niets gevonden" (CLAUDE.md: toon vóór een actie wat ontbreekt).
 * `aantalDocumenten` is het aantal ONDERSCHEIDEN documenten uit de schaduwtelling.
 */
export function meldingNietVastgesteldeStukken(
  aantalDocumenten: number
): InlineMelding {
  const stuk = aantalDocumenten === 1 ? "stuk" : "stukken";
  return {
    type: "niet_vastgestelde_stukken",
    tekst:
      `Geen ACTUELE fondsbron gevonden, maar er ${aantalDocumenten === 1 ? "is" : "zijn"} wel ` +
      `${aantalDocumenten} ${stuk} over dit onderwerp met de status concept of ter bespreking. ` +
      "Die gelden niet als actuele bron en zijn daarom buiten dit antwoord gelaten.",
  };
}

// Post-stream-melding: wordt door de routes toegevoegd wanneer het antwoord het
// max_tokens-plafond raakt (stop_reason === "max_tokens"), zodat een afkap nooit
// stil gebeurt. Los van bepaalInlineMeldingen (dat kent de stop_reason niet).
export const AFGEKAPT_MELDING: InlineMelding = {
  type: "afgekapt",
  tekst: INLINE_MELDING_TEKST.afgekapt,
};

export interface InlineMeldingInput {
  bronModus: BronModus;
  antwoordmodus: Antwoordmodus;
  aantalBronnen: number;
  /** Strikt-document-scope actief (één/enkele gekozen stukken). */
  scopeActief: boolean;
  /**
   * Aantal [Algemene kennis]/[Volgens wetgeving]-markeringen in het antwoord.
   * Alleen bekend ná het streamen; pre-stream is dit 0 (geen #4-melding dan).
   */
  algemeneKennisMarkers?: number;
}

/**
 * Bepaal welke inline-meldingen direct in het antwoord horen (FO §11c). Rustige
 * weergave: in het goed-onderbouwde standaardgeval (combineren mét treffers,
 * feitelijk) komt er géén melding. De bron-meldingen sluiten elkaar uit; de
 * antwoordmodus-meldingen staan daar los van.
 */
export function bepaalInlineMeldingen(input: InlineMeldingInput): InlineMelding[] {
  const { bronModus, antwoordmodus, aantalBronnen, scopeActief } = input;
  const markers = input.algemeneKennisMarkers ?? 0;
  const types: InlineMeldingType[] = [];
  const strict = scopeActief || bronModus === "documenten";

  // ── Bronbasis (onderling uitsluitend) ──
  if (strict) {
    types.push(aantalBronnen > 0 ? "alleen_fondsdocumenten" : "onvoldoende_basis");
  } else if (bronModus === "combineren") {
    if (aantalBronnen === 0) {
      // Schijnzekerheid-guardrail (I-2): 0 fondstreffers krijgt ALTIJD deze melding,
      // óók bij een auto 'algemeen'-intentie. De heuristiek kan een fondsvraag
      // (zonder anker, mét generiek patroon) fout als 'algemeen' classificeren; de
      // melding ("gebaseerd op algemene kennis") voorkomt dat zo'n antwoord stil
      // als fondsspecifiek overkomt. Voor een echt-algemene vraag is de melding
      // gewoon correct en transparant.
      types.push("geen_fondstreffer"); // #1 + #4: geen treffers → algemene kennis
    } else if (markers > 0) {
      types.push("algemene_kennis_fonds"); // #4: treffers + aanvullende algemene kennis
    }
  }
  // bronModus 'algemeen' → bewuste algemene vraag; geen bron-melding.

  // ── Antwoordmodus (los van de bronbasis) ──
  if (antwoordmodus === "duiding") types.push("interpretatieve_duiding"); // #5
  if (antwoordmodus === "besluitrijpheid") types.push("onzekerheid_besluit"); // #6

  return types.map((type) => ({ type, tekst: INLINE_MELDING_TEKST[type] }));
}

/**
 * Korte, leesbare samenvatting van de bronbasis voor het paneel "Onderbouwing
 * en bronnen" (FO §11c) en voor het auditspoor (retrieval_meta.bronbasis, §11d).
 */
export function bronbasisLabel(
  bronModus: BronModus,
  aantalBronnen: number,
  scopeActief: boolean
): string {
  if (scopeActief) return "Geselecteerde documenten";
  switch (bronModus) {
    case "documenten":
      return aantalBronnen > 0
        ? "Uitsluitend fondsdocumenten"
        : "Geen fondsdocumenten gevonden";
    case "combineren":
      return aantalBronnen > 0
        ? "Fondsdocumenten, aangevuld met algemene kennis"
        : "Algemene kennis (geen fondsdocumenten gevonden)";
    case "algemeen":
      return "Algemene kennis (geen interne bronnen)";
  }
}

// ── Contextbewuste vervolgacties (FO §13) ───────────────────────────────────

export type VervolgactieType =
  | "toon_bronnen"
  | "werk_uit_besluitvorming"
  | "maak_feitelijker"
  | "geef_duiding"
  | "stel_kritische_vragen"
  | "maak_tijdlijn"
  | "toon_eerdere_besluiten"
  | "maak_korter"
  | "maak_concreter";

export interface Vervolgactie {
  type: VervolgactieType;
  label: string;
  /** Antwoordmodus die de follow-up vastzet (null = ongewijzigd/Auto). */
  modus: Antwoordmodus | null;
  /** Follow-up gebruikersprompt; leeg voor pure UI-acties (toon_bronnen). */
  prompt: string;
  /**
   * True = de follow-up hergebruikt strikt dezelfde bronselectie (de
   * document_ids van het oorspronkelijke antwoord). False = de actie verbreedt
   * de scope bewust (besluitvorming → Decision Object-injectie; tijdlijn/eerdere
   * besluiten → historische laag), dus geen strikte scope.
   */
  hergebruikScope: boolean;
}

const HISTORISCH_SIGNAAL: RegExp[] = [
  /\beerder/,
  /\bvorige\b/,
  /\bsinds\b/,
  /ontwikkeling/,
  /\bhistor/,
  /tijdlijn/,
  /verleden/,
  /voorgeschiedenis/,
];

const BESLUIT_SIGNAAL: RegExp[] = [
  /beslui/,
  /\bvoorstel\b/,
  /\bmandaat\b/,
  /goedkeur/,
  /vaststell/,
  /\bakkoord\b/,
  /aandachtspunt/,
  /\brisico/,
];

/**
 * Is de vraag besluitvormingsgericht? Bepaalt of "Werk uit richting
 * besluitvorming" als vervolgactie verschijnt (FO §13). Duiding/besluitrijpheid
 * tellen altijd; daarnaast expliciete besluitsignalen in de vraag.
 */
export function isBesluitvormingsgericht(
  vraag: string,
  antwoordmodus: Antwoordmodus
): boolean {
  if (antwoordmodus === "besluitrijpheid" || antwoordmodus === "duiding") return true;
  const g = normaliseer(vraag);
  return BESLUIT_SIGNAAL.some((p) => p.test(g));
}

const VERVOLGACTIE_PROMPT: Record<
  Exclude<VervolgactieType, "toon_bronnen">,
  string
> = {
  werk_uit_besluitvorming:
    "Werk je vorige antwoord uit richting besluitvorming. Gebruik deze structuur: kernvraag · voorgesteld besluit · overwegingen · risico's · randvoorwaarden · openstaande vragen · benodigde aanvullende informatie · mogelijke besluittekst. Neem de besluitrijpheidscheck mee en formuleer zelf geen besluit of voorkeursadvies.",
  maak_feitelijker:
    "Geef hetzelfde antwoord strikt feitelijk: alleen wat aantoonbaar uit de bronnen blijkt, zonder interpretatie.",
  geef_duiding:
    "Geef bestuurlijke duiding bij je vorige antwoord: betekenis, governance, risico's en aandachtspunten, met onderscheid tussen feit en interpretatie.",
  stel_kritische_vragen:
    "Stel de kritische tegenvragen bij dit onderwerp en benoem zwakke plekken, aannames en alternatieven. Formuleer geen besluit.",
  maak_tijdlijn:
    "Maak een chronologische tijdlijn van dit onderwerp op basis van de stukken, met data en eerdere besluiten waar die uit de bronnen blijken.",
  toon_eerdere_besluiten:
    "Welke eerdere bestuursbesluiten zijn hierover genomen? Baseer je op de besluitregistratie, notulen en besluitdocumenten.",
  maak_korter: "Vat je vorige antwoord beknopter samen, met behoud van de kern.",
  maak_concreter:
    "Maak je vorige antwoord concreter en handelingsgericht, met expliciete vervolgstappen.",
};

/**
 * Contextbewuste vervolgacties onder een antwoord (FO §13). Niet alle knoppen
 * altijd: de set hangt af van de gebruikte antwoordmodus en de vraag. Bevat
 * minimaal "Toon gebruikte bronnen" (bij aanwezige bronnen) en — bij
 * besluitvormingsvragen — "Werk uit richting besluitvorming".
 */
export function bepaalVervolgacties(
  vraag: string,
  antwoordmodus: Antwoordmodus,
  heeftBronnen: boolean,
  // True = de vraag ging over een specifiek stuk of agendapunt. Dan behouden we de
  // perspectief-lenzen (duiding/kritische vragen) en de lengte-acties. Bij een
  // ALGEMENE vraag dragen de inhoudelijke B1-vervolgvragen (los, in de UI) de
  // "wat nu"-suggesties; de generieke transformatieknoppen voelden daar aangeplakt.
  documentGericht = false,
  // Plateau B / G1 — tijdens een actieve reflectieflow verdwijnen ALLE
  // vervolgacties. "Stel kritische vragen" duwt de bestuurder een richting in
  // die hij juist zelf aan het bepalen is; "maak korter" en "maak concreter"
  // slaan nergens op bij een verdiepingsvraag over zijn eigen twijfel. De
  // reflectie heeft haar eigen, gelabelde vervolgstap.
  //
  // De waarde komt van de SERVER (gesprek_reflectie_state via
  // /api/reflectie/transitie), niet uit clientstate: de flowstatus is
  // server-controlled (besluit 0110).
  reflectieActief = false
): Vervolgactie[] {
  if (reflectieActief) return [];

  const acties: Vervolgactie[] = [];
  const g = normaliseer(vraag);
  const besluit = isBesluitvormingsgericht(vraag, antwoordmodus);
  const historisch =
    antwoordmodus === "historisch" || HISTORISCH_SIGNAAL.some((p) => p.test(g));

  const voegToe = (
    type: VervolgactieType,
    label: string,
    modus: Antwoordmodus | null,
    hergebruikScope: boolean
  ) =>
    acties.push({
      type,
      label,
      modus,
      prompt: type === "toon_bronnen" ? "" : VERVOLGACTIE_PROMPT[type],
      hergebruikScope,
    });

  // "Toon gebruikte bronnen" is bewust GEEN vervolgactie meer: het onderbouwings-
  // paneel staat direct onder het antwoord (page.tsx), dus een aparte knop was
  // dubbelop. Het type + de UI-afhandeling blijven bestaan voor de deeplink die
  // het paneel opent, maar de knop wordt niet meer aangeboden.
  // heeftBronnen blijft in de signatuur voor API-stabiliteit (callers geven het mee).
  void heeftBronnen;

  // Signaalgedreven acties gelden in BEIDE gevallen (algemeen én documentgericht):
  // ze komen alleen op als de vraag er expliciet om vraagt.
  if (besluit)
    voegToe("werk_uit_besluitvorming", "Werk uit richting besluitvorming", "besluitrijpheid", false);

  // Feiten en Duiding zijn geen voorafmodus meer (alleen Auto + Sparren als knop).
  // Ze blijven beschikbaar als vervolgactie op ELK antwoord — het zijn
  // transformatie-acties (ze bewerken het vorige antwoord, zie TRANSFORMATIE_ACTIES),
  // dus ze werken ook zonder documentscope. Zo verliest de gebruiker geen
  // functionaliteit door het schrappen van de knoppen.
  if (antwoordmodus !== "feitelijk")
    voegToe("maak_feitelijker", "Maak feitelijker", "feitelijk", true);
  if (antwoordmodus !== "duiding")
    voegToe("geef_duiding", "Geef bestuurlijke duiding", "duiding", true);

  // "Stel kritische vragen" (sparring-lens) blijft aan een documentgerichte vraag
  // gekoppeld; voor een houding-voor-het-hele-gesprek is er de Sparren-knop.
  if (documentGericht && antwoordmodus !== "sparring")
    voegToe("stel_kritische_vragen", "Stel kritische vragen", "sparring", true);

  if (historisch) {
    voegToe("maak_tijdlijn", "Maak een tijdlijn", "historisch", false);
    voegToe("toon_eerdere_besluiten", "Toon eerdere besluiten", "historisch", false);
  }

  // Lengte-transformaties: eveneens alleen documentgericht — bij een algemene vraag
  // waren "korter/concreter" juist de knoppen die aangeplakt aanvoelden.
  if (documentGericht) {
    voegToe("maak_korter", "Maak korter", null, true);
    voegToe("maak_concreter", "Maak concreter", null, true);
  }

  return acties;
}

// ── Transformatie- vs. retrieval-vervolgacties (FO §13) ─────────────────────
// Een TRANSFORMATIE-actie bewerkt het VORIGE antwoord (herstructureren, duiden,
// feitelijker maken, inkorten, concretiseren). Die hoort NIET als nieuwe
// documentvraag door retrieval te lopen: de instructie ("werk je vorige antwoord
// uit…") heeft geen semantische overlap met de stukken, dus strict-document zou
// onterecht "Dit is niet in dit document aangetroffen" teruggeven. De route
// behandelt deze acties daarom als herschrijf-intent op het vorige antwoord.
// De RETRIEVAL-acties (tijdlijn, eerdere besluiten, kritische vragen) hebben
// juist wél nieuwe/bredere ophaling nodig en blijven ongewijzigd.
const TRANSFORMATIE_ACTIES: ReadonlySet<VervolgactieType> = new Set([
  "werk_uit_besluitvorming",
  "maak_feitelijker",
  "geef_duiding",
  "maak_korter",
  "maak_concreter",
]);

/** True = de vervolgactie bewerkt het vorige antwoord (geen nieuwe documentvraag). */
export function isTransformatieActie(type: VervolgactieType): boolean {
  return TRANSFORMATIE_ACTIES.has(type);
}

// ============================================================================
// Increment I-2 — AUTOMATISCHE bronkeuze (FO v1.3 §11a/§11c/§11d)
// ----------------------------------------------------------------------------
// De zichtbare bron-as ("Onze documenten / Slim combineren / Algemene vraag")
// verdwijnt; het systeem bepaalt zelf of een vraag fonds-, algemeen- of
// gecombineerd-gericht is. Pure, uitlegbare NL-heuristiek (géén modelcall),
// geijkt tegen de geaccordeerde meetset (lib/bronkeuze-meetset.ts) met
// bewaakte drempels (lib/bronkeuze-classificatie.sanity.ts).
//
// BEWUST GESCHEIDEN van lib/weeg-bronsoort.ts (Increment G): de retrieval-weging
// daar blijft ONGEWIJZIGD. Deze laag stuurt alleen de DEFAULT bron-modus,
// de promptframing, de melding-onderdrukking en de verduidelijkingsvraag.
//
// Kernrisico = een fondsvraag stil als 'algemeen' afdoen (schijnzekerheid).
// Twee waarborgen: (1) een fonds-anker sluit 'algemeen' uit, en de onzekere
// fallback-intent is 'fonds' (nooit stil 'algemeen'); (2) Design A
// "combineren-vloer": onder auto wordt retrieval nooit volledig overgeslagen.
// ============================================================================

/** De automatisch bepaalde intentie van een vraag. Stuurt promptframing en
 *  meldingen — NIET de retrieval-weging (dat blijft Increment G). */
export type BronIntent = "fonds" | "algemeen" | "gecombineerd";

/** Hoe zeker is de intentie? "onzeker" = geen anker/signaal → doorvragen i.p.v.
 *  aannemen (FO §11a endorseert de verduidelijkingsvraag bij twijfel). */
export type Vertrouwen = "zeker" | "onzeker";

export interface BronIntentResultaat {
  intent: BronIntent;
  vertrouwen: Vertrouwen;
}

// Generiek/wettelijk/markt- en DEFINITIE-signalen → de vraag staat (ook) los van
// het eigen fonds. Gecureerd; elke toevoeging is een navolgbare keuze.
const GENERIEK_INTENT_PATRONEN: RegExp[] = [
  /\bdnb\b/,
  /\bafm\b/,
  /pensioenfederatie/,
  /\bszw\b/,
  /\btoezicht/,
  /toezichthouder/,
  /\bwetgeving\b/,
  /\bwettelijk/,
  /\bregelgeving\b/,
  /\bpensioenwet\b/,
  /\bde wet\b/,
  /\bwet\b/,
  // T2 (beslisnotitie v0.4 Deel A) — fiscaal kader is óók een generiek/extern
  // signaal: de begrip×toets-casus toetst een reglementair begrip soms aan de
  // FISCALE grenzen ("… binnen de fiscale spelregels", "… tot de fiscale
  // grenzen"), niet aan een 'wet'-woord. Zonder dit landde de intent op "fonds"
  // i.p.v. "gecombineerd"; nu blijft de promptframing (Wvb/fiscaal kader ÉN
  // reglement) consistent met de weeg-constraints (weeg-bronsoort.ts).
  /fiscaal|fiscale/,
  /\bwtp\b/,
  /wet toekomst pensioenen/,
  /\bsector(?:breed|norm|guidance)?\b/,
  /sectorbreed/,
  /\brichtlijn(?:en)?\b/,
  /\bleidraad\b/,
  /\bguidance\b/,
  /extern(?:e)? kader/,
  /\bnorm(?:en|kader)?\b/,
  /\bmarkt\b/,
  /gebruikelijk in de markt/,
  /vergelijkbare fondsen/,
  /\bvergelijk/,
  /prudent person/,
  // Wettelijke-plicht/kadersignalen: een vraag naar een wettelijke verplichting of
  // plicht staat (ook zonder fondsanker) in algemene zin. Voorkomt dat zuiver
  // kadermatige vragen ("wat zijn de communicatieverplichtingen richting
  // deelnemers…") ten onrechte in de twijfelbak → terugvraag belanden. LET OP:
  // géén leidende \b, want in Nederlandse samenstellingen (communicatie­verplichting,
  // informatie­plicht) staat geen woordgrens vóór het kernwoord. Bewust specifieke
  // plicht-woorden, geen bare "deelnemers"/"pensioenfonds" (te breed).
  /verplichting/,
  /plicht(?:en)?\b/,
  // Definitievraag-triggers: een definitie/"wat is een X" staat los van het
  // eigen fonds. Bewust "wat is EEN" (onbepaald) — "wat is HET …" kan juist op
  // de eigen inrichting slaan en blijft daarom buiten deze lijst.
  /\bwat is een\b/,
  /\bwat houdt\b/,
  /\bwat betekent\b/,
  /verschil tussen/,
];

// Fonds-ANKERS → de vraag gaat expliciet over het eigen fonds. De bezittelijke
// voornaamwoorden ons/onze/wij zijn het sterkste, robuuste signaal; "het bestuur"
// (het orgaan van dit fonds) telt eveneens.
const FONDS_INTENT_PATRONEN: RegExp[] = [
  /\bonze\b/,
  /\bons\b/,
  /\bwij\b/,
  /\bhet bestuur\b/,
  /\bdit fonds\b/,
  /\beigen (?:beleid|fonds|stukken|regeling)/,
  // T2 (beslisnotitie v0.4 Deel A) — ankerloze contrastvariant "het/de huidige
  // [begrip]" ("hoe verhoudt het huidige partnerbegrip zich tot de Pensioenwet?").
  // Telt als fonds-anker zodat de intent (framing) GELIJK loopt met het
  // bronsoortprofiel (weeg-bronsoort.ts): daar is "het/de huidige" óók een
  // fonds-signaal, dus zonder deze regel zouden constraints (gecombineerd) en
  // framing (algemeen) uiteenlopen op precies deze vragen. Geen leidende bare
  // "huidige": vereist "het"/"de" ervoor, zodat "huidige rente" e.d. niet vuurt.
  /\b(?:het|de) huidige\b/,
  // ── Portaalobjecten (besluit 0137, M-B4) → per definitie fondsspecifiek ──
  // Een besluit, agendapunt, notulen, vergadering, actiepunt/actie, (bestuurs)-
  // voorstel, risicomatrix of jaarplan verwijst naar de eigen inhoud van dít fonds;
  // zulke portaalvragen horen niet in de twijfelbak (0091: 17 van 18 vielen er wél
  // in). Bewust ZONDER leidende \b — in Nederlandse samenstellingen staat geen
  // woordgrens vóór het kernwoord (bestuursbesluit, bestuursvergadering,
  // bestuursvoorstel). Bewust de OBJECT-woorden, GÉÉN kale onderwerpwoorden (risico,
  // stuk, premie): die zijn te breed en zouden algemene begripsvragen ten onrechte
  // fondsgericht kaderen. Geverifieerd: verandert geen enkele van de bestaande 54
  // meetsetuitkomsten (bronkeuze-classificatie.sanity). Vergt her-accordering.
  /besluit/,
  /agendapunt/,
  /notulen/,
  /vergadering/,
  /actiepunt/,
  /\bacties?\b/,
  // /voorstel(?:len)?\b/ zonder leidende \b dekt óók "bestuursvoorstel",
  // "beleidsvoorstel", "wijzigingsvoorstel" — geen aparte samenstelling nodig.
  /voorstel(?:len)?\b/,
  /risicomatrix/,
  /jaarplan/,
];

// PERSOONLIJKE ANKERS (contextbesef, besluit 0090) → de vraag gaat over de EIGEN
// staat van deze bestuurder binnen dit fonds ("mijn volgende actie", "wat moet ik
// nog oppakken"). Persoonlijke staat bestaat uitsluitend BINNEN dit fonds, dus een
// treffer telt als fonds-anker (net als ons/onze/wij) — zie bepaalBronIntent.
// Bewust een APARTE lijst, niet de fondslijst opgerekt: in de code blijft afleesbaar
// dat dit een andere soort signaal is (persoonlijk i.p.v. collectief).
//
// Bewust NIET kaal /\bik\b/: "Ik wil begrijpen wat een dekkingsgraad is" is een
// algemene vraag. Alleen `ik` in combinatie met een verplichtingswerkwoord.
// Bij `moet ik` sluit de lookahead "moet ik weten" uit: dat is een KENNISvraag
// ("wat moet ik weten over tegenstrijdig belang", meetset-item 39), geen taakvraag,
// en moet in de twijfelbak (mag-terugvragen) blijven vallen.
const PERSOONLIJK_INTENT_PATRONEN: RegExp[] = [
  /\bmijn\b/,
  /\bvoor mij\b/,
  /\bvan mij\b/,
  /\bmoet ik\b(?!\s+weten\b)/,
  /\bik moet\b/,
];

// STATUSGERICHTE SIGNALEN (contextbesef, besluit 0090) → de vraag vraagt naar de
// VOORTGANG/OPENSTAANDE stand ("wat staat er open", "hoe ver zijn we"). Deze lijst
// stuurt NIET de intent-classificatie (bepaalBronIntent blijft ongewijzigd), maar
// alléén of de portaalstand als context wordt meegestuurd (route.ts). Bewust
// verankerd op proces-/voortgangsformuleringen ("…zijn we", "…staat open", "de
// status"), niet op kale onderwerpwoorden: "hoe ver mag de dekkingsgraad dalen"
// mag géén status-treffer zijn.
const STATUS_INTENT_PATRONEN: RegExp[] = [
  /\bwat staat er (?:nog )?open\b/,
  /\bwat staat (?:er )?open\b/,
  /\bhoe ver zijn we\b/,
  /\bhoe ver staan we\b/,
  /\bwaar staan we\b/,
  /\bwat is de status\b/,
  /\bwat loopt er nog\b/,
  /\bwat moet er nog gebeuren\b/,
];

/**
 * Bepaal de bron-intentie + het vertrouwen, puur uit de vraag (FO §11a).
 *
 *   anker + generiek  → "gecombineerd" (zeker)   — gescheiden antwoord
 *   anker             → "fonds"        (zeker)    — fondsdocumenten leidend
 *   generiek          → "algemeen"     (zeker)    — algemene kennis leidend
 *   geen van beide    → "fonds"        (ONZEKER)  — twijfel → verduidelijken
 *
 * Een fonds-anker is een collectief signaal (ons/onze/wij/…) OF een persoonlijk
 * signaal (mijn/moet ik/…, besluit 0090): de persoonlijke staat van een bestuurder
 * bestaat uitsluitend binnen dít fonds, dus telt eveneens als "zeker fonds". Een
 * persoonlijke vraag mét generiek signaal ("wat betekent de Wtp voor mijn rol")
 * blijft daarmee "gecombineerd".
 *
 * De onzekere fallback-intent is bewust "fonds", niet "algemeen": zonder
 * doorvragen leunen we fondsgericht en nooit stil op algemene kennis
 * (schijnzekerheid-guardrail).
 */
export function bepaalBronIntent(vraag: string): BronIntentResultaat {
  const g = normaliseer(vraag);
  const generiek = GENERIEK_INTENT_PATRONEN.some((p) => p.test(g));
  const fondsAnker =
    FONDS_INTENT_PATRONEN.some((p) => p.test(g)) ||
    PERSOONLIJK_INTENT_PATRONEN.some((p) => p.test(g));

  if (fondsAnker && generiek) return { intent: "gecombineerd", vertrouwen: "zeker" };
  if (fondsAnker) return { intent: "fonds", vertrouwen: "zeker" };
  if (generiek) return { intent: "algemeen", vertrouwen: "zeker" };
  return { intent: "fonds", vertrouwen: "onzeker" };
}

/**
 * Is dit een PERSOONLIJKE vraag (over de eigen proces-/taakstand van deze
 * bestuurder)? Puur, herbruikbaar (besluit 0090). Stuurt — samen met
 * isStatusgerichteVraag — of de route de portaalstand meestuurt.
 */
export function isPersoonlijkeVraag(vraag: string): boolean {
  const g = normaliseer(vraag);
  return PERSOONLIJK_INTENT_PATRONEN.some((p) => p.test(g));
}

/**
 * Is dit een STATUSGERICHTE vraag (naar openstaande stand/voortgang)? Puur,
 * herbruikbaar (besluit 0090). Raakt de intent-classificatie NIET; bepaalt
 * uitsluitend of de portaalstand als context wordt meegestuurd.
 */
export function isStatusgerichteVraag(vraag: string): boolean {
  const g = normaliseer(vraag);
  return STATUS_INTENT_PATRONEN.some((p) => p.test(g));
}

/**
 * Moet de portaalstand (eigen eerstvolgende processtap, komende vergadering,
 * agendapunten zonder eigen inbreng) als context worden meegestuurd (besluit
 * 0090)? Alleen bij een persoonlijke of statusgerichte vraag — bij een zuiver
 * algemene vraag gaat er niets extra's mee (kosten/ruis-afweging blijft intact).
 */
export function heeftPortaalstandNodig(vraag: string): boolean {
  return isPersoonlijkeVraag(vraag) || isStatusgerichteVraag(vraag);
}

/**
 * Moet de assistent eerst verduidelijken i.p.v. aannemen (FO §11a)? Alleen bij
 * een ONZEKERE intentie én zonder expliciete fondsrestrictie — heeft de
 * gebruiker "Alleen fondsdocumenten" aangezet, dan is de bron al gekozen.
 */
export function moetVerduidelijken(
  resultaat: BronIntentResultaat,
  alleenFondsdocumenten: boolean
): boolean {
  return resultaat.vertrouwen === "onzeker" && !alleenFondsdocumenten;
}

// KORTE BEVESTIGING (T5 C3) → een inhoudsloze instemming/voortzetting ("ja",
// "ja graag", "doe maar", "prima", "akkoord", "graag") die ná een assistent-
// beurt komt. Zo'n turn draagt geen eigen bron-intentie: hem als een nieuwe,
// ankerloze vraag classificeren levert ten onrechte de verduidelijkingsvraag op
// ("voor uw fonds / algemene zin"), terwijl de gebruiker net een voorstel
// bevestigde. De route zet de intentie dan voort i.p.v. opnieuw te vragen.
//
// Bewust STRIKT: alleen korte turns die (vrijwel) volledig uit een bevestigings-
// formule bestaan. Een echte vraag met "ja" erin ("ja, maar hoe zit het met de
// dekkingsgraad?") is geen bevestiging en moet gewoon geclassificeerd worden.
const BEVESTIGING_PATRONEN: RegExp[] = [
  /^ja(\s*,?\s*(graag|zeker|prima|hoor|klopt|dat( is)? goed|doe (dat|maar)|ga (uw|je) gang))?$/,
  /^(doe|ga) (maar|dat|door|verder|uw gang|je gang)$/,
  /^(graag|prima|akkoord|goed|oké|oke|ok|okay|prima zo|klopt|precies|inderdaad|top|mooi|uitstekend)$/,
  /^(dat (is )?goed|dat lijkt me (goed|prima)|lijkt me (goed|prima)|is goed)$/,
  /^(graag|ja) (gedaan|die|deze|dat)$/,
];

/**
 * Is deze turn een korte bevestiging/voortzetting zonder eigen inhoud (T5 C3)?
 * Puur en herbruikbaar; genormaliseerd (lowercase, leestekens/whitespace
 * geneutraliseerd). Een korte lengtegrens voorkomt dat een langere zin die
 * toevallig met "ja" opent als bevestiging telt.
 */
export function isKorteBevestiging(vraag: string): boolean {
  const g = normaliseer(vraag)
    .replace(/[.!…]+$/g, "")
    .trim();
  if (!g || g.length > 40) return false;
  return BEVESTIGING_PATRONEN.some((p) => p.test(g));
}

/**
 * De AUTO bron-modus voor retrieval. Design A "combineren-vloer": tenzij de
 * gebruiker expliciet beperkt tot fondsdocumenten, halen we altijd op
 * ("combineren") — nooit volledig overslaan. De INTENT verandert deze modus
 * niet (gedragsneutraal t.o.v. Increment G); intent stuurt promptframing en
 * meldingen, niet de retrieval-modus.
 */
export function bepaalAutoBronModus(alleenFondsdocumenten: boolean): BronModus {
  return alleenFondsdocumenten ? "documenten" : "combineren";
}

/** Vaste verduidelijkingsvraag bij twijfel (FO §11a). */
export const VERDUIDELIJKINGSVRAAG =
  "Wilt u dit weten voor uw fonds specifiek, of in algemene zin?";

/** Een keuze-optie bij de verduidelijkingsvraag. `intent` is de intentie die de
 *  gebruiker met de chip bevestigt; de UI/route hervraagt daarmee zonder twijfel. */
export interface Verduidelijkingsoptie {
  intent: Extract<BronIntent, "fonds" | "algemeen">;
  label: string;
}

export const VERDUIDELIJKING_OPTIES: Verduidelijkingsoptie[] = [
  { intent: "fonds", label: "Voor mijn fonds" },
  { intent: "algemeen", label: "In algemene zin" },
];

// ── Veilige lezing van een opgeslagen/ontvangen antwoordmodus (P1a) ─────────
//  Verhuisd uit `AntwoordWeergave.tsx`, ONGEWIJZIGD. De oude toelichting
//  motiveerde waarom hij dáár stond ("vraagtype bevat de detectie en blijft in
//  deze tranche ongemoeid"); die reden is met de laagsplitsing vervallen. De
//  gesprekslaag (L2) heeft hem nodig bij het herstellen van een gesprek en bij
//  de reflectie-uitnodiging, en mag daarvoor niet uit `app/` importeren.
//  `AntwoordWeergave.tsx` re-exporteert hem, dus alle bestaande imports werken.
/**
 * Leest een (mogelijk onbekende) antwoordmodus-waarde terug naar het type of
 * null. De waarde komt uit het `meta`-event of, na herladen, uit
 * `gesprekken.berichten` (jsonb) — dus ongecontroleerd.
 *
 * Gebouwd op de bestaande constante `ANTWOORDMODI` hierboven, zodat er geen
 * tweede lijst met modusnamen ontstaat die kan gaan afwijken. Alle surfaces
 * gebruiken deze ene implementatie.
 */
export function leesAntwoordmodus(ruw: unknown): Antwoordmodus | null {
  return typeof ruw === "string" && (ANTWOORDMODI as string[]).includes(ruw)
    ? (ruw as Antwoordmodus)
    : null;
}
