// ============================================================================
//  #500 — Fasetijden van de retrievalketen (observability, inhoudsvrij).
// ----------------------------------------------------------------------------
//  WAAROM. Op Productie eindigde de gecombineerde 150d-vraag tweemaal na ~20 s
//  in `retrieval:timeout`, vóór enige modelcall. Dan schrijft de route geen
//  governance-log, en was achteraf niet te zien WELKE stap het budget opsoupeerde:
//  de embedding, een zoek-RPC (welke poging?), het artikelspoor, de versie- of
//  toelatingspoort. Deze module meet dat per stap.
//
//  INHOUDSVRIJ, PER CONSTRUCTIE. Een meting bestaat uitsluitend uit een fase uit
//  een GESLOTEN opsomming, een spoorindex, een poging uit een gesloten
//  opsomming, tijden in ms, een gesloten status en een rijentelling. Er is geen
//  veld waarin een vraag, zoekquery, documenttitel, id of providerfouttekst kan
//  landen. Daarom mag de samenvatting in `retrieval_meta.invoer` (basisniveau,
//  migratievrij) én in een serverlogregel.
//
//  GEDRAGSNEUTRAAL. `meet()` voert het werk exact één keer uit en geeft de
//  uitkomst of de fout ongewijzigd door; zonder meter (`GEEN_FASEMETER`) is het
//  een kale aanroep. Een meter beslist nergens iets.
//
//  REQUEST-LOKAAL. Eén meter per beurt, eigendom van de aanroeper (route) of
//  anders van `voerVolledigeRetrievalUit()`. Nooit moduleglobaal: gelijktijdige
//  beurten van verschillende fondsen mogen geen meetstaat delen.
// ============================================================================

/** De stappen die gemeten worden. Gesloten: een vrije string kan inhoud dragen. */
export const FASEN = [
  // orkestratie (per spoor, tenzij anders vermeld)
  "zoek", // de hele adapteraanroep van één spoor
  "verrijk", // pre-poortverrijking (parent, notulen, documentmetadata)
  "poort", // de centrale toelatingspoort (V1–V5), over alle sporen
  "selectie",
  "citatie", // fase 2 — citaatvorming en weergave (over alle sporen)
  // Supabase-adapter / retrievalkern
  "embedding",
  "rpc_hybride", // zoek_chunks_hybride, per poging
  "rpc_fts", // zoek_chunks, per poging (strikt/terugval)
  "fts_plain", // ongerangschikt vangnet 1
  "fts_ilike", // ongerangschikt vangnet 2
  "scanbewijs", // WP3 filterOpScanbewijs
  "context_prefix",
  "rerank",
  "artikel_documenten", // #500 artikelspoor: juridische documenten
  "artikel_opzoeking", // #500 artikelspoor: exacte passages
  "artikel_toelating", // #500 artikelspoor: id-begrensde toelating
  "documentspoor", // letterlijk genoemd document: titelopzoeking + tekstzoekslag
  "versies", // versiebewijs (leesSupabaseVersies)
  "parent",
  "notulen",
  "documentmeta",
] as const;
export type Fase = (typeof FASEN)[number];

/** Welke zoekpoging (alleen bij RPC- en embeddingfasen). Gesloten opsomming. */
export type Fasepoging = "primair" | "origineel" | "verslapt" | "strikt" | "terugval";

/**
 * - `ok`          — afgerond (ook met 0 rijen);
 * - `fout`        — afgerond met een fout (geen afbreking, geen DB-time-out);
 * - `db_timeout`  — de database brak de statement af (SQLSTATE 57014);
 * - `afgebroken`  — de beurtdeadline of de client stopte het werk;
 * - `ongebruikt`  — #500: speculatief gestart, maar de uitkomst was niet nodig;
 * - `overgeslagen`— #500: bewust niet gestart (begrensde volscan).
 */
export type Fasestatus = "ok" | "fout" | "db_timeout" | "afgebroken" | "ongebruikt" | "overgeslagen";

