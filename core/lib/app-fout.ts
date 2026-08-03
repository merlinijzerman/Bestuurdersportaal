// ============================================================================
//  app-fout.ts — categorisering, severity en SANITATIE van foutregels (P5)
// ----------------------------------------------------------------------------
//  Pure module. Zet een gevangen `unknown` om in het gestructureerde record dat
//  in `app_errors` landt. Twee aanroepers gebruiken exact deze ene functie:
//
//    * core/lib/api-errors.ts        → schrijft via de RPC fn_app_error_log
//                                      (gedeelde/tenant-surface, sessieclient);
//    * platform/lib/platform-fout-log.ts → schrijft direct met de service-role
//                                      (beheer-surface en de cron-routes).
//
//  Eén implementatie, twee schrijfpaden — anders drift de sanitatie uit elkaar
//  en is de negatieve controle niets waard.
//
//  ── WAAROM DIT BESTAND BESTAAT: DE SANITATIE ───────────────────────────────
//  `core/lib/api-errors.ts` saniteert richting de GEBRUIKER (nooit
//  error.message in de response). Wegschrijven naar de database is een aparte
//  vraag met een andere dreiging: Supabase-foutmeldingen kunnen kolomnamen,
//  tabelnamen en rij-data bevatten, en eigen `throw new Error("... " + tekst)`
//  kan documentinhoud of een vraagtekst meedragen.
//
//  Regel: `melding_kort` is ALTIJD AFGELEID, nooit `error.message` rauw. Vier
//  onafhankelijke structurele grenzen, zodat één gemiste redactie niet meteen
//  een lek is:
//
//    1. Bronselectie — van een PostgrestError worden `details` en `hint` NOOIT
//       overgenomen; dáár zitten kolomnamen en rijwaarden. Alleen `code` (naar
//       foutcode) en `message` (naar de redactiepijplijn).
//    2. Redactie — URL's → host, e-mailadressen, UUID's, quoted literals en
//       cijferreeksen worden vervangen door placeholders.
//    3. Vormeisen — een melding die na redactie te lang of te "prozaïsch" is
//       (meer dan MAX_WOORDEN woorden), of waarvan de ruwe eerste regel langer
//       was dan RUW_MAX, wordt VOLLEDIG ONDERDRUKT. Dit is de grens die het
//       concatenatiegeval vangt (`"Extractie mislukt: " + documenttekst`), dat
//       geen enkele regex herkent.
//    4. Harde kap — MAX_MELDING tekens, ook nog eens afgedwongen door een
//       CHECK-constraint op de kolom en een left() in de RPC.
//
//  Contextwaarden gaan NOOIT mee: alleen `Object.keys(context)`.
//
//  De negatieve controle staat in core/lib/app-fout.sanity.ts en is het bewijs
//  voor acceptatiecriterium 2 van de werkopdracht.
// ============================================================================

/** De tien foutcategorieën uit FO §18.1. Spiegelt de CHECK op app_errors.categorie. */
export type FoutCategorie =
  | "auth_sessie"
  | "autorisatie"
  | "validatie"
  | "upload_bestandsveiligheid"
  | "extractie_ocr"
  | "embedding_indexering"
  | "retrieval_ai"
  | "rate_limiting"
  | "database_integriteit"
  | "externe_afhankelijkheid";

/** De vier severity-niveaus uit FO §18.1, met hun bedoelde opvolging. */
export type FoutSeverity =
  | "laag" // loggen, periodiek bekijken
  | "middel" // signaal op dashboard
  | "hoog" // alert + actie binnen werkdag (alerting volgt in een eigen tranche)
  | "kritiek"; // directe alert, incidentprocedure

/** Wat er daadwerkelijk in `app_errors` landt. Geen enkel veld draagt vrije invoer. */
export type AppFoutRecord = {
  label: string;
  categorie: FoutCategorie;
  severity: FoutSeverity;
  httpStatus: number | null;
  fouttype: string | null;
  foutcode: string | null;
  meldingKort: string | null;
  contextSleutels: string[];
  correlatieId: string | null;
};

export type AppFoutInvoer = {
  /** Routelabel, bv. "chat.POST". Zelfde conventie als errorResponse. */
  label: string;
  error: unknown;
  httpStatus?: number;
  /** Expliciete override; wint van elke afleiding. */
  categorie?: FoutCategorie;
  severity?: FoutSeverity;
  /** Alleen de SLEUTELS hiervan worden bewaard. */
  context?: Record<string, unknown>;
  correlatieId?: string | null;
};

