// ============================================================================
//  monitoring-signalen.ts — signaalregistry en statusbepaling (P5)
// ----------------------------------------------------------------------------
//  PURE module: geen Supabase, geen fetch, geen server-only. Alles hier is
//  programmatisch na te rekenen — zie platform/lib/monitoring-signalen.sanity.ts.
//
//  ── DE REGISTRY IS FALLBACK, NIET DE BRON ──────────────────────────────────
//  De drempels leven ALS DATA in `platform_signaal_config` (besluit 0105); een
//  drempel bijstellen is een SQL-update, geen deploy. Deze registry bestaat om
//  twee redenen:
//    1. hij is de seedbron voor die tabel (de migratie plakt dezelfde waarden);
//    2. hij is de fallback als een rij ontbreekt of onleesbaar is — een
//       ontbrekende configregel mag nooit een snapshot blokkeren.
//  Wijkt de tabel af van deze waarden, dan WINT DE TABEL. Dat is het hele punt.
//
//  ── DREMPELCONVENTIE: INCLUSIEF ────────────────────────────────────────────
//  `drempelOranje` is de waarde VANAF welke de status geldt.
//    hoger_is_slechter: waarde >= drempel  → die status
//    lager_is_slechter: waarde <= drempel  → die status
//  FO §19 formuleert een paar drempels exclusief (">2%", "<99,5%"). Waar dat
//  verschilt, slaat deze conventie één haartje strenger uit — bij een
//  monitoringdrempel is dat de goede kant op, en het is hier expliciet
//  vastgelegd in plaats van verstopt in een vergelijkingsoperator.
//
//  ── EEN BLINDE MONITOR IS EEN RISICO (FO §18.2) ────────────────────────────
//  `isVerouderd` is geen detail maar de kern van de zelfmonitoring: een
//  stilgevallen snapshot-job maakt een signaal GRIJS/ONBEKEND, nooit groen.
//  Dat is de les uit bevinding T-01 (45 sanity-suites die twee weken niet
//  draaiden zonder dat iemand het zag), nu ingebouwd in de monitoringlaag zelf.
// ============================================================================

import { SUPPRESSIE_DREMPEL } from "@/core/lib/suppressie";

export type SignaalId =
  | "uptime_kern"
  | "embedding_indexering_fouten"
  | "extractie_achterstand"
  | "ingest_stilstand"
  | "ingest_doorlooptijd_p95"
  | "rate_limit_incidenten"
  | "rate_limit_fail_open"
  | "gateway_log_fouten"
  | "audit_volledigheid"
  | "ai_latency_p95"
  | "lege_antwoord_ratio"
  | "tokenverbruik";

export type SignaalStatus = "groen" | "oranje" | "rood" | "onbekend";
export type Richting = "hoger_is_slechter" | "lager_is_slechter";
export type Eenheid = "percentage" | "aantal" | "milliseconden" | "trend_percentage";

/**
 * De vier ketendomeinen van de statusbalk (voorstel §4, laag 1). CODE-ONLY: een
 * domein is een eigenschap van de meetdefinitie, geen instelling.
 */
export type Domein =
  | "beschikbaarheid"
  | "verwerking"
  | "ai_kwaliteit"
  | "beveiliging_audit";

export const DOMEIN_LABEL: Record<Domein, string> = {
  beschikbaarheid: "Beschikbaarheid",
  verwerking: "Verwerking",
  ai_kwaliteit: "AI-kwaliteit",
  beveiliging_audit: "Beveiliging en audit",
};

/** Vaste weergavevolgorde van de domeintegels. */
export const DOMEIN_VOLGORDE: Domein[] = [
  "beschikbaarheid",
  "verwerking",
  "ai_kwaliteit",
  "beveiliging_audit",
];

/**
 * Dekkingsbadge (voorstel §4.1 regel 7). CODE-ONLY. `niet_in_werking` is
 * gereserveerd voor signalen waarvan de bron een stub is — die mogen nooit groen
 * tonen. Het bestaande `dekkingsvoorbehoud` blijft de TEKST; dit is de BADGE.
 */
export type Dekkingsniveau =
  | "volledig"
  | "gedeeltelijk"
  | "indicatief"
  | "niet_in_werking";

export const DEKKINGSNIVEAU_LABEL: Record<Dekkingsniveau, string> = {
  volledig: "Volledig",
  gedeeltelijk: "Gedeeltelijke dekking",
  indicatief: "Indicatief",
  niet_in_werking: "Niet in werking",
};

export type SignaalConfig = {
  signaal: SignaalId;
  label: string;
  eenheid: Eenheid;
  intervalMinuten: number;
  /** 0 = momentopname (geen tijdvenster). */
  vensterMinuten: number;
  drempelOranje: number | null;
  drempelRood: number | null;
  richting: Richting;
  /** null = geen n-drempel. */
  nDrempel: number | null;
  actief: boolean;
  toelichting: string | null;
  /** Platformbrede signalen krijgen één rij met fonds_id = null. */
  platformbreed: boolean;
  /**
   * Wat deze meting NIET dekt. CODE-ONLY, net als `platformbreed`: een
   * dekkingsvoorbehoud is een eigenschap van de meetdefinitie, geen instelling.
   * Stond het in `toelichting`, dan zou één SQL-update op
   * platform_signaal_config de disclaimer laten verdwijnen — zonder deploy,
   * zonder review, zonder auditregel.
   */
  dekkingsvoorbehoud: string | null;

  // ── Vijf CODE-ONLY velden (voorstel §4.1, §5.1) ────────────────────────────
  //  Alle vijf zijn eigenschappen van de meetdefinitie of van de
  //  organisatieafspraak, geen instellingen. `combineerConfig()` leest ze NOOIT
  //  uit de database — precies zoals `platformbreed` en `dekkingsvoorbehoud`.
  //  Een eigenaar of opvolgactie die met één SQL-update leeg te maken is, is geen
  //  afspraak; een domein dat verschuift zonder deploy maakt de statusbalk onbetrouwbaar.

  /** In welke domeintegel van de ketenstatusbalk dit signaal telt. */
  domein: Domein;
  /** Eén zin in bestuurstaal: wat er aan de hand is (regel 1). */
  betekenis: string;
  /** Wie het oppakt bij een afwijking (regel 6). Organisatieafspraak. */
  eigenaar: string;
  /** Wat je doet bij rood (regel 6). Organisatieafspraak. */
  opvolgactie: string;
  /** De dekkingsbadge in de tabel (regel 7); de tekst blijft `dekkingsvoorbehoud`. */
  dekkingsniveau: Dekkingsniveau;
};