export interface Fasemeting {
  fase: Fase;
  /** Spoorindex van de orkestratie; `null` voor beurtbrede fasen. */
  spoor: number | null;
  poging?: Fasepoging;
  /** Start ten opzichte van het begin van de meter (ms). */
  start_ms: number;
  ms: number;
  status: Fasestatus;
  /** Aantal opgeleverde rijen/kandidaten, waar zinvol. */
  rijen?: number;
}

export type Retrievaluitkomst = "ok" | "timeout" | "annulering" | "fout";

/**
 * R1 (besluit 0218) — welk TEKSTZOEKPAD de retrieval gebruikte. Alleen gezet
 * als de vlag ZOEK_TEKST_V2 aan stond (met de vlag uit ontbreekt de sleutel,
 * zodat de samenvatting byte-gelijk blijft aan vóór R1):
 * - `nieuw`             — `zoek_chunks_begrensd` is aangeroepen;
 * - `fallback_pgrst202` — die functie ontbrak (PGRST202, migratie niet
 *                          toegepast) en de keten viel éénmaal terug op
 *                          `zoek_chunks`. Telt rood in de r1-releasecheck.
 * Gesloten enum: inhoudsvrij, dus toegestaan op basisniveau én in de logregel.
 */
export type Tekstzoekpad = "nieuw" | "fallback_pgrst202";
/** R1b — alleen aanwezig wanneer de hybride env- én fondsvlag aan staan. */
export type Hybridezoekpad = "nieuw" | "fallback_pgrst202";

/** Wat in `retrieval_meta.invoer.retrieval_fasetijden` en in de logregel staat. */
export interface FasetijdenSamenvatting {
  versie: 1;
  uitkomst: Retrievaluitkomst;
  totaal_ms: number;
  budget_ms: number | null;
  /** Hoeveel metingen er wegvielen door de bovengrens (normaal 0). */
  afgekapt: number;
  fasen: Fasemeting[];
  /** R1 (0218) — alleen aanwezig met de vlag ZOEK_TEKST_V2 aan. */
  tekstzoekpad?: Tekstzoekpad;
  hybridezoekpad?: Hybridezoekpad;
}

export interface MeetOpties<T> {
  poging?: Fasepoging;
  /** Leidt het aantal rijen af uit de uitkomst. */
  rijen?: (uitkomst: T) => number | undefined;
  /** Leidt de status af uit een uitkomst die zelf een fout kan dragen (PostgREST). */
  status?: (uitkomst: T) => Fasestatus | undefined;
}

export interface Fasemeter {
  /** Meet `werk` als één fase. Uitkomst en fout gaan ongewijzigd door. */
  meet<T>(fase: Fase, werk: () => Promise<T>, opties?: MeetOpties<T>): Promise<T>;
  /** Een fase die bewust niet of zonder eigen I/O afliep (bv. `overgeslagen`). */
  noteer(fase: Fase, status: Fasestatus, opties?: { poging?: Fasepoging; rijen?: number; startMs?: number; ms?: number }): void;
  /** Dezelfde meetstaat, met de spoorindex op elke meting. */
  voorSpoor(spoor: number): Fasemeter;
  /**
   * R1 (0218) — markeert het gebruikte tekstzoekpad op de hele meter (beurt-
   * breed, over alle sporen). `fallback_pgrst202` wint van `nieuw`: één
   * terugval in de beurt maakt de hele beurt een terugvalbeurt.
   */
  markeerTekstzoekpad(pad: Tekstzoekpad): void;
  markeerHybridezoekpad(pad: Hybridezoekpad): void;
  /** Relatieve tijd sinds het begin van de meter. */
  nu(): number;
  samenvatting(uitkomst: Retrievaluitkomst, budgetMs?: number | null): FasetijdenSamenvatting;
}

/** Bovengrens op het aantal metingen per beurt: begrensd in log en audit. */
export const MAX_FASEMETINGEN = 64;

/** SQLSTATE 57014 (`statement_timeout`), zoals PostgREST hem doorgeeft. */
export function isDbTimeout(fout: unknown): boolean {
  return typeof fout === "object" && fout !== null && (fout as { code?: unknown }).code === "57014";
}

