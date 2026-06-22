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
 * De vier antwoordmodi die de bestuurder ZIET (FO §13). Auto = autodetectie
 * (antwoordmodus === null in de UI). De overige interne modi (historisch,
 * besluitrijpheid, bronoverzicht, persoonlijke_voorbereiding) blijven onder de
 * motorkap bestaan via auto-detectie en vervolgacties, maar krijgen geen knop.
 */
export const ZICHTBARE_ANTWOORDMODI: Antwoordmodus[] = [
  "feitelijk",
  "duiding",
  "sparring",
];

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
  | "onzekerheid_besluit";

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
  heeftBronnen: boolean
): Vervolgactie[] {
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

  if (heeftBronnen) voegToe("toon_bronnen", "Toon gebruikte bronnen", null, false);
  if (besluit)
    voegToe("werk_uit_besluitvorming", "Werk uit richting besluitvorming", "besluitrijpheid", false);

  // Bied de niet-actieve perspectieven aan, zodat de gebruiker zonder
  // herformuleren kan wisselen (FO §13).
  if (antwoordmodus !== "feitelijk")
    voegToe("maak_feitelijker", "Maak feitelijker", "feitelijk", true);
  if (antwoordmodus !== "duiding")
    voegToe("geef_duiding", "Geef bestuurlijke duiding", "duiding", true);
  if (antwoordmodus !== "sparring")
    voegToe("stel_kritische_vragen", "Stel kritische vragen", "sparring", true);

  if (historisch) {
    voegToe("maak_tijdlijn", "Maak een tijdlijn", "historisch", false);
    voegToe("toon_eerdere_besluiten", "Toon eerdere besluiten", "historisch", false);
  }

  voegToe("maak_korter", "Maak korter", null, true);
  voegToe("maak_concreter", "Maak concreter", null, true);

  return acties;
}