// ── Grenzen ─────────────────────────────────────────────────────────────────
/** Harde kap op melding_kort. Spiegelt de CHECK-constraint op de kolom. */
export const MAX_MELDING = 200;
/** Boven dit aantal woorden leest een melding als proza, niet als techniek → onderdrukken. */
export const MAX_WOORDEN = 16;
/** Ruwe eerste regel langer dan dit → onderdrukken zonder te proberen te redigeren. */
export const RUW_MAX = 300;
/** Maximum aantal contextsleutels dat we bewaren (spiegelt de slice in de RPC). */
export const MAX_CONTEXT_SLEUTELS = 20;

/**
 * Vaste, dataloze markering. Onderscheidt "melding onderdrukt door de vormeis"
 * van "geen melding beschikbaar" (null) — dat verschil is nodig bij debuggen.
 */
export const MELDING_ONDERDRUKT = "(onderdrukt: melding voldeed niet aan de vormeisen)";

// ── Labelconventie → domeincategorie ────────────────────────────────────────
//  De routelabels volgen "<route>.<METHOD>" (zie api-errors.ts). We matchen op
//  prefix, van specifiek naar algemeen. Wat hier niet in staat valt terug op de
//  HTTP-status en daarna op de restbak; zie `leidCategorieAf`.
const LABEL_CATEGORIE: ReadonlyArray<readonly [string, FoutCategorie]> = [
  ["documents.upload", "upload_bestandsveiligheid"],
  ["stuurinformatie.beheer.upload", "upload_bestandsveiligheid"],
  ["documents.her-extract", "extractie_ocr"],
  ["documents.her_extract", "extractie_ocr"],
  ["notulen.segmenteer", "extractie_ocr"],
  ["documents.embeddings-backfill", "embedding_indexering"],
  ["documents.reindex-backfill", "embedding_indexering"],
  ["classificatie.backfill", "embedding_indexering"],
  ["catalogus.import", "embedding_indexering"],
  ["chat", "retrieval_ai"],
  ["zoeken", "retrieval_ai"],
  ["agendapunten", "retrieval_ai"],
  ["voorbereiding", "retrieval_ai"],
  ["besluit-concept", "retrieval_ai"],
  ["aqlab", "retrieval_ai"],
  ["rate-limit", "rate_limiting"],
];

// ── Postgres-foutklassen die op infrastructuur wijzen ───────────────────────
//  SQLSTATE-klassen: 08 = connection exception, 53 = insufficient resources,
//  57 = operator intervention (incl. 57014 statement_timeout), 58 = system error.
//  42P01 = undefined_table — dat betekent bijna altijd "migratie niet gedraaid".
const KRITIEKE_SQLSTATE_KLASSEN = ["08", "53", "57", "58"] as const;
const KRITIEKE_SQLSTATES = ["42P01", "42501"] as const;

// ── Publieke API ────────────────────────────────────────────────────────────

/**
 * Bouwt het foutrecord. Werpt nooit: een logger die zelf faalt is erger dan
 * geen logger. Bij een onverwachte vorm valt hij terug op het minimum dat
 * gegarandeerd veilig is (label + categorie + severity).
 */
export function bouwAppFout(invoer: AppFoutInvoer): AppFoutRecord {
  const httpStatus = normaliseerStatus(invoer.httpStatus);
  const fouttype = leidFouttypeAf(invoer.error);
  const foutcode = leidFoutcodeAf(invoer.error, httpStatus);
  const categorie =
    invoer.categorie ?? leidCategorieAf(invoer.label, invoer.error, httpStatus, foutcode);
  const severity = invoer.severity ?? leidSeverityAf(categorie, httpStatus, foutcode);

  return {
    label: kapAf(invoer.label, 120),
    categorie,
    severity,
    httpStatus,
    fouttype,
    foutcode,
    meldingKort: saniteerMelding(invoer.error),
    contextSleutels: contextSleutels(invoer.context),
    correlatieId: invoer.correlatieId ?? null,
  };
}