/**
 * Factor op het interval waarna een snapshot als verouderd geldt. 2,5 is ruim
 * genoeg om één gemiste run te overleven (netwerkhikje, koude start) en strak
 * genoeg om een echt stilgevallen cron binnen redelijke tijd zichtbaar te maken.
 */
export const VEROUDERINGSFACTOR = 2.5;

/**
 * Eigenaar per domein — organisatieafspraak (voorstel §4.1 regel 6, werkopdracht
 * §3-punt 8). Eén bron per domein, zodat twee signalen in hetzelfde domein niet
 * uiteen kunnen lopen. CODE-ONLY; niet via de configtabel te wijzigen.
 */
const EIGENAAR: Record<Domein, string> = {
  beschikbaarheid: "Platformbeheer",
  verwerking: "Beheer documentketen",
  ai_kwaliteit: "AI-beheer",
  beveiliging_audit: "Platformbeheer en compliance",
};

/** Opvolgactie bij rood per domein (werkopdracht §3-punt 8). CODE-ONLY. */
const OPVOLGACTIE: Record<Domein, string> = {
  beschikbaarheid:
    "Componentuitsplitsing openen en de storingsroute van de rode component volgen; bij meer dan 15 minuten impact het incident vastleggen.",
  verwerking:
    "Controleren of de verwerkingsworker draait; bij aanhoudende achterstand handmatig herverwerken en het fonds informeren dat recente stukken nog niet vindbaar zijn.",
  ai_kwaliteit:
    "Vaststellen of het aan curatie (geen actueel document) of aan retrieval/model ligt; bij curatie een actie richting het fonds.",
  beveiliging_audit:
    "Elke waarneming afzonderlijk nagaan; bij fail-open of een auditgat het incident vastleggen en beoordelen of melding nodig is.",
};

/**
 * De acht signalen van deze tranche (FO §19 nrs. 1-7 en 14). Deze waarden zijn
 * IDENTIEK aan de seed in supabase/migrations/2026_08_03_p5_monitoring.sql —
 * wijzig ze samen, of laat de tabel bewust afwijken (die wint).
 */