function isAfbrekingsfout(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const naam = (e as { name?: unknown }).name;
  return naam === "AbortError" || naam === "TimeoutError" || naam === "RetrievalAfgebroken";
}

/** Status van een PostgREST-uitkomst `{ error }` — zonder de fouttekst te lezen. */
export function statusVanPostgrest(
  uitkomst: { error?: unknown } | null | undefined,
  signal?: AbortSignal
): Fasestatus {
  if (signal?.aborted) return "afgebroken";
  const fout = uitkomst?.error;
  if (fout === null || fout === undefined) return "ok";
  if (isDbTimeout(fout)) return "db_timeout";
  if (isAfbrekingsfout(fout)) return "afgebroken";
  return "fout";
}

interface Staat {
  t0: number;
  metingen: Fasemeting[];
  afgekapt: number;
  klok: () => number;
  tekstzoekpad?: Tekstzoekpad;
  hybridezoekpad?: Hybridezoekpad;
}

function maakMeter(staat: Staat, spoor: number | null): Fasemeter {
  const voegToe = (m: Fasemeting) => {
    if (staat.metingen.length >= MAX_FASEMETINGEN) {
      staat.afgekapt++;
      return;
    }
    staat.metingen.push(m);
  };
  const rond = (ms: number) => Math.max(0, Math.round(ms));
  const meter: Fasemeter = {
    async meet<T>(fase: Fase, werk: () => Promise<T>, opties?: MeetOpties<T>): Promise<T> {
      const start = staat.klok();
      let uitkomst: T;
      try {
        uitkomst = await werk();
      } catch (e) {
        voegToe({
          fase,
          spoor,
          ...(opties?.poging ? { poging: opties.poging } : {}),
          start_ms: rond(start - staat.t0),
          ms: rond(staat.klok() - start),
          status: isDbTimeout(e) ? "db_timeout" : isAfbrekingsfout(e) || isAfbrekingsoorzaak(e) ? "afgebroken" : "fout",
        });
        throw e;
      }
      let rijen: number | undefined;
      let status: Fasestatus = "ok";
      try {
        rijen = opties?.rijen?.(uitkomst);
        status = opties?.status?.(uitkomst) ?? "ok";
      } catch {
        // Een telfout mag het werk nooit laten mislukken.
      }
      voegToe({
        fase,
        spoor,
        ...(opties?.poging ? { poging: opties.poging } : {}),
        start_ms: rond(start - staat.t0),
        ms: rond(staat.klok() - start),
        status,
        ...(typeof rijen === "number" && Number.isFinite(rijen) ? { rijen } : {}),
      });
      return uitkomst;
    },
    noteer(fase, status, opties) {
      const start = opties?.startMs ?? staat.klok();
      voegToe({
        fase,
        spoor,
        ...(opties?.poging ? { poging: opties.poging } : {}),
        start_ms: rond(start - staat.t0),
        ms: rond(opties?.ms ?? 0),
        status,
        ...(typeof opties?.rijen === "number" ? { rijen: opties.rijen } : {}),
      });
    },
    voorSpoor(nieuw: number) {
      return maakMeter(staat, nieuw);
    },
    markeerTekstzoekpad(pad) {
      if (staat.tekstzoekpad !== "fallback_pgrst202") staat.tekstzoekpad = pad;
    },
    markeerHybridezoekpad(pad) {
      if (staat.hybridezoekpad !== "fallback_pgrst202") staat.hybridezoekpad = pad;
    },
    nu() {
      return staat.klok();
    },
    samenvatting(uitkomst, budgetMs = null) {
      return {
        versie: 1,
        uitkomst,
        totaal_ms: rond(staat.klok() - staat.t0),
        budget_ms: budgetMs,
        afgekapt: staat.afgekapt,
        // Gesorteerd op start, zodat parallelle sporen leesbaar in volgorde staan.
        fasen: [...staat.metingen].sort((a, b) => a.start_ms - b.start_ms),
        // R1 — alleen met de vlag aan; anders ontbreekt de sleutel (byte-gelijk).
        ...(staat.tekstzoekpad ? { tekstzoekpad: staat.tekstzoekpad } : {}),
        ...(staat.hybridezoekpad ? { hybridezoekpad: staat.hybridezoekpad } : {}),
      };
    },
  };
  return meter;
}