/**
 * Redigeert en toetst een foutmelding. Exported omdat de sanity-suite hem
 * rechtstreeks met vijandige invoer bestookt.
 *
 * Geeft `null` als er geen bruikbare melding is, `MELDING_ONDERDRUKT` als de
 * melding de vormeisen niet haalt, en anders de geredigeerde tekst.
 */
export function saniteerMelding(error: unknown): string | null {
  const ruw = ruweBoodschap(error);
  if (ruw === null) return null;

  // Vormeis 1: een lange ruwe melding is per definitie verdacht. Niet proberen
  // te redigeren — dat suggereert een zekerheid die de regex niet heeft.
  if (ruw.length > RUW_MAX) return MELDING_ONDERDRUKT;

  const geredigeerd = redigeer(ruw);
  if (geredigeerd.length === 0) return null;

  // Vormeis 2: te veel woorden leest als proza (documenttekst, vraagtekst,
  // promptfragment), niet als technische melding.
  if (geredigeerd.split(" ").length > MAX_WOORDEN) return MELDING_ONDERDRUKT;

  // Vormeis 3: harde kap. Na de twee eisen hierboven zou dit nooit moeten
  // bijten, maar de kolom-CHECK en de RPC rekenen erop.
  return geredigeerd.slice(0, MAX_MELDING);
}

/** Alleen de SLEUTELS van de logcontext — de waarden verlaten het proces niet. */
export function contextSleutels(context?: Record<string, unknown>): string[] {
  if (!context || typeof context !== "object") return [];
  try {
    return Object.keys(context)
      .filter((k) => typeof k === "string" && k.length > 0)
      .slice(0, MAX_CONTEXT_SLEUTELS)
      .map((k) => kapAf(k, 60));
  } catch {
    return [];
  }
}

// ── Afleidingen ─────────────────────────────────────────────────────────────

/**
 * Categorie, in volgorde van betrouwbaarheid:
 *   1. HTTP-status (hardst: die hebben we zelf gezet);
 *   2. foutvorm (Postgres-SQLSTATE / netwerkfout);
 *   3. labelconventie (domeinkennis);
 *   4. restbak.
 *
 * De restbak is `database_integriteit`. Dat is een bewuste keuze en geen
 * gok-die-voor-waarheid-doorgaat: geen enkel signaal uit deze tranche leest die
 * categorie, dus een verkeerd ingedeelde restfout kan geen meting vertekenen.
 * Op het dashboard blijft hij zichtbaar met label, fouttype en foutcode, en dát
 * is waar de operator op afgaat.
 */
export function leidCategorieAf(
  label: string,
  error: unknown,
  httpStatus: number | null,
  foutcode: string | null
): FoutCategorie {
  if (httpStatus === 401) return "auth_sessie";
  if (httpStatus === 403) return "autorisatie";
  if (httpStatus === 429) return "rate_limiting";
  if (httpStatus !== null && httpStatus >= 400 && httpStatus < 500) return "validatie";

  if (isNetwerkFout(error)) return "externe_afhankelijkheid";
  if (isSqlstate(foutcode)) return "database_integriteit";

  const kleinLabel = (label ?? "").toLowerCase();
  for (const [prefix, categorie] of LABEL_CATEGORIE) {
    if (kleinLabel.startsWith(prefix)) return categorie;
  }

  return "database_integriteit";
}

/** Severity volgens FO §18.1, met de infrastructuurgevallen als kritiek. */
export function leidSeverityAf(
  categorie: FoutCategorie,
  httpStatus: number | null,
  foutcode: string | null
): FoutSeverity {
  if (isKritiekeSqlstate(foutcode)) return "kritiek";

  if (httpStatus !== null && httpStatus >= 500) return "hoog";
  if (categorie === "auth_sessie" || categorie === "autorisatie") return "middel";
  if (httpStatus !== null && httpStatus >= 400) return "laag";

  // Geen status meegegeven: dan is de categorie de enige aanwijzing. Externe
  // afhankelijkheden en databasefouten zijn operationeel dringender dan een
  // afgekeurde invoer.
  if (categorie === "externe_afhankelijkheid" || categorie === "database_integriteit") {
    return "hoog";
  }
  if (categorie === "validatie" || categorie === "rate_limiting") return "laag";
  return "middel";
}