export const SIGNAAL_REGISTRY: Record<SignaalId, SignaalConfig> = {
  uptime_kern: {
    signaal: "uptime_kern",
    label: "Uptime kernfunctionaliteit",
    eenheid: "percentage",
    intervalMinuten: 5,
    vensterMinuten: 1440,
    drempelOranje: 99.5,
    drempelRood: 99.0,
    richting: "lager_is_slechter",
    nDrempel: null,
    actief: true,
    toelichting:
      "Aandeel healthcheck-runs zonder rode component. Traag (oranje) en onbekend tellen niet als storing.",
    platformbreed: true,
    dekkingsvoorbehoud: null,
    domein: "beschikbaarheid",
    betekenis: "Of de kernfuncties van het platform bereikbaar zijn.",
    eigenaar: EIGENAAR.beschikbaarheid,
    opvolgactie: OPVOLGACTIE.beschikbaarheid,
    dekkingsniveau: "volledig",
  },
  embedding_indexering_fouten: {
    signaal: "embedding_indexering_fouten",
    label: "Embedding-/indexeringsfouten",
    eenheid: "percentage",
    intervalMinuten: 15,
    vensterMinuten: 60,
    drempelOranje: 2,
    drempelRood: 5,
    richting: "hoger_is_slechter",
    nDrempel: null,
    actief: true,
    toelichting:
      "Aandeel mislukte ingest-jobs t.o.v. alle in het venster afgeronde jobs (geslaagd + mislukt).",
    platformbreed: false,
    dekkingsvoorbehoud:
      "Eén ingest-job draagt de hele keten (extractie→embedding), dus een uitsplitsing per fase is niet mogelijk; dit is de totale faalratio. Bewuste weigeringen (cap/OCR) en overgeslagen jobs (document gedeactiveerd) tellen niet als fout.",
    domein: "verwerking",
    betekenis: "Welk deel van de aangeboden documenten niet verwerkt kan worden.",
    eigenaar: EIGENAAR.verwerking,
    opvolgactie: OPVOLGACTIE.verwerking,
    dekkingsniveau: "gedeeltelijk",
  },
  extractie_achterstand: {
    signaal: "extractie_achterstand",
    label: "Ingest-achterstand (wachtrij)",
    eenheid: "aantal",
    intervalMinuten: 15,
    vensterMinuten: 0,
    drempelOranje: 10,
    drempelRood: 50,
    richting: "hoger_is_slechter",
    nDrempel: null,
    actief: true,
    toelichting:
      "Momentopname: openstaande ingest-jobs (status wachtend of bezig).",
    platformbreed: false,
    dekkingsvoorbehoud:
      "Telt elk document met een open job; in het single-job-model is er geen aparte extractie- of embedding-wachtrij, dus dit is de gehele ingest-achterstand, niet alleen extractie/OCR.",
    domein: "verwerking",
    betekenis: "Hoeveel documenten nog wachten op verwerking.",
    eigenaar: EIGENAAR.verwerking,
    opvolgactie: OPVOLGACTIE.verwerking,
    dekkingsniveau: "gedeeltelijk",
  },
  ingest_stilstand: {
    signaal: "ingest_stilstand",
    label: "Ingest-stilstand (oudste openstaande job)",
    eenheid: "milliseconden",
    intervalMinuten: 15,
    vensterMinuten: 0,
    // 30 min / 120 min, opgeslagen in ms. 30 sluit aan op HANGEND_MINUTEN in
    // monitoring-health.ts; géén nieuwe eenheidswaarde (architectuurpunt 9).
    drempelOranje: 1_800_000,
    drempelRood: 7_200_000,
    richting: "hoger_is_slechter",
    nDrempel: null,
    actief: true,
    toelichting:
      "Momentopname: de leeftijd van de oudste openstaande ingest-job (wachtend of bezig). Een lege wachtrij is groen — niets te doen is een gezonde toestand.",
    platformbreed: false,
    dekkingsvoorbehoud:
      "Detecteert een stilgevallen verwerkingsworker onafhankelijk van het aantal wachtende documenten: één document dat drie dagen blijft staan is even alarmerend als tien. Meet de leeftijd sinds `aangemaakt`, niet de rekentijd.",
    domein: "verwerking",
    betekenis: "Of documenten te lang op verwerking blijven wachten.",
    eigenaar: EIGENAAR.verwerking,
    opvolgactie: OPVOLGACTIE.verwerking,
    dekkingsniveau: "volledig",
  },
  ingest_doorlooptijd_p95: {
    signaal: "ingest_doorlooptijd_p95",
    label: "Ingest-doorlooptijd (p95)",
    eenheid: "milliseconden",
    intervalMinuten: 60,
    vensterMinuten: 1440,
    // Richtwaarden 30 min / 2 u (in ms), te kalibreren via de configtabel na een
    // week meten — FO §19 stelt drempels expliciet als richtwaarden.
    drempelOranje: 1_800_000,
    drempelRood: 7_200_000,
    richting: "hoger_is_slechter",
    // GEEN privacy-n-drempel: C3 leunt op documenten, niet op bestuurders
    // (besluit 0055 niet van toepassing). De BETEKENISdrempel (n<5 → geen
    // percentiel) zit in de meetfunctie met een eigen reden in meta.
    nDrempel: null,
    actief: true,
    toelichting:
      "p95 van de tijd tussen aanmaken en afronden van ingest-jobs over 24 uur (eind − aangemaakt, inclusief wachttijd).",
    platformbreed: false,
    dekkingsvoorbehoud:
      "Meet de ketenduur (eind − aangemaakt) inclusief wachttijd in de wachtrij, niet alleen de rekentijd. Op het generieke-bibliotheekpad bestaan per-stap-jobs, op het fondspad één job voor de hele keten; een uitsplitsing per fase is daarom niet platformbreed beschikbaar. Onder vijf afgeronde jobs geen percentiel — te weinig waarnemingen. Aggregeert op document-, niet op bestuurderniveau (besluit 0055 niet van toepassing).",
    domein: "verwerking",
    betekenis: "Hoe lang een document erover doet om doorzoekbaar te worden.",
    eigenaar: EIGENAAR.verwerking,
    opvolgactie: OPVOLGACTIE.verwerking,
    dekkingsniveau: "gedeeltelijk",
  },
  rate_limit_incidenten: {
    signaal: "rate_limit_incidenten",
    label: "Rate-limit-incidenten",
    eenheid: "aantal",
    intervalMinuten: 15,
    vensterMinuten: 1440,
    drempelOranje: 20,
    drempelRood: 40,
    richting: "hoger_is_slechter",
    nDrempel: null,
    actief: true,
    toelichting:
      "429-responses in 24 uur: verzoeken die zijn afgeremd (de rem wérkte). Mislukte limietchecks staan apart in rate_limit_fail_open.",
    platformbreed: false,
    dekkingsvoorbehoud: "Telt sinds definitie_versie 2 uitsluitend 429-responses (de rem wérkte). Historische snapshots vóór de omschakeling telden ook fail-open mee; de trend van zeven dagen heelt die breuk vanzelf.",
    domein: "beveiliging_audit",
    betekenis: "Hoe vaak verzoeken zijn afgeremd om overbelasting te voorkomen.",
    eigenaar: EIGENAAR.beveiliging_audit,
    opvolgactie: OPVOLGACTIE.beveiliging_audit,
    dekkingsniveau: "gedeeltelijk",
  },
  rate_limit_fail_open: {
    signaal: "rate_limit_fail_open",
    label: "Rate-limit fail-open (limietcheck uitgevallen)",
    eenheid: "aantal",
    intervalMinuten: 15,
    vensterMinuten: 1440,
    // Eén is al aandacht, twee verstoord: fail-open is de ernstige variant en mag
    // niet in de ruis van de 429's verdwijnen (voorstel §4.1 regel 4).
    drempelOranje: 1,
    drempelRood: 2,
    richting: "hoger_is_slechter",
    nDrempel: null,
    actief: true,
    toelichting:
      "Aantal mislukte limietchecks in 24 uur: de rem viel wég (fail-open). Het tegenovergestelde van een 429, waar de rem juist wérkte.",
    platformbreed: false,
    dekkingsvoorbehoud:
      "De ernstige tegenhanger van rate_limit_incidenten: bij fail-open werd een verzoek NIET afgeremd doordat de limietcheck zelf faalde. Zelfde bron (app_errors, categorie rate_limiting, severity hoog).",
    domein: "beveiliging_audit",
    betekenis: "Of de snelheidsbegrenzing zelf is uitgevallen.",
    eigenaar: EIGENAAR.beveiliging_audit,
    opvolgactie: OPVOLGACTIE.beveiliging_audit,
    dekkingsniveau: "gedeeltelijk",
  },
  gateway_log_fouten: {
    signaal: "gateway_log_fouten",
    label: "AI-gateway auditlogfouten",
    eenheid: "aantal",
    intervalMinuten: 15,
    vensterMinuten: 1440,
    drempelOranje: 1,
    drempelRood: 2,
    richting: "hoger_is_slechter",
    nDrempel: null,
    actief: true,
    toelichting:
      "Aantal providercalls waarvan de inhoudsvrije gateway-auditregel niet kon worden opgeslagen in de afgelopen 24 uur.",
    platformbreed: true,
    dekkingsvoorbehoud:
      "Meet de gestructureerde foutmelding in app_errors. Een gelijktijdige storing van zowel het private gatewaylog als app_errors blijft alleen in het serverlog zichtbaar.",
    domein: "beveiliging_audit",
    betekenis: "Of elke AI-providercall een inhoudsvrije auditregel heeft gekregen.",
    eigenaar: EIGENAAR.beveiliging_audit,
    opvolgactie: OPVOLGACTIE.beveiliging_audit,
    dekkingsniveau: "gedeeltelijk",
  },
  audit_volledigheid: {
    signaal: "audit_volledigheid",
    label: "Audit-volledigheid (attempt zonder result)",
    eenheid: "aantal",
    intervalMinuten: 15,
    vensterMinuten: 1440,
    drempelOranje: 1,
    drempelRood: 5,
    richting: "hoger_is_slechter",
    nDrempel: null,
    actief: true,
    toelichting:
      "Attempt-events zonder bijbehorend result-event, ouder dan 5 minuten. Alleen het AANTAL; doorklik vergt platform.logs.read (P6).",
    platformbreed: false,
    dekkingsvoorbehoud: "Alleen het aantal; doorklik naar de logregels vereist platform.logs.read (P6).",
    domein: "beveiliging_audit",
    betekenis: "Of elke handeling een volledig spoor in het auditlogboek achterlaat.",
    eigenaar: EIGENAAR.beveiliging_audit,
    opvolgactie: OPVOLGACTIE.beveiliging_audit,
    dekkingsniveau: "volledig",
  },
  ai_latency_p95: {
    signaal: "ai_latency_p95",
    label: "AI-modellatency (p95)",
    eenheid: "milliseconden",
    intervalMinuten: 60,
    vensterMinuten: 1440,
    drempelOranje: 5000,
    drempelRood: 10000,
    richting: "hoger_is_slechter",
    nDrempel: SUPPRESSIE_DREMPEL,
    actief: true,
    toelichting:
      "p95 van de modeltijd per gesprek (map-lus + eindgeneratie). Geen doorlooptijd van de beurt.",
    platformbreed: false,
    dekkingsvoorbehoud: "Modeltijd van de assistentchat (map-lus + eindgeneratie). Retrieval, query-reformulatie en reranker vallen erbuiten, net als de AI-routes voorbereiding en besluit-concept.",
    domein: "ai_kwaliteit",
    betekenis: "Hoe snel de AI-assistent antwoord geeft.",
    eigenaar: EIGENAAR.ai_kwaliteit,
    opvolgactie: OPVOLGACTIE.ai_kwaliteit,
    dekkingsniveau: "gedeeltelijk",
  },
  lege_antwoord_ratio: {
    signaal: "lege_antwoord_ratio",
    label: "Lege-antwoord-ratio",
    eenheid: "percentage",
    intervalMinuten: 60,
    vensterMinuten: 1440,
    drempelOranje: 15,
    drempelRood: 30,
    richting: "hoger_is_slechter",
    nDrempel: SUPPRESSIE_DREMPEL,
    actief: true,
    toelichting:
      "Aandeel antwoorden met geselecteerd = 0 of zwakke_bronbasis = true; terugvragen tellen niet mee.",
    platformbreed: false,
    dekkingsvoorbehoud: null,
    domein: "ai_kwaliteit",
    betekenis: "Hoe vaak de AI geen bruikbaar antwoord kon geven.",
    eigenaar: EIGENAAR.ai_kwaliteit,
    opvolgactie: OPVOLGACTIE.ai_kwaliteit,
    dekkingsniveau: "volledig",
  },
  tokenverbruik: {
    signaal: "tokenverbruik",
    label: "Tokenverbruik per fonds",
    eenheid: "trend_percentage",
    intervalMinuten: 60,
    vensterMinuten: 1440,
    drempelOranje: 50,
    drempelRood: 100,
    richting: "hoger_is_slechter",
    nDrempel: SUPPRESSIE_DREMPEL,
    actief: true,
    toelichting:
      "Procentuele stijging t.o.v. het voortschrijdend daggemiddelde van de basisperiode. Ondergrens — zie het dekkingsvoorbehoud.",
    platformbreed: false,
    dekkingsvoorbehoud: "Ondergrens: eindgeneratie + map-lus incl. cachetokens. NIET meegeteld: reranker, query-reformulatie, web_search, en de AI-routes voorbereiding en besluit-concept (die loggen niet in governance_log).",
    domein: "ai_kwaliteit",
    betekenis: "Of het AI-verbruik sterk afwijkt van wat gebruikelijk is.",
    eigenaar: EIGENAAR.ai_kwaliteit,
    opvolgactie: OPVOLGACTIE.ai_kwaliteit,
    dekkingsniveau: "indicatief",
  },
};

