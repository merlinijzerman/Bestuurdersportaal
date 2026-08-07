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
  | "rate_limit_incidenten"
  | "audit_volledigheid"
  | "ai_latency_p95"
  | "lege_antwoord_ratio"
  | "tokenverbruik";

export type SignaalStatus = "groen" | "oranje" | "rood" | "onbekend";
export type Richting = "hoger_is_slechter" | "lager_is_slechter";
export type Eenheid = "percentage" | "aantal" | "milliseconden" | "trend_percentage";

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
};

/**
 * Factor op het interval waarna een snapshot als verouderd geldt. 2,5 is ruim
 * genoeg om één gemiste run te overleven (netwerkhikje, koude start) en strak
 * genoeg om een echt stilgevallen cron binnen redelijke tijd zichtbaar te maken.
 */
export const VEROUDERINGSFACTOR = 2.5;

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
      "Foutregels met categorie rate_limiting: 429-responses plus mislukte limietchecks (fail-open).",
    platformbreed: false,
    dekkingsvoorbehoud: "Telt 429-responses en mislukte limietchecks samen; de mislukte checks (fail-open) staan apart in meta.",
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
  },
};

/** Dashboardvolgorde: beschikbaarheid eerst, dan operationeel, dan governance. */
export const SIGNAAL_VOLGORDE: SignaalId[] = [
  "uptime_kern",
  "extractie_achterstand",
  "embedding_indexering_fouten",
  "rate_limit_incidenten",
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
 * Procentuele afwijking van `huidig` t.o.v. `basis` (signaal 6).
 * Basis 0 geeft null: "oneindig procent meer dan niets" is geen bruikbaar
 * signaal, en 0 zou suggereren dat er niets aan de hand is.
 */
export function trendPercentage(huidig: number, basis: number): number | null {
  if (!Number.isFinite(huidig) || !Number.isFinite(basis) || basis <= 0) return null;
  return ((huidig - basis) / basis) * 100;
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