/** Klassenaam van de fout — een type, geen data. */
export function leidFouttypeAf(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof Error) return kapAf(error.name || "Error", 80);
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    // Supabase/PostgREST geeft een plain object met code/message/details/hint.
    if (typeof obj.code === "string" && typeof obj.message === "string") {
      return "PostgrestError";
    }
    const ctor = (error as { constructor?: { name?: unknown } }).constructor;
    if (ctor && typeof ctor.name === "string") return kapAf(ctor.name, 80);
    return "Object";
  }
  return kapAf(typeof error, 80);
}

/**
 * Foutcode: een SQLSTATE, een PostgREST-code of de HTTP-status. Vormgevalideerd
 * — een code die niet op een code lijkt, is waarschijnlijk een tekst.
 */
export function leidFoutcodeAf(error: unknown, httpStatus: number | null): string | null {
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(code)) return code;
    if (typeof code === "number" && Number.isFinite(code)) return String(code);
  }
  if (httpStatus !== null) return `http_${httpStatus}`;
  return null;
}

// ── Interne helpers ─────────────────────────────────────────────────────────

/**
 * Haalt de bronstring op. BEWUST NIET: `details` en `hint` van een
 * PostgrestError — daar staan kolomnamen, constraintdefinities en rijwaarden in.
 */
function ruweBoodschap(error: unknown): string | null {
  if (error === null || error === undefined) return null;

  if (error instanceof Error) {
    return eersteRegel(error.message);
  }
  if (typeof error === "object") {
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === "string") return eersteRegel(msg);
    return null; // een willekeurig object niet serialiseren: dat is een lek-in-wording.
  }
  if (typeof error === "string") return eersteRegel(error);
  return null;
}

function eersteRegel(tekst: string): string | null {
  const regel = tekst.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return regel.length > 0 ? regel : null;
}

/**
 * De redactiepijplijn. Volgorde is functioneel: URL's vóór cijferreeksen (anders
 * verminkt een poort- of pathnummer de host-extractie), en de placeholders zelf
 * bevatten geen cijfers zodat een latere stap ze niet opnieuw raakt.
 */
function redigeer(tekst: string): string {
  return tekst
    // URL's → alleen het schema + de host; pad en query kunnen id's dragen.
    .replace(/\bhttps?:\/\/([^\s/?#"']+)[^\s"']*/gi, (_m, host: string) => `https://${host}`)
    // E-mailadressen.
    .replace(/\b[^\s@"']+@[^\s@"']+\.[A-Za-z]{2,}\b/g, "<email>")
    // UUID's (document-, gebruiker- en fonds-id's).
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "<uuid>"
    )
    // Quoted literals: Postgres zet kolom-, tabel- en constraintnamen én
    // rijwaarden tussen aanhalingstekens.
    .replace(/"[^"]*"/g, '"<x>"')
    .replace(/'[^']*'/g, "'<x>'")
    // Lange cijferreeksen (BSN, rekeningnummers, bedragen, id's).
    .replace(/\b\d{6,}\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

function isNetwerkFout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const obj = error as Record<string, unknown>;
  const naam = error instanceof Error ? error.name : "";
  const code = typeof obj.code === "string" ? obj.code : "";
  return (
    naam === "AbortError" ||
    naam === "TimeoutError" ||
    naam === "FetchError" ||
    /^(ECONN|ENOTFOUND|EAI_|ETIMEDOUT|EPIPE|UND_ERR)/.test(code)
  );
}

/** Een SQLSTATE is exact vijf alfanumerieke tekens (bv. 23505, 42P01). */
function isSqlstate(foutcode: string | null): boolean {
  return foutcode !== null && /^[0-9A-Z]{5}$/.test(foutcode);
}

function isKritiekeSqlstate(foutcode: string | null): boolean {
  if (!isSqlstate(foutcode)) return false;
  const code = foutcode as string;
  if ((KRITIEKE_SQLSTATES as readonly string[]).includes(code)) return true;
  return (KRITIEKE_SQLSTATE_KLASSEN as readonly string[]).includes(code.slice(0, 2));
}

function normaliseerStatus(status?: number): number | null {
  if (typeof status !== "number" || !Number.isFinite(status)) return null;
  const afgerond = Math.trunc(status);
  return afgerond >= 100 && afgerond <= 599 ? afgerond : null;
}

function kapAf(waarde: string, max: number): string {
  return typeof waarde === "string" ? waarde.slice(0, max) : "";
}