/** Dashboardvolgorde: beschikbaarheid eerst, dan operationeel, dan governance. */
export const SIGNAAL_VOLGORDE: SignaalId[] = [
  "uptime_kern",
  "extractie_achterstand",
  "embedding_indexering_fouten",
  "ingest_stilstand",
  "ingest_doorlooptijd_p95",
  "rate_limit_incidenten",
  "rate_limit_fail_open",
  "gateway_log_fouten",
  "ai_latency_p95",
  "lege_antwoord_ratio",
  "tokenverbruik",
  "audit_volledigheid",
];

export function isSignaalId(waarde: string): waarde is SignaalId {
  return Object.prototype.hasOwnProperty.call(SIGNAAL_REGISTRY, waarde);
}

/** Rijvorm van platform_signaal_config zoals Supabase hem teruggeeft. */
export type ConfigRij = {
  signaal: string;
  label?: string | null;
  eenheid?: string | null;
  interval_minuten?: number | null;
  venster_minuten?: number | null;
  drempel_oranje?: number | string | null;
  drempel_rood?: number | string | null;
  richting?: string | null;
  n_drempel?: number | null;
  actief?: boolean | null;
  toelichting?: string | null;
};

/**
 * Legt de configuratie uit de database over de registry heen. Elk veld dat in de
 * database ontbreekt of onbruikbaar is, valt terug op de registry — zo kan een
 * halve of foutieve configregel een snapshot niet slopen.
 *
 * `platformbreed` en `dekkingsvoorbehoud` komen ALTIJD uit de code: of een
 * signaal per fonds telt en wat het níet dekt, zijn eigenschappen van de
 * meetdefinitie, geen instellingen.
 *
 * `nDrempel` kent een VLOER. Een signaal dat in de registry een n-drempel draagt
 * (de gebruikssignalen) kan hem via de database niet onder de projectbrede
 * suppressiedrempel krijgen en niet op null zetten. Zou dat wel kunnen, dan is
 * besluit 0055 met één SQL-update uitgeschakeld voor precies de signalen waar het
 * voor bedoeld is — terwijl het dashboard blijft beweren dat de drempel geldt.
 * Een lagere drempel hoort een besluit te zijn dat 0055 herziet, geen update.
 */