/** `RetrievalAfgebroken` draagt zijn oorzaak soms als `cause` (gateway). */
function isAfbrekingsoorzaak(e: unknown): boolean {
  return typeof e === "object" && e !== null && isAfbrekingsfout((e as { cause?: unknown }).cause);
}

/** Een nieuwe, request-lokale meter. `klok` is injecteerbaar voor tests. */
export function maakFasemeter(klok: () => number = () => Date.now()): Fasemeter {
  return maakMeter({ t0: klok(), metingen: [], afgekapt: 0, klok }, null);
}

/** De meter die niets meet: het werk wordt ongewijzigd uitgevoerd. */
export const GEEN_FASEMETER: Fasemeter = {
  meet: (_fase, werk) => werk(),
  noteer: () => undefined,
  voorSpoor: () => GEEN_FASEMETER,
  markeerTekstzoekpad: () => undefined,
  markeerHybridezoekpad: () => undefined,
  nu: () => Date.now(),
  samenvatting: (uitkomst, budgetMs = null) => ({
    versie: 1,
    uitkomst,
    totaal_ms: 0,
    budget_ms: budgetMs,
    afgekapt: 0,
    fasen: [],
  }),
};

/**
 * #505 — de afloop van één retrieval, voor de productieregressie-check. Anders
 * dan `uitkomst` (die ook in het auditspoor staat) onderscheidt zij een beurt
 * die alleen slaagde via de time-outroute: uitkomst `ok`, maar een fase brak op
 * de statement_timeout af (57014).
 */
export type Retrievalafloop = "succes" | "db_timeout" | "deadline" | "afgebroken" | "fout";

export function afloopVan(samenvatting: FasetijdenSamenvatting): Retrievalafloop {
  if (samenvatting.uitkomst === "timeout") return "deadline";
  if (samenvatting.uitkomst === "annulering") return "afgebroken";
  if (samenvatting.uitkomst === "fout") return "fout";
  return samenvatting.fasen.some((f) => f.status === "db_timeout") ? "db_timeout" : "succes";
}

export interface LogKenmerken {
  /** Taaktype van de beurt (bv. `chat_generatie`); inhoudsvrij filter. */
  taak?: string;
  /**
   * Volgnummer van deze retrieval binnen dezelfde beurt (zelfde meter en
   * correlatie). Normaal 1; een herhaalde aanroep binnen één beurt krijgt 2, …
   * zodat een retry niet als tweede vraag wordt geteld.
   */
  volgnummer?: number;
}

/**
 * De gestructureerde serverlogregel. Precies één regel per retrieval, langs
 * élke uitgang (ok, deadline, annulering, fout) — juist bij een time-out, want
 * dan is er geen governance-log en is dit het enige spoor.
 * `terminaal: true` markeert de regel als het eindrecord van die retrieval (er
 * zijn geen tussenregels); `afloop` is het oordeel voor de releasecheck.
 * Inhoud: correlatie-id (request-id = `retrieval_meta.correlation_id`, geen
 * inhoud), fondsloos, en de samenvatting.
 */
export function logFasetijden(
  correlatieId: string,
  samenvatting: FasetijdenSamenvatting,
  kenmerken: LogKenmerken = {}
): void {
  const regel = `[retrieval][fasetijden] ${JSON.stringify({
    correlatie: correlatieId,
    terminaal: true,
    afloop: afloopVan(samenvatting),
    ...(kenmerken.taak ? { taak: kenmerken.taak } : {}),
    volgnummer: kenmerken.volgnummer ?? 1,
    ...samenvatting,
  })}`;
  if (samenvatting.uitkomst === "ok") console.info(regel);
  else console.warn(regel);
}