export function combineerConfig(signaal: SignaalId, rij: ConfigRij | null): SignaalConfig {
  const basis = SIGNAAL_REGISTRY[signaal];
  if (!rij) return basis;

  return {
    ...basis,
    label: nietLeeg(rij.label) ?? basis.label,
    eenheid: isEenheid(rij.eenheid) ? rij.eenheid : basis.eenheid,
    intervalMinuten: positiefGetal(rij.interval_minuten) ?? basis.intervalMinuten,
    vensterMinuten: nietNegatiefGetal(rij.venster_minuten) ?? basis.vensterMinuten,
    drempelOranje: getalOfNull(rij.drempel_oranje, basis.drempelOranje),
    drempelRood: getalOfNull(rij.drempel_rood, basis.drempelRood),
    richting: isRichting(rij.richting) ? rij.richting : basis.richting,
    nDrempel: bepaalNDrempel(basis.nDrempel, rij.n_drempel),
    actief: typeof rij.actief === "boolean" ? rij.actief : basis.actief,
    toelichting: nietLeeg(rij.toelichting) ?? basis.toelichting,
  };
}

/**
 * Statusbepaling. Geeft `onbekend` als er geen waarde is of als de n-drempel
 * bijt — een onderdrukte meting is nadrukkelijk GEEN groen.
 */
export function bepaalStatus(
  waarde: number | null,
  n: number | null,
  config: SignaalConfig
): SignaalStatus {
  if (waarde === null || !Number.isFinite(waarde)) return "onbekend";
  if (config.nDrempel !== null && (n === null || n < config.nDrempel)) return "onbekend";

  const { drempelOranje, drempelRood, richting } = config;
  if (richting === "hoger_is_slechter") {
    if (drempelRood !== null && waarde >= drempelRood) return "rood";
    if (drempelOranje !== null && waarde >= drempelOranje) return "oranje";
    return "groen";
  }
  if (drempelRood !== null && waarde <= drempelRood) return "rood";
  if (drempelOranje !== null && waarde <= drempelOranje) return "oranje";
  return "groen";
}

/** True als de meting onderdrukt wordt wegens te weinig waarnemingen (besluit 0055). */
export function isOnderdruktDoorNDrempel(n: number | null, config: SignaalConfig): boolean {
  if (config.nDrempel === null) return false;
  return n === null || n < config.nDrempel;
}

/**
 * Maskeert één trendpunt. Onder de n-drempel gaat de waarde eruit, niet alleen
 * uit de weergave — de trendlijn krijgt álle historische punten en zou een
 * onderdrukte waarde anders gewoon plotten (en in het aria-label uitspreken).
 *
 * Aparte functie zodat de privacywaarborg programmatisch na te rekenen is in
 * plaats van te leunen op één regel in de leeslaag.
 */
export function maskeerTrendwaarde(
  waarde: number | null,
  n: number | null,
  config: SignaalConfig
): number | null {
  return isOnderdruktDoorNDrempel(n, config) ? null : waarde;
}

/**
 * True als de laatste snapshot te oud is voor het interval van dit signaal.
 * Ontbreekt de snapshot helemaal, dan is dat óók verouderd — er is dan niets
 * gemeten, en "niets gemeten" mag nooit als "in orde" lezen.
 */
export function isVerouderd(
  laatsteTijdstip: Date | string | null,
  config: SignaalConfig,
  nu: Date
): boolean {
  if (!laatsteTijdstip) return true;
  const t = laatsteTijdstip instanceof Date ? laatsteTijdstip : new Date(laatsteTijdstip);
  if (Number.isNaN(t.getTime())) return true;
  const maxLeeftijdMs = config.intervalMinuten * VEROUDERINGSFACTOR * 60_000;
  return nu.getTime() - t.getTime() > maxLeeftijdMs;
}

/**
 * De status zoals het dashboard hem toont: een verouderde meting wordt
 * `onbekend`, ongeacht hoe groen de opgeslagen waarde was.
 */
export function statusVoorWeergave(
  opgeslagenStatus: SignaalStatus,
  laatsteTijdstip: Date | string | null,
  config: SignaalConfig,
  nu: Date
): SignaalStatus {
  return isVerouderd(laatsteTijdstip, config, nu) ? "onbekend" : opgeslagenStatus;
}

/**
 * True als dit signaal nu moet draaien: er is nog nooit gemeten, of de laatste
 * meting is ouder dan het interval.
 *
 * Zelfherstellend en stateloos: na een gemiste run haalt de eerstvolgende run
 * het signaal vanzelf in, zonder dat we ergens hoeven bij te houden wanneer we
 * het laatst hebben gedraaid.
 */
export function moetDraaien(
  laatsteTijdstip: Date | string | null,
  config: SignaalConfig,
  nu: Date
): boolean {
  if (!config.actief) return false;
  if (!laatsteTijdstip) return true;
  const t = laatsteTijdstip instanceof Date ? laatsteTijdstip : new Date(laatsteTijdstip);
  if (Number.isNaN(t.getTime())) return true;
  return nu.getTime() - t.getTime() >= config.intervalMinuten * 60_000;
}

/**
 * p95 volgens dezelfde methode als de AQLab-runaggregatie
 * (platform/lib/aqlab/run-orchestrator.ts): sorteren, index floor(p*n),
 * begrensd op de laatste index. Geen interpolatie — bij MVP-aantallen zou die
 * meer precisie suggereren dan er is.
 */
export function percentiel(waarden: number[], p: number): number | null {
  const geldig = waarden.filter((w) => Number.isFinite(w)).sort((a, b) => a - b);
  if (geldig.length === 0) return null;
  const index = Math.min(geldig.length - 1, Math.floor(p * geldig.length));
  return geldig[index] ?? null;
}

export function p95(waarden: number[]): number | null {
  return percentiel(waarden, 0.95);
}

/**
 * Doorlooptijden (eind − aangemaakt) en rekentijden (eind − start) uit een reeks
 * ingest-jobs, met de randgevallen die een p95 stil zouden vervalsen expliciet
 * eruit gefilterd (architectuurpunt 11, MONITORING-P5-ONTWERP §13):
 *   - status 'overgeslagen' — niet verwerkt, hoort niet in de doorlooptijd;
 *   - jobs zonder `start`, `eind` of `aangemaakt` — `Number(null) === 0` zou
 *     anders een doorlooptijd van "nu − 1970" of 0 opleveren;
 *   - negatieve duur (klok-anomalie).
 * De DOORLOOPTIJD is de ketenduur INCLUSIEF wachttijd (besluit 0144), niet de
 * rekentijd; die laatste komt apart terug voor de decompositie in meta.
 * Pure functie zodat de definitie programmatisch na te rekenen is.
 */
export function ingestDuren(
  jobs: Array<{
    aangemaakt: string | null;
    start: string | null;
    eind: string | null;
    status?: string;
  }>
): { doorloop: number[]; rekentijd: number[] } {
  const doorloop: number[] = [];
  const rekentijd: number[] = [];
  for (const job of jobs) {
    if (job.status === "overgeslagen") continue;
    if (!job.aangemaakt || !job.eind || !job.start) continue;
    const a = new Date(job.aangemaakt).getTime();
    const e = new Date(job.eind).getTime();
    const s = new Date(job.start).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(e) || !Number.isFinite(s)) continue;
    const d = e - a;
    if (d < 0) continue;
    doorloop.push(d);
    const r = e - s;
    if (r >= 0) rekentijd.push(r);
  }
  return { doorloop, rekentijd };
}

/**
 * Procentuele afwijking van `huidig` t.o.v. `basis` (signaal 6).
 * Basis 0 geeft null: "oneindig procent meer dan niets" is geen bruikbaar
 * signaal, en 0 zou suggereren dat er niets aan de hand is.
 */
export function trendPercentage(huidig: number, basis: number): number | null {
  if (!Number.isFinite(huidig) || !Number.isFinite(basis) || basis <= 0) return null;
  return ((huidig - basis) / basis) * 100;
}

// ── Aggregatie over STATUSSEN (voorstel §4, laag 1) ──────────────────────────
//  HARDE REGEL: er wordt NOOIT over waarden geaggregeerd, alleen over statussen.
//  Waarden optellen over fondsen omzeilt de n-drempel (besluit 0055): twee
//  fondsen met n=6 worden samen n=12 en de suppressie is uitgehold, terwijl het
//  dashboard blijft beweren dat de drempel geldt. Deze functies nemen daarom
//  UITSLUITEND SignaalStatus in — geen getallen. De sanity legt dat als negatieve
//  controle vast.

/** Ernstvolgorde: rood > oranje > onbekend > groen. `onbekend` maakt nooit groener. */
const ERNST: Record<SignaalStatus, number> = { groen: 0, onbekend: 1, oranje: 2, rood: 3 };

/**
 * Slechtste status wint. Een lege lijst is `onbekend` (er valt niets te zeggen),
 * nooit groen — een groen aggregaat op afwezigheid is de klassieke dashboardleugen.
 */
export function aggregeerStatus(statussen: SignaalStatus[]): SignaalStatus {
  if (statussen.length === 0) return "onbekend";
  return statussen.reduce(
    (slechtste, s) => (ERNST[s] > ERNST[slechtste] ? s : slechtste),
    "groen" as SignaalStatus
  );
}

export type DomeinSamenvatting = {
  slechtste: SignaalStatus;
  /** Aantal metingen dat aandacht vraagt of verstoord is (oranje + rood). */
  afwijkend: number;
  /** Aantal metingen zonder geldige uitkomst (verouderd of onderdrukt). */
  onbekend: number;
  /** Totaal aantal metingen in dit domein — de noemer bij "2 van 12". */
  totaal: number;
};

/**
 * Vat de metingen (één per signaal × fonds) samen per domein: de slechtste status
 * en het aantal afwijkende én onbekende metingen apart geteld. `onbekend` telt
 * NOOIT als groen; het verschijnt in zijn eigen teller, niet in de noemer van
 * "in orde".
 */
export function samenvattingPerDomein(
  metingen: Array<{ domein: Domein; status: SignaalStatus }>
): Record<Domein, DomeinSamenvatting> {
  const statussenPerDomein = new Map<Domein, SignaalStatus[]>();
  const uit = {} as Record<Domein, DomeinSamenvatting>;
  for (const d of DOMEIN_VOLGORDE) {
    statussenPerDomein.set(d, []);
    uit[d] = { slechtste: "onbekend", afwijkend: 0, onbekend: 0, totaal: 0 };
  }

  for (const m of metingen) {
    statussenPerDomein.get(m.domein)?.push(m.status);
    const bak = uit[m.domein];
    bak.totaal += 1;
    if (m.status === "rood" || m.status === "oranje") bak.afwijkend += 1;
    else if (m.status === "onbekend") bak.onbekend += 1;
  }
  for (const d of DOMEIN_VOLGORDE) uit[d].slechtste = aggregeerStatus(statussenPerDomein.get(d) ?? []);
  return uit;
}

/**
 * Kiest DETERMINISTISCH de slechtst scorende meting uit een groep fondsen (bij
 * "Alle fondsen"). Slechtste status wint; bij gelijke status wint de laagste
 * fondsnaam (lexicografisch, nl). Zonder die tie-break zou het getoonde fonds
 * tussen renders kunnen wisselen (architectuurpunt 5, acceptatie 6).
 */
export function kiesSlechtsteMeting<
  T extends { status: SignaalStatus; fondsNaam: string | null }
>(metingen: T[]): T | null {
  if (metingen.length === 0) return null;
  return (
    [...metingen].sort((a, b) => {
      const d = ERNST[b.status] - ERNST[a.status];
      if (d !== 0) return d;
      return (a.fondsNaam ?? "").localeCompare(b.fondsNaam ?? "", "nl");
    })[0] ?? null
  );
}

// ── Periodesamenvatting (blok D2) ────────────────────────────────────────────

export type PeriodeSamenvatting = {
  /**
   * Aandeel metingen in orde over ALLE punten in de periode — de noemer bevat óók
   * de onbekende punten. Onderdrukte en verouderde punten tellen als onbekend,
   * niet als in orde; anders levert een week met een stilgevallen cron een
   * prachtige score. null als de periode geen enkel punt bevat.
   */
  aandeelInOrde: number | null;
  /** Aantal punten boven een drempel (oranje of rood). */
  overschrijdingen: number;
  /** Langste aaneengesloten reeks afwijkende punten. */
  langsteAfwijking: number;
  /** Aantal punten zonder geldige uitkomst (gemaskeerd of verouderd). */
  onbekend: number;
  /** Totaal aantal punten in de periode. */
  totaal: number;
};

/**
 * Periodesamenvatting per rij. PURE en programmatisch na te rekenen, want de
 * kernregel — onderdrukt/verouderd telt als onbekend, niet als in orde — mag niet
 * in componentlogica leven.
 *
 * `aandeelInOrde` deelt door het TOTAAL (incl. onbekend), niet door de geldige
 * punten. Zou de noemer alleen de geldige punten zijn, dan zou het maskeren van
 * een slecht punt de score juist omhoog duwen. Nu kan maskeren de score alleen
 * gelijk houden of verlagen — de negatieve controle in de sanity bewijst dat.
 */
export function vatPeriodeSamen(
  trend: Array<{ waarde: number | null }>,
  config: SignaalConfig
): PeriodeSamenvatting {
  let inOrde = 0;
  let overschrijdingen = 0;
  let onbekend = 0;
  let langsteAfwijking = 0;
  let huidigeReeks = 0;

  for (const punt of trend) {
    // Een gemaskeerd punt (waarde null) is per definitie onbekend. Een niet-null
    // punt heeft de suppressie al overleefd, dus de status volgt puur uit de
    // drempels — n = config.nDrempel laat de n-controle in bepaalStatus slagen.
    const status =
      punt.waarde === null
        ? ("onbekend" as SignaalStatus)
        : bepaalStatus(punt.waarde, config.nDrempel, config);

    if (status === "groen") {
      inOrde += 1;
      huidigeReeks = 0;
    } else if (status === "oranje" || status === "rood") {
      overschrijdingen += 1;
      huidigeReeks += 1;
      if (huidigeReeks > langsteAfwijking) langsteAfwijking = huidigeReeks;
    } else {
      onbekend += 1;
      huidigeReeks = 0;
    }
  }

  return {
    aandeelInOrde: trend.length === 0 ? null : inOrde / trend.length,
    overschrijdingen,
    langsteAfwijking,
    onbekend,
    totaal: trend.length,
  };
}

/**
 * Client-veilige laatste waarde. Onder suppressie (n<n-drempel) mag de ruwe
 * waarde de client-payload niet bereiken — de tabel is een client component, dus
 * alles wat de leeslaag teruggeeft wordt geserialiseerd naar de browser. Aparte
 * pure functie zodat een latere refactor deze maskering niet stil kan terugdraaien
 * (negatieve controle in de sanity). Zusje van `maskeerTrendwaarde`, maar voor de
 * laatste stand in plaats van een trendpunt.
 */
export function clientVeiligeWaarde(waarde: number | null, onderdrukt: boolean): number | null {
  return onderdrukt ? null : waarde;
}

/**
 * Sleutels die NOOIT in de naar-client geserialiseerde `meta` mogen belanden:
 * identificatoren en individu-/document-herleidbare velden. Vandaag draagt geen
 * enkele meetfunctie zo'n sleutel (alles is een telling of duur), maar `meta`
 * gaat ongefilterd naar de client — dus een toekomstig signaal dat per ongeluk
 * een `document_id` of een titel in `meta` zet, zou stil lekken. Deze denylist
 * maakt "meta = alleen aggregaten" een afgedwongen invariant in plaats van een
 * discipline-afspraak (audit-evidence-review R1).
 */
const META_DENYLIST =
  /(_id$|^id$|titel|naam|e[-_]?mail|bsn|correlatie|prompt|vraag|antwoord|fragment|inhoud)/i;

export function isVeiligeMetaSleutel(sleutel: string): boolean {
  return !META_DENYLIST.test(sleutel);
}

/** Schoont `meta` vóór serialisatie naar de client: houdt alleen veilige sleutels. */
export function scrubMeta(
  meta: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!meta) return null;
  const uit: Record<string, unknown> = {};
  for (const [sleutel, waarde] of Object.entries(meta)) {
    if (isVeiligeMetaSleutel(sleutel)) uit[sleutel] = waarde;
  }
  return uit;
}

export type PiekMediaan = { hoogste: number | null; mediaan: number | null };

/**
 * Hoogste en mediane snapshotwaarde over een reeks. Voor percentiel- en
 * trendsignalen (…_p95, tokenverbruik) is er GEEN geldige "waarde over de
 * periode": je zou percentielen middelen of trendpercentages optellen. De
 * samenvatting toont dan de hoogste en de mediane snapshot, expliciet gelabeld
 * (acceptatie 29) — niet een verzonnen periode-percentiel.
 */
export function piekEnMediaan(waarden: Array<number | null>): PiekMediaan {
  const geldig = waarden
    .filter((w): w is number => w !== null && Number.isFinite(w))
    .sort((a, b) => a - b);
  if (geldig.length === 0) return { hoogste: null, mediaan: null };
  const midden = Math.floor((geldig.length - 1) / 2);
  return { hoogste: geldig[geldig.length - 1] ?? null, mediaan: geldig[midden] ?? null };
}

/**
 * True als de periodesamenvatting voor dit signaal GEEN representatieve
 * periodewaarde mag tonen maar de hoogste + mediane snapshot: percentielsignalen
 * (…_p95) en trendsignalen (trend_percentage). Afgeleid uit de eenheid en de
 * signaalnaam — geen apart configveld nodig.
 */
export function toonPiekInPeriode(config: SignaalConfig): boolean {
  return config.eenheid === "trend_percentage" || config.signaal.endsWith("_p95");
}

/**
 * Dunt een chronologische reeks trendpunten uit tot ten hoogste één punt per
 * klokuur — het LAATSTE punt in elk uur. Zo blijft de payload naar de client
 * begrensd (7 dagen → ≤168 punten/reeks) zonder de leeslimiet te verhogen en
 * zonder databaseobject (blok D3, architectuurpunt 12). De laatste stand per
 * signaal komt NIET uit deze reeks maar uit de nieuwste ruwe rij, dus uitdunnen
 * raakt het stoplicht niet.
 */
export function dunTrendUit<T extends { tijdstip: string }>(punten: T[]): T[] {
  const perUur = new Map<string, T>();
  // "2026-08-08T14" — jaar t/m uur. Punten worden verondersteld chronologisch
  // (oplopend); een Map behoudt de invoegvolgorde en de laatste per uur wint.
  for (const punt of punten) perUur.set(punt.tijdstip.slice(0, 13), punt);
  return [...perUur.values()];
}

// ── Interne helpers ─────────────────────────────────────────────────────────

/**
 * Vloer op de n-drempel. Draagt de registry er één, dan kan de database hem
 * alleen VERHOGEN — nooit verlagen en nooit uitzetten (besluit 0055). Draagt de
 * registry er géén, dan mag de database er alsnog een instellen.
 */
function bepaalNDrempel(
  basis: number | null,
  uitDatabase: number | null | undefined
): number | null {
  const gevraagd = positiefGetal(uitDatabase ?? null);
  if (basis === null) return gevraagd;
  if (gevraagd === null) return basis;
  return Math.max(basis, gevraagd);
}

function nietLeeg(waarde: string | null | undefined): string | null {
  return typeof waarde === "string" && waarde.trim().length > 0 ? waarde : null;
}

function positiefGetal(waarde: number | null | undefined): number | null {
  return typeof waarde === "number" && Number.isFinite(waarde) && waarde > 0 ? waarde : null;
}

function nietNegatiefGetal(waarde: number | null | undefined): number | null {
  return typeof waarde === "number" && Number.isFinite(waarde) && waarde >= 0 ? waarde : null;
}

/** numeric komt uit PostgREST soms als string terug. */
function getalOfNull(waarde: number | string | null | undefined, fallback: number | null): number | null {
  if (waarde === null) return null;
  if (typeof waarde === "number" && Number.isFinite(waarde)) return waarde;
  if (typeof waarde === "string") {
    const n = Number(waarde);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function isEenheid(waarde: string | null | undefined): waarde is Eenheid {
  return (
    waarde === "percentage" ||
    waarde === "aantal" ||
    waarde === "milliseconden" ||
    waarde === "trend_percentage"
  );
}

function isRichting(waarde: string | null | undefined): waarde is Richting {
  return waarde === "hoger_is_slechter" || waarde === "lager_is_slechter";
}
