// RAG pipeline: zoek relevante document chunks voor een vraag
import { neutraliseerBrontekst, maakBronSentinel } from "./bron-afbakening";
import { createServerSupabase } from "./supabase-server";
import { bouwTerugvalFtsQuery } from "./fts-terugval";
import {
  selecteerChunksMetTrace,
  selecteerMetConstraintsMetTrace,
  type RepresentatieConstraints,
} from "./rag-select";
import { embedTekst, naarVectorLiteral } from "./embeddings";
import { isPoortGesloten } from "./ai-poort";
import { handhaafScanbewijs, heeftSchoonScanbewijs, isMalwarescanAan } from "./document-scan-poort";
import { isAfbreking, bewaakNaIO } from "./retrieval/afbreken";
import {
  GEEN_FASEMETER,
  isDbTimeout,
  statusVanPostgrest,
  type Fasemeter,
  type Fasepoging,
  type Tekstzoekpad,
} from "./retrieval/fasetijden";
import { ZOEK_TEKST_V2_ENV, zoekTekstV2Actief } from "./retrieval/zoektekst-vlag";
import { notulenBronLabel } from "./notulen";
import { bouwBronfragment } from "./bronfragment";
import { statuslabelVoorBron } from "./documentstatus-label";
import type { RetrievalModus, JuridischeVraagintentieResultaat } from "./vraagtype";
import {
  weegBronsoort,
  constraintsVoorProfiel,
  type Bronsoortprofiel,
} from "./weeg-bronsoort";
import { weegRegime, type Regime } from "./weeg-regime";
import { isStandaardZichtbaarInRag } from "./generiek-curatie";
import { isReviewVerlopen } from "./generiek-status";
import type { AssistantSource, AssistantSourceSamenvatting } from "./assistant-source";
import type { Vraagroute } from "./vraagrouter";
import type { ModelrouterMeta } from "./vraagrouter-model";
import type { DocumentDekking } from "./document-dekking";
// R1.3–R1.6 retrieval-kwaliteitsbundel. Elk onderdeel draait achter een eigen
// vlag (zie RetrievalOpties) en heeft een eigen fail-safe; defaults reproduceren
// het huidige gedrag. jargon-expansie is puur; rerank/parent-context hebben een
// zuivere kern + een onzuivere schil.
import { expandeerFtsQuery } from "./jargon-expansie";
import { rerankChunks, type RerankMeta, type RerankClient } from "./rerank";
import { verrijkMetParents, type ParentMeta } from "./parent-context";
// T2-1 — verplaatst naar de orkestratielaag (besluit 0213 punt 5); tijdelijk
// teruggeïmporteerd zodat C5/C6/C7 in PR-A ongewijzigd blijven. T2-2 ruimt dit op.
import { bouwMeta as bouwMetaNeutraal, type AuditBron } from "./retrieval/meta";
import { maakCitationId, maakDocumentIdentiteit, maakPassageIdentiteit, maakVolledigeVersieHash } from "./retrieval/identiteit";
import type { BevrorenBronbinding } from "./bronset";

/** Chunk-vormige bron → de neutrale auditkijk. Eén plek, zodat het terugvalpad
 *  voor C5/C6/C7 exact hetzelfde auditspoor blijft schrijven. */
function alsAuditBron(c: DocumentChunk): AuditBron {
  return {
    ref: c.id,
    documentId: c.document_id,
    bron: c.documenten.bron,
    bibliotheek: c.documenten.bibliotheek,
    fondsId: c.documenten.fonds_id ?? null,
    documentstatus: c.documenten.documentstatus ?? null,
    bronstatus: c.documenten.bronstatus ?? null,
    documentdatum: c.documenten.documentdatum ?? null,
    documenttype: c.documenten.documenttype ?? null,
    wetsgeschiedenisSubtype: c.documenten.wetsgeschiedenis_subtype ?? null,
    dossiernummer: c.documenten.dossiernummer ?? null,
    normgewicht: c.documenten.normgewicht ?? null,
    wettelijkRegime: c.documenten.wettelijk_regime ?? null,
    score: c.rang ?? null,
    fts: c.fts_rang ?? null,
    vec: c.vec_rang ?? null,
  };
}

function bouwMeta(methode: RetrievalMeta["methode"], opgehaald: number, geselecteerd: DocumentChunk[]): RetrievalMeta {
  return bouwMetaNeutraal(methode, opgehaald, geselecteerd.map(alsAuditBron));
}
import { selecteerEnVerrijk, alsSelectieBron } from "./retrieval/selectie";
import { bouwCitaties } from "./retrieval/citatie";
import type { Bronresultaat } from "./retrieval/contract";
import { artikelFrasequery, artikelmatch, type Artikelfocus } from "./retrieval/artikelverwijzing";
import { bakenParagraafAf, kiesJuridischDocument, kiesParagraafkop, kiesTermijnpassages, type Sectiefocus, type Sectierij } from "./retrieval/juridische-sectie";
import {
  ARTIKEL_TOELATING_ID_MAX,
  TOELATING_SELECT,
  pasToelatingsfiltersToe,
  toelatingsfilters,
  voldoetAanZoekfilters,
  type ToelatingsRij,
  type Toelatingsparameters,
} from "./retrieval/artikeltoelating";
export type { SelectieAfvalReden, SelectieDiagnostiek } from "./retrieval/selectie";

// Increment G — optionele, additieve retrieval-filters (vóór ranking/RRF in de
// RPC's; defaults reproduceren huidig gedrag). De velden zijn gedenormaliseerd
// op document_chunks (increment E + C+/B13), dus filtering vereist geen join.
export interface RetrievalFilters {
  modus?: RetrievalModus; // 'actueel'|'historisch'|'besluitvorming'|'alles'
  peildatum?: string; // ISO YYYY-MM-DD; default current_date (server-side)
  bronstatus?: string[] | null;
  documentstatus?: string[] | null;
  procesinstantie_ids?: string[] | null;
  bronsoort?: string[] | null;
  // Increment G — bronsoort-WEGING (rang-boost, pure TS): herordent de
  // kandidatenset vóór de top-N-selectie zodat de primaire bronsoort vóór de
  // aanvullende komt. Geen harde uitsluiting (anders dan p_bronsoort hierboven).
  bronsoortprofiel?: Bronsoortprofiel;
  // T4 Regime-borging (Deel B) — het GELDENDE wettelijk regime van het fonds
  // (fondsen.primair_wettelijk_regime; NULL/beide/algemeen = geen demotie). Stuurt
  // de regime-demotie (lib/weeg-regime) ná de bronsoort-weging: chunks met het
  // tegengestelde regime zakken naar onderaan. GEEN harde uitsluiting (anders dan
  // p_bronsoort): een gedemoveerd regime blijft als aanvullend extern kader.
  primairRegime?: Regime;
  // Increment P1 (§8.3 #6, herzien 2026-06-26) — generieke documenten met een
  // ZWAK normgewicht (alleen 'onbekend'/NULL; 'informatief' niet meer) worden
  // NIET standaard in RAG getoond. Zet deze vlag op true wanneer de gebruiker er
  // expliciet om vraagt (dan wél meenemen). Default/afwezig = uitsluiten.
  toonZwakkeGeneriek?: boolean;
}

// §8.3 #6 — sluit generieke chunks met een zwak normgewicht ('onbekend'/NULL;
// 'informatief' valt hier niet meer onder) uit, tenzij de gebruiker er expliciet
// om vroeg (toonZwakkeGeneriek).
// Niet-generieke chunks (fondsdocumenten) blijven altijd staan. Gedeelde bron-
// van-waarheid: isStandaardZichtbaarInRag (zelfde regel als de platform-UI-label).
// ── Increment T4: expliciete fonds-discipline op het retrievalpad ───────────
// Defense-in-depth NÁÁST RLS én de RPC-fondsfilter (p_fonds_id). Dropt elke chunk
// die de fondsgrens of de published-generiek-regel schendt, en telt de droppings
// zodat een (theoretisch) lek zichtbaar wordt in retrieval_meta. Wordt op ELK
// retrievalpad toegepast — óók de PostgREST-fallback en haalDocumentChunks, die
// niet door de RPC (met p_fonds_id) lopen. Zie decisions/0045.
//
// Vereist dat het pad `documenten.fonds_id` (en voor regel 2 documentstatus/
// bronstatus) heeft geselecteerd; alle aanroepers hieronder doen dat.
/** T2-1 — één bron voor de per-document-cap, zodat de orkestratie exact
 *  dezelfde grens hanteert als de adapter intern deed. */
/** De peildatum waarmee de retrieval FEITELIJK draait. Zonder expliciet filter
 *  is dat vandaag — precies wat `zoekRelevanteChunksMetMeta` intern doet. Eén
 *  bron, zodat de parent-verrijking niet met een andere datum werkt dan de
 *  retrieval zelf: dan zou de review-vervalcontrole op generieke siblings
 *  ongemerkt uitvallen. */
/** PR-B — koppelt het afbreeksignaal aan een PostgREST-builder. Conditioneel,
 *  want `.abortSignal()` accepteert geen `undefined`. */
function metSignaal<T extends { abortSignal(s: AbortSignal): T }>(q: T, signal?: AbortSignal): T {
  return signal ? q.abortSignal(signal) : q;
}

export function effectievePeildatum(filters?: { peildatum?: string }): string {
  return filters?.peildatum ?? vandaagISO();
}

export function maxPerDocVoor(maxResults: number): number {
  return Math.max(3, Math.ceil(maxResults / 2));
}

export function isPublishedGeneriek(chunk: DocumentChunk): boolean {
  const d = chunk.documenten;
  if (d.bibliotheek !== "generiek") return true; // niet-generiek: regel n.v.t.
  const status = d.documentstatus ?? null;
  const bronstatus = d.bronstatus ?? "actief"; // NULL ≡ actief (spiegelt de RPC)
  return status === "van_kracht" && bronstatus === "actief";
}

// Increment T10 — vandaag als ISO-peildatum voor de review-verval-regel wanneer
// een aanroeper er geen expliciete meegeeft (bv. de dekkingsbrede paden).
function vandaagISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Regels:
//   1. Fondsgrens (alleen bij een gezette fondsFilter): een niet-generieke chunk
//      mag alleen mee als hij exact het eigen fonds draagt
//      (documenten.fonds_id === fondsFilter). Een afwijkend/ontbrekend fonds_id
//      op een fondschunk = cross-tenant en wordt gedropt (kan alleen als zowel RLS
//      als de RPC-filter faalden).
//   2. Published-only generiek (T13/T14): een generieke chunk mag alleen mee als
//      hij published is (van_kracht + actief). Spiegelt de RPC-gate en borgt de
//      fallbackpaden die de RPC niet raken.
//   3. Review-verval generiek (T10, besluit 0053): een generieke chunk met een
//      VERSTREKEN verplichte review (volgende_review < peildatum) telt niet meer
//      als actuele bron. Spiegelt de T10-RPC-gate; borgt de fallbackpaden. NULL
//      volgende_review = niet afgedwongen (backward-compat).
//   4. Actualiteitspariteit fonds (B-02, 2026-08-05): onder modus 'actueel' valt
//      een niet-actueel FONDSdocument (zouActueelZijn=false) hier alsnog af. De
//      RPC's + PostgREST-fallback filteren fonds-docs al in de query op de actuele-
//      bron-definitie; generiek kreeg die filter bovendien als tweede laag in deze
//      guard (regel 2+3), fonds niet. Regel 4 maakt de defense-in-depth symmetrisch.
//      Alleen actief bij modus==='actueel' → geen effect op besluitvorming/
//      historisch/alles (die tonen niet-vastgestelde stukken bewust). Non-regressief:
//      in normale werking dropt dit niets extra's (de query verwijderde ze al); het
//      bijt alleen als laag 1 zou falen (defense-in-depth).
// fondsFilter=null → regel 1 wordt overgeslagen (RLS-only, geen regressie);
// regel 2+3 blijven gelden (fonds-onafhankelijk). peildatum default = vandaag.
// modus afwezig/≠'actueel' → regel 4 slaapt (geen gedragswijziging voor callers
// die geen modus meegeven, o.a. de expliciete document-scope- en reflectiepaden).
export function handhaafFondsdiscipline(
  chunks: DocumentChunk[],
  fondsFilter: string | null,
  peildatum: string = vandaagISO(),
  modus?: RetrievalModus
): { chunks: DocumentChunk[]; gedropt: number } {
  const behouden = chunks.filter((c) => {
    const generiek = c.documenten.bibliotheek === "generiek";
    if (fondsFilter && !generiek && (c.documenten.fonds_id ?? null) !== fondsFilter) {
      return false; // regel 1 — cross-tenant
    }
    if (generiek && !isPublishedGeneriek(c)) {
      return false; // regel 2 — niet-published generiek
    }
    if (generiek && isReviewVerlopen(c.documenten.volgende_review, peildatum)) {
      return false; // regel 3 — verlopen review (T10)
    }
    if (modus === "actueel" && !generiek && !zouActueelZijn(c, peildatum)) {
      return false; // regel 4 — niet-actueel fondsdocument onder modus 'actueel' (B-02)
    }
    return true;
  });
  return { chunks: behouden, gedropt: chunks.length - behouden.length };
}

// Diagnostiek-velden voor retrieval_meta die bij ELKE retrieval-retour horen:
// de toegepaste fondsfilter, de namespace-conventie en het aantal door de guard
// gedropte chunks (>0 = signaal dat RLS+RPC iets doorlieten).
function fondsMeta(
  fondsFilter: string | null,
  gedropt: number
): Pick<RetrievalMeta, "toegepaste_fonds_filter" | "namespace_conventie" | "fondsdiscipline_gedropt"> {
  return {
    toegepaste_fonds_filter: fondsFilter,
    namespace_conventie: "bibliotheek",
    fondsdiscipline_gedropt: gedropt,
  };
}

// Past de bronsoort-weging toe (indien een profiel is gezet) en knipt dan terug
// tot de prompt-set. De weging gebeurt VÓÓR de selectie — dat behoudt de
// inkomende volgorde, dus de boost werkt door in welke chunks de top-N halen.
// §8.3 #6-uitsluiting draait als eerste, zodat zwakke generieke chunks geen
// prompt-plek bezetten die anders naar een fonds-/sterke bron was gegaan.
//
// Expliciete bewerkingsvolgorde (T1 — vastgelegd in code + comment):
//   filters → weging (bronsoort) → [gereserveerd: regime-demotie, T4]
//           → representatie-constraints → dedup → budget-afkap (maxTotal/maxPerSource)
// De weging herordent alleen; ze garandeert geen minimum-representatie. Met de
// flag REPRESENTATIE_CONSTRAINTS aan dwingt selecteerMetConstraints een gegarandeerd
// minimum per bibliotheek/bron af (dedup + budget-afkap zitten in diezelfde pass).
// Flag uit → exact het huidige selecteerChunks-gedrag (dedup + budget in één pass).
//
// T3 — naast de gekozen set geeft deze functie de selectie-diagnostiek terug:
// de actieve constraints, de kandidatenset vóór selectie en per kandidaat waarom
// hij wel/niet in het antwoord zat (weging/zwak_generiek/quotum/dedup/budget).
// De reden `weging` wordt hier bepaald met een contrafeitelijke selectie op de
// PRE-weging volgorde: een budget-drop die zónder de weging wél was geselecteerd,
// is aantoonbaar door de bronsoort-demotie afgevallen (geen overclaim).

/** Terminale reden waarom een opgehaalde kandidaat niet in het antwoord zat. */
// Bouwt het RPC-parameterblok voor de filters. Alleen gezette velden worden
// meegegeven; ontbrekende keys laten de SQL-defaults (huidig gedrag) intact.
function rpcFilterParams(filters?: RetrievalFilters): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (!filters) return p;
  if (filters.modus) p.p_modus = filters.modus;
  if (filters.peildatum) p.p_peildatum = filters.peildatum;
  if (filters.bronstatus) p.p_bronstatus = filters.bronstatus;
  if (filters.documentstatus) p.p_documentstatus = filters.documentstatus;
  if (filters.procesinstantie_ids) p.p_procesinstantie_ids = filters.procesinstantie_ids;
  if (filters.bronsoort) p.p_bronsoort = filters.bronsoort;
  return p;
}

// Diagnostiek-vorm van de toegepaste filters voor governance_log.retrieval_meta.
function metaFilters(filters?: RetrievalFilters): RetrievalMeta["filters"] {
  if (!filters) return undefined;
  return {
    modus: filters.modus ?? "alles",
    peildatum: filters.peildatum ?? new Date().toISOString().slice(0, 10),
    bronstatus: filters.bronstatus ?? null,
    documentstatus: filters.documentstatus ?? null,
    procesinstantie_ids: filters.procesinstantie_ids ?? null,
    bronsoort: filters.bronsoort ?? null,
  };
}

// Feature-flag (Fase C): hybride retrieval staat alleen aan als HYBRID_SEARCH
// expliciet "on" is. Default uit → niets verandert aan het zoekgedrag.
const HYBRID_ENABLED = process.env.HYBRID_SEARCH === "on";

// ── R1.3–R1.6 — vlaggen + na-verwerking van de kandidatenset ────────────────
// Elk onderdeel heeft een eigen vlag, uitsluitend als terugdraai-/diagnose-
// mechanisme (bisectie bij regressie). De aanroeper (chat-route) resolvet ze
// per fonds via fonds-config en geeft ze door; ontbreekt de optie, dan geldt de
// env-default. Zo blijven overige aanroepers (agendaprep) ongemoeid.
export interface RetrievalOpties {
  rerank?: boolean; // R1.3 Haiku-reranker
  /**
   * #311: de reranker loopt op het productiepad door de AI-gateway (taaktype
   * `rerank`); de route geeft gateway + servercontext mee. Ontbreekt dit én is er
   * geen testclient, dan valt de reranker terug op de RRF-volgorde.
   */
  gateway?: { gateway: import("./ai-gateway/contract").AiGateway; ctx: import("./ai-gateway/contract").GatewayContext };
  relevantieDrempel?: boolean; // R1.5 ilike-uitsluiting (b1) + scoredrempel (b2)
  jargonExpansie?: boolean; // R1.4 FTS-jargonexpansie
  parentRetrieval?: boolean; // R1.6 small-to-big
  representatieConstraints?: boolean; // T1 representatie-constraintlaag (bibliotheek/bron-minima)
  regimeWeging?: boolean; // T4 regime-demotie (weegRegime); env-default REGIME_WEGING (AAN, tenzij "off")
  drempelWaarde?: number; // R1.5 b2-drempel op de rerankscore (0–100)
  rerankClient?: RerankClient; // injectie voor hermetische tests
  /**
   * T2-1 — de adaptergrens. Met deze vlag stopt de keten NA het rangschikken
   * (rerank + drempel, beslissing D1) en slaat zij selectie, ilike-uitsluiting
   * en parent-retrieval over: dat is werk van de orkestratie (besluit 0213
   * punt 5). De teruggegeven `chunks` zijn dan KANDIDATEN, en de
   * selectie-afgeleide meta-velden (`geselecteerd`, `chunks`, `bronversie_audit`)
   * beschrijven die kandidatenset — de orkestratie bouwt ze opnieuw op de
   * werkelijke selectie. Alleen voor de Supabase-adapter; laat hem weg en je
   * krijgt het volledige, ongewijzigde gedrag.
   */
  stopNaRangschikking?: boolean;
  /**
   * PR-B — het samengestelde afbreek-/deadlinesignaal. Gaat naar ELKE RPC, naar
   * de embedding-fetch, naar de retry-backoff en naar de gateway. Zonder dit
   * loopt de keten van een geannuleerde beurt gewoon door.
   */
  signal?: AbortSignal;
  // Besluit 0139 (M-R3) — de OORSPRONKELIJKE gebruikersvraag, meegegeven wanneer
  // `vraag` een geherformuleerde zoekvraag is. Is deze gezet en wijkt hij af, dan
  // draait de hybride retrieval een EXTRA poging met de originele vraag en fuseert
  // de kandidatensets, zodat een (mogelijk verkeerde) reformulatie alleen recall
  // kan TOEVOEGEN, nooit wegnemen. Leeg/gelijk → geen extra poging (huidig gedrag).
  origineleVraag?: string;
  /**
   * #500 — request-lokale meter voor de fasetijden (inhoudsvrij). Alleen
   * observatie: zonder meter loopt de keten identiek.
   */
  fasemeter?: Fasemeter;
  /**
   * #500 — BEGRENSDE VOLSCANS. Uitsluitend gezet door de Supabase-adapter bij een
   * juridische artikelfocus (dezelfde poort als het artikelspoor). Onder RLS is
   * elke zoek-RPC een volledige scan over alle zichtbare chunks; op Productie
   * kost één aanroep met een echte JWT 6–12 s (de statement_timeout is 8 s). De
   * keten deed er tot vier na elkaar (strikt → verslapt → plain → ilike) en
   * overschreed zo het retrievalbudget van 20 s. Met deze vlag:
   *   (a) start de G-12/OR-terugvalpoging GELIJKTIJDIG met de strikte poging;
   *       de beslisregel (strikt leeg → terugval) en de parameters zijn
   *       ongewijzigd, dus de uitkomst ook — alleen de wandklok wordt max i.p.v. som;
   *   (b) start de keten na een DATABASE-time-out (57014) op een gerangschikte
   *       zoek-RPC geen nieuwe volscan (geen FTS-terugval vanaf hybride, geen
   *       plain-/ilike-vangnet). De exacte passages komen via het begrensde
   *       artikelspoor; `fallback_reason: "volscan_begrensd"` maakt dat zichtbaar.
   * Zonder de vlag (elke vraag zonder artikelfocus) is het gedrag byte-identiek.
   */
  begrensVolscans?: boolean;
  /**
   * R1 (besluit 0218) — het nieuwe tekstzoekpad: de gerangschikte FTS-pogingen
   * (strikt/terugval) roepen `zoek_chunks_begrensd` aan i.p.v. `zoek_chunks`
   * (zelfde parameterblok, zelfde retourvorm; RLS-behoudend). De aanroeper
   * (route) resolvet de fondsvlag via `retrievalVlaggenVoorFonds`; dezelfde
   * waarheidstabel (env `ZOEK_TEKST_V2` = on ÉN fondsvlag true) wordt hier
   * opnieuw toegepast (zie `retrieval/zoektekst-vlag.ts`); zonder meegegeven
   * vlag is het pad uit. Ontbreekt de functie in de database
   * (PGRST202), dan valt de keten éénmaal per retrieval terug op `zoek_chunks`
   * met een warn-logregel en de marker `fallback_pgrst202`. Standaard uit.
   */
  zoekTekstV2?: boolean;
}

/** #500 — `fallback_reason` wanneer een volscan na een DB-time-out bewust uitbleef. */
export const VOLSCAN_BEGRENSD = "volscan_begrensd";

type Afgerond<T> = { ok: true; waarde: T } | { ok: false; fout: unknown };
/** Een gestarte belofte die nooit "unhandled" kan worden; uitpakken gooit de fout alsnog. */
function vangAf<T>(p: Promise<T>): Promise<Afgerond<T>> {
  return p.then(
    (waarde) => ({ ok: true as const, waarde }),
    (fout) => ({ ok: false as const, fout })
  );
}
function pakUit<T>(r: Afgerond<T>): T {
  if (r.ok) return r.waarde;
  throw r.fout;
}

/**
 * R1 (0218) — PostgREST kent de RPC niet (`PGRST202`: functie ontbreekt in het
 * schema-cache). Dat is het enige foutgeval waarin de keten terugvalt op
 * `zoek_chunks`; elke andere fout (57014, 42501, …) wordt NIET gemaskeerd.
 */
export function isPgrst202(fout: unknown): boolean {
  return typeof fout === "object" && fout !== null && (fout as { code?: unknown }).code === "PGRST202";
}

// Conservatieve default-drempel (R1.5 b2): kandidaten met een rerankscore < 20
// gaan niet de prompt in. Bijstelbaar zonder deploy via de fonds-flag; hier de
// code-default voor aanroepers die geen waarde meegeven.
const DEFAULT_RELEVANTIE_DREMPEL = 20;

type VolledigeOpties = {
  rerank: boolean;
  relevantieDrempel: boolean;
  jargonExpansie: boolean;
  parentRetrieval: boolean;
  representatieConstraints: boolean;
  regimeWeging: boolean;
  drempelWaarde: number;
  rerankClient?: RerankClient;
  gateway?: RetrievalOpties["gateway"];
  stopNaRangschikking: boolean;
  signal?: AbortSignal;
  fasemeter: Fasemeter;
  begrensVolscans: boolean;
  zoekTekstV2: boolean;
};

/**
 * T2-1 — ÉÉN resolutie van de retrievalvlaggen, gedeeld door de adapter en de
 * orkestratie. Zonder deze gedeelde bron zou de orkestratie `regimeWeging`
 * anders kunnen afleiden dan de adapter. Sinds #369 zit ook `regimeWeging` in
 * `RetrievalVlaggen`; ontbrekende fondsconfiguratie behoudt de env-default.
 */
export function resolveerRetrievalVlaggen(o?: RetrievalOpties): VolledigeOpties {
  return volledigeOpties(o);
}

function volledigeOpties(o?: RetrievalOpties): VolledigeOpties {
  return {
    rerank: o?.rerank ?? process.env.RERANK === "on",
    relevantieDrempel: o?.relevantieDrempel ?? process.env.RELEVANTIE_DREMPEL === "on",
    jargonExpansie: o?.jargonExpansie ?? process.env.JARGON_EXPANSIE === "on",
    parentRetrieval: o?.parentRetrieval ?? process.env.PARENT_RETRIEVAL === "on",
    representatieConstraints:
      o?.representatieConstraints ?? process.env.REPRESENTATIE_CONSTRAINTS === "on",
    // T4 — default AAN (besluit: flag default aan). Gedrag-neutraal zolang de
    // facetdata leeg is (NULL ≡ algemeen → geen demotie) of het fonds geen
    // specifiek regime heeft. Zet REGIME_WEGING=off om de demotie uit te zetten.
    regimeWeging: o?.regimeWeging ?? process.env.REGIME_WEGING !== "off",
    drempelWaarde: o?.drempelWaarde ?? DEFAULT_RELEVANTIE_DREMPEL,
    rerankClient: o?.rerankClient,
    gateway: o?.gateway,
    stopNaRangschikking: o?.stopNaRangschikking ?? false,
    signal: o?.signal,
    fasemeter: o?.fasemeter ?? GEEN_FASEMETER,
    begrensVolscans: o?.begrensVolscans === true,
    // R1 — dezelfde waarheidstabel, óók voor een al geresolveerde fondsvlag:
    // alleen aan bij ZOEK_TEKST_V2=on én een meegegeven `zoekTekstV2: true`.
    zoekTekstV2: zoekTekstV2Actief(process.env[ZOEK_TEKST_V2_ENV], o?.zoekTekstV2),
  };
}

// R1.4 — bouw de FTS-query (evt. jargon-verbreed) en de bijbehorende meta. De
// vectorquery blijft ALTIJD de originele vraag; alleen de FTS-arm wordt verbreed.
function ftsQueryVoor(vraag: string, opties: VolledigeOpties): {
  ftsQuery: string;
  jargon: { van: string; naar: string }[];
} {
  if (!opties.jargonExpansie) return { ftsQuery: vraag, jargon: [] };
  const r = expandeerFtsQuery(vraag);
  return { ftsQuery: r.query, jargon: r.toegepast };
}

// R1.3 — verrijkte tekst per chunk voor de reranker: context_prefix + fragment,
// consistent met wat geëmbed/geïndexeerd wordt (spiegelt lib/chunk-ingest.verrijkTekst).
// De prefix zit niet op de RPC-return; we halen hem gebatcht op via de id's. De
// chunks zijn al RLS-geautoriseerd (kwamen via de RPC); dit is puur her-lezen.
async function haalContextPrefixes(ids: string[], signal?: AbortSignal): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;
  try {
    const supabase = await createServerSupabase();
    const { data } = await metSignaal(
      supabase.from("document_chunks").select("id, context_prefix").in("id", ids),
      signal
    );
    for (const r of (data ?? []) as { id: string; context_prefix: string | null }[]) {
      map.set(r.id, r.context_prefix ?? null);
    }
  } catch (e) {
    // Een afbreking is geen "prefix niet beschikbaar": doorgooien, anders
    // rerankt de keten ná de annulering alsnog over kale tekst.
    if (isAfbreking(e)) throw e;
    console.error("[rag] context_prefix ophalen mislukt — rerank over kale tekst:", e);
  }
  return map;
}

// WP3 — herleest per kandidaatdocument het scanbewijs (de zoek-RPC's leveren
// het niet) en laat alleen chunks van documenten met een schoon, hash-gebonden
// verdict door. Fail-closed: bij een leesfout vallen alle kandidaten af.
export async function filterOpScanbewijs(
  chunks: DocumentChunk[],
  signal?: AbortSignal
): Promise<DocumentChunk[]> {
  const ids = [...new Set(chunks.map((c) => c.document_id))];
  if (ids.length === 0) return chunks;
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await metSignaal(
      supabase.from("documenten").select("id, bestand_hash, scan_resultaat").in("id", ids),
      signal
    );
    if (error || !data) {
      console.error("[rag] scanbewijs lezen mislukt — kandidaten fail-closed geweigerd:", error);
      return [];
    }
    const schoon = new Set(
      (data as { id: string; bestand_hash: string | null; scan_resultaat: Record<string, unknown> | null }[])
        .filter((d) => heeftSchoonScanbewijs(d))
        .map((d) => d.id)
    );
    return chunks.filter((c) => schoon.has(c.document_id));
  } catch (e) {
    if (isAfbreking(e)) throw e;
    console.error("[rag] scanbewijs lezen mislukt — kandidaten fail-closed geweigerd:", e);
    return [];
  }
}

function verrijkTekst(prefix: string | null | undefined, tekst: string): string {
  return prefix ? `${prefix} ${tekst}` : tekst;
}

function scoreVerdeling(scores: number[]): { min: number; max: number; mediaan: number } {
  if (scores.length === 0) return { min: 0, max: 0, mediaan: 0 };
  const s = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const mediaan = s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  return { min: s[0], max: s[s.length - 1], mediaan };
}

// Gedeelde na-verwerking van de (na fondsdiscipline) bewaakte kandidatenset:
//   A (rerank, alleen sterke paden) → B2 (scoredrempel) → weeg+select →
//   B1 (ilike nooit citeerbaar) → D (parent-retrieval).
// Vervangt de losse weegEnSelecteer-aanroep in elk methode-blok. Geeft de
// prompt-set + de additieve meta-velden terug.
async function naVerwerking(
  bewaakteChunks: DocumentChunk[],
  methode: RetrievalMeta["methode"],
  zoekvraag: string,
  filters: RetrievalFilters | undefined,
  maxResults: number,
  maxPerDoc: number,
  fondsFilter: string | null,
  peildatum: string,
  opties: VolledigeOpties,
  rerankToegestaan: boolean
): Promise<{ chunks: DocumentChunk[]; extra: Partial<RetrievalMeta> }> {
  const extra: Partial<RetrievalMeta> = {};
  // WP3 — vóór de reranker (Haiku) en de parentverrijking: kandidaten van een
  // document zonder schoon hash-gebonden scanbewijs verlaten de database niet
  // richting een model. De centrale toelatingspoort zou ze later ook weigeren,
  // maar de rerank stuurt de tekst al eerder naar een provider.
  let kandidaten = isMalwarescanAan()
    ? await opties.fasemeter.meet("scanbewijs", () => filterOpScanbewijs(bewaakteChunks, opties.signal), {
        rijen: (c) => c.length,
      })
    : bewaakteChunks;

  // A — Haiku-reranker (alleen op de sterke paden: hybride + Dutch-FTS-ranked).
  let rerankScores: Record<string, number> | null = null;
  if (opties.rerank && rerankToegestaan && kandidaten.length >= 2) {
    const teRanken = kandidaten;
    const prefixMap = await opties.fasemeter.meet("context_prefix", () =>
      haalContextPrefixes(teRanken.map((c) => c.id), opties.signal)
    );
    const r = await opties.fasemeter.meet("rerank", () => rerankChunks(
      zoekvraag,
      teRanken,
      (c) => verrijkTekst(prefixMap.get(c.id), c.tekst),
      {
        client: opties.rerankClient,
        // PR-B — hetzelfde samengestelde signaal als de rest van de keten.
        signal: opties.signal,
        // AI-BEGRENZING (besluit 0180) + #311. Zonder geïnjecteerde testclient
        // loopt de reranker door de gateway (fondsconfiguratie → poort → audit);
        // is de poort dicht, dan valt hij terug op de RRF-volgorde in plaats van
        // een ongemeten call te doen.
        gateway: opties.gateway,
      }
    ), { rijen: (u) => u.chunks.length });
    kandidaten = r.chunks;
    extra.rerank = r.meta;
    if (r.meta.toegepast) rerankScores = r.meta.scores;
  }

  // B2 — relevantie-ondergrens op de (gekalibreerde) rerankscore. Alleen zinvol
  // als de rerank scores opleverde; bij fallback poorten we niet (geen schijn).
  // Bisectie-eigenschap: RELEVANTIE_DREMPEL aan + RERANK uit ⇒ geen rerankScores
  // ⇒ b2 slaat zichzelf over en alleen b1 (ilike-uitsluiting) draait. Zo zijn b1
  // en b2 in de praktijk apart te isoleren, ondanks de gedeelde vlag.
  if (opties.relevantieDrempel && rerankScores) {
    const voor = kandidaten.length;
    // Fail-open: een kandidaat die de reranker NIET scoorde (partiële JSON) krijgt
    // Infinity en blijft staan — bewust conservatief (niet droppen op ontbrekende
    // data, geen schijnzekerheid). pasVolgordeToe zette zulke chunks al achteraan.
    const behouden = kandidaten.filter(
      (c) => (rerankScores![c.id] ?? Infinity) >= opties.drempelWaarde
    );
    extra.drempel = {
      waarde: opties.drempelWaarde,
      scoreverdeling: scoreVerdeling(Object.values(rerankScores)),
      gedropt: voor - behouden.length,
    };
    kandidaten = behouden;
  }

  // T2-1 — DE ADAPTERGRENS. Tot hier loopt het rangschikken (rerank + drempel);
  // wat volgt is selectie, en dat is werk van de orkestratie. Met
  // `stopNaRangschikking` geeft de adapter de kandidaten terug en doet de
  // orkestratie de rest — zie core/lib/retrieval/orkestratie.ts.
  if (opties.stopNaRangschikking) return { chunks: kandidaten, extra };

  // Zonder de vlag blijft het gedrag voor C5/C6/C7 identiek: dezelfde code,
  // alleen verplaatst naar core/lib/retrieval/selectie.ts (besluit 0213 punt 5).
  // T2-1 — de selectie draait providerneutraal op SelectieBron; hier heen en
  // terug via de chunk-id, zodat C5/C6/C7 exact hetzelfde gedrag houden.
  const perId = new Map(kandidaten.map((c) => [c.id, c]));
  const sel2 = await selecteerEnVerrijk(kandidaten.map(alsSelectieBron), methode, {
    filters, maxResults, maxPerDoc,
    representatieConstraints: opties.representatieConstraints,
    regimeWeging: opties.regimeWeging,
    relevantieDrempel: opties.relevantieDrempel,
  });
  Object.assign(extra, sel2.extra);
  let geselecteerd = sel2.chunks
    .map((b) => perId.get(b.id))
    .filter((c): c is DocumentChunk => Boolean(c));

  // D — parent-retrieval hoort bij de PROVIDER (siblings uit document_chunks) en
  // is in de orkestratie een adapterhook. Op dit terugvalpad voor C5/C6/C7 blijft
  // hij hier staan, op exact dezelfde plek als vóór T2-1.
  if (opties.parentRetrieval && geselecteerd.length > 0) {
    const p = await verrijkMetParents(geselecteerd, fondsFilter, peildatum);
    geselecteerd = p.chunks;
    extra.parent = p.meta;
  }

  return { chunks: geselecteerd, extra };
}

// Pure selectie-helper opnieuw exporteren zodat bestaande imports werken.
export { selecteerChunks } from "./rag-select";

export interface DocumentChunk {
  id: string;
  document_id: string;
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
  chunk_index: number;
  /** Adapterprivate ingrediënten voor R1-versiebewijs; niet publiek gemaakt. */
  indexering_versie?: string | null;
  // Relevantie-score uit ts_rank_cd; null bij fallback-zoekpaden zonder ranking.
  rang?: number | null;
  // Besluit 0139 — RRF-arm-rangen (1-based) waaruit deze chunk kwam: fts_rang =
  // positie in de lexicale arm, vec_rang = positie in de vector-arm; null = niet
  // in die arm gevonden. Alleen de hybride RPC levert ze (overige paden laten ze
  // weg). Voedt retrieval_meta zodat bij een incident zichtbaar is uit welke arm
  // een fragment kwam en of een arm dood was.
  fts_rang?: number | null;
  vec_rang?: number | null;
  /**
   * #500 — adapterprivaat, alleen gezet door `vulAanMetArtikelkandidaten` bij een
   * vraag met een expliciet artikel: het structuurlabel van een exact passende
   * passage en of zij via het gerichte artikelspoor binnenkwam. De zoek-RPC's
   * leveren het label niet; op alle andere paden blijven beide velden weg.
   */
  structuur_label?: string | null;
  artikelspoor?: boolean;
  sectiespoor?: boolean;
  documenten: {
    titel: string;
    bron: string;
    bibliotheek: string;
    opslag_pad: string | null;
    // Increment T4 — het fonds van de bron (NULL = generiek/gedeeld). Uit de RPC-
    // return (d.fonds_id) én uit de fallback-select; voedt de expliciete fonds-
    // guard (handhaafFondsdiscipline) en de bronversie-audit in retrieval_meta.
    fonds_id?: string | null;
    // Increment G — gedenormaliseerde bronkaart-/weging-/auditvelden (optioneel;
    // de fallback-cascade levert ze niet, de RPC's wel).
    documentstatus?: string | null;
    bronstatus?: string | null;
    documentdatum?: string | null;
    geldig_vanaf?: string | null;
    geldig_tot?: string | null;
    procesinstantie_id?: string | null;
    bronorganisatie?: string | null;
    normgewicht?: string | null;
    extern_url?: string | null;
    // T4 Regime-borging — het wettelijk regime van de bron (pw/wvb/beide/algemeen;
    // NULL ≡ algemeen). Gedenormaliseerd op document_chunks (fn_chunk_denorm) en uit
    // de RPC-return; voedt de regime-demotie (weegRegime) en de prompt-labeling B6.
    // De fallback-cascade levert dit niet (undefined ≡ algemeen → geen demotie).
    wettelijk_regime?: string | null;
    // Increment T10 — verplichte reviewdatum van de (generieke) bron. Voedt de
    // review-verval-regel in handhaafFondsdiscipline (defense-in-depth náást de
    // T10-RPC-gate). Alleen de T10-RPC en de fallback-selects leveren dit.
    volgende_review?: string | null;
    // Tranche 2B — soort stuk en bestandsformaat, oorspronkelijk UITSLUITEND voor
    // de weergave. Sinds R-3 (#492) leest de centrale selectie `documenttype` +
    // `wetsgeschiedenis_subtype` als juridisch bronbeleid (retrieval/juridisch-
    // beleid.ts); geen filter- of RPC-pad leest ze. Gevuld door
    // verrijkDocumentmetadata(); zie daar waarom niet via de select.
    documenttype?: string | null;
    wetsgeschiedenis_subtype?: string | null;
    dossiernummer?: string | null;
    bestandstype?: string | null;
    /** Adapterprivate ingrediënt voor R1-versiebewijs; niet publiek gemaakt. */
    bestand_hash?: string | null;
    /** WP3 — alleen gezet door selects die de scanleespoort (handhaafScanbewijs) voeden. */
    scan_resultaat?: Record<string, unknown> | null;
  };
  // Increment D — aanwezig zodra de chunk uit een bevestigd notulensegment komt.
  // Gevuld door verrijkNotulenChunks() ná retrieval (de RPC's leveren dit niet);
  // stuurt de bronvermelding "Vastgestelde notulen [verg], agendapunt N — [titel]".
  notulen?: {
    vergadering_titel: string;
    agendapunt_volgnummer: number | null;
    agendapunt_titel: string | null;
  };
  // Increment R1.6 (parent-retrieval) — gezet zodra de treffer is uitgebreid met
  // zijn omliggende structuur-unit. maakContext levert dán deze samengevoegde
  // passage als brontekst i.p.v. de kale `tekst`; de bronvermelding/locatie blijft
  // op de treffer-chunk (citatie precies). NULL/afwezig = kale chunk (geen regressie).
  aangeleverde_passage?: string;
}

// Diagnostiek per retrieval: wat is opgehaald en wat is uiteindelijk
// geselecteerd voor de prompt. Wordt insert-only weggeschreven in
// governance_log.retrieval_meta — geen wijziging aan append-only-garanties.
/**
 * #434 T4-F — per-adapterdiagnostiek, per beurt. GESLOTEN en PLAT.
 *
 * De gesloten veldverzameling, de enums en de fail-closed validator staan in
 * `core/lib/retrieval/adaptermeta.ts`; een sanity-test houdt die lijst en dit
 * type gelijk. Inhoudsvrij: geen URL, ref, pad, bestandsnaam, identifier,
 * tokenclaim, providerfouttekst of fragment — ook niet gehasht.
 */
export interface AdapterMeta {
  naam: "supabase-rag" | "microsoft-sharepoint";
  /**
   * GESLOTEN, niet vrije tekst. De waardenlijst staat als
   * `ADAPTERMETA_METHODEN` in `retrieval/adaptermeta.ts` en een assertie daar
   * laat de typecheck falen zodra dit type en die lijst uiteenlopen. Was dit
   * `string`, dan paste elke korte tekst erin — en een korte tekst is een
   * prima drager voor een identifier of een providerfoutmelding.
   */
  methode:
    | RetrievalMeta["methode"]
    | "sharepoint_live";
  resultaat: "treffers" | "leeg" | "niet_geraadpleegd";
  // Beurtbreed — onafhankelijk van de citaatafkapping.
  netwerkpogingen: number;
  latency_ms: number;
  downloads: number;
  bytes: number;
  throttles: number;
  retries: number;
  kandidaten_voor_poort: number;
  kandidaten_na_poort: number;
  afwijzing_root: number;
  afwijzing_mapping: number;
  afwijzing_binding: number;
  afwijzing_rechten: number;
  afwijzing_versie: number;
  afwijzing_download: number;
  afwijzing_extractie: number;
  afwijzing_lokalisatie: number;
  afwijzing_grens: number;
  // Selectiegebonden — ná de contextafkapping opnieuw berekend over uitsluitend
  // de werkelijk opgenomen bronnen.
  opgenomen_passages: number;
  opgenomen_documenten: number;
}

/**
 * #434 — wat een ADAPTER aan `AdapterMeta` mag bijdragen.
 *
 * Bewust een gesloten deelverzameling en geen `Partial<AdapterMeta>`: een
 * adapter mag tellen wat hij zelf heeft gedaan (netwerk, downloads, afwijzingen),
 * maar niet zijn eigen naam, methode, resultaatcategorie of de selectiegebonden
 * velden zetten — die stelt de orkestratie vast.
 */
export type AdapterTellers = Partial<
  Pick<
    AdapterMeta,
    | "netwerkpogingen"
    | "downloads"
    | "bytes"
    | "throttles"
    | "retries"
    | "afwijzing_root"
    | "afwijzing_mapping"
    | "afwijzing_binding"
    | "afwijzing_rechten"
    | "afwijzing_versie"
    | "afwijzing_download"
    | "afwijzing_extractie"
    | "afwijzing_lokalisatie"
    | "afwijzing_grens"
  >
>;

export interface RetrievalMeta {
  /** #434 — per-adapterdiagnostiek. Alleen aanwezig als er iets te melden is. */
  adapters?: AdapterMeta[];
  /** Eén id voor adapter → poort → selectie → citatie → gateway → governance. */
  correlation_id?: string;
  /**
   * PR-C — inhoudsvrije samenvatting van de TOELATINGSPOORT: aantallen per
   * genormaliseerde categorie (`buiten_scope` / `toestemming_geweigerd` /
   * `configuratiefout` / `providerfout`) en
   * per grond. Geen referenties — dat zijn identifiers van stukken die de
   * gebruiker juist níét mocht zien. Alleen aanwezig als er iets is geweigerd.
   */
  toelating?: import("./retrieval/toelatingspoort").Toelatingssamenvatting;
  /** Inhoudsvrije uitkomst van de bevroren bronsetresolutie bij reflectie. */
  contextbron_resolutie?: BevrorenChunksResultaat["status"];
  /** #368 — inhoudsvrije audit van getypeerde niet-zoekende evidencelezingen. */
  evidence_audit?: import("./retrieval/evidence-contract").EvidenceAudit[];
  /** #368 — operationele modelcontextaudit, nadrukkelijk geen bron/evidence. */
  modelcontext_audit?: import("./retrieval/evidence-contract").ModelcontextAudit[];
  methode:
    | "hybride_rrf"
    | "fts_dutch_ranked"
    // 30-07-2026 — gerangschikte RPC met een VERSLAPTE OR-query, ingezet nadat de
    // strikte AND-keten niets opleverde. Zelfde pad en zelfde na-verwerking als
    // fts_dutch_ranked (inclusief reranker), alleen een bredere query.
    | "fts_dutch_terugval"
    | "fts_plain"
    | "ilike"
    | "geen";
  opgehaald: number;
  geselecteerd: number;
  chunks: {
    id: string;
    document_id: string;
    rang: number | null;
    // Besluit 0139 — arm-herkomst per chunk (null = niet in die arm / niet-hybride pad).
    fts_rang?: number | null;
    vec_rang?: number | null;
  }[];
  // ── Increment T4 — expliciete fonds-discipline (defense-in-depth náást RLS) ──
  // De server-side geresolveerde fondsfilter die op DIT pad is toegepast (null =
  // RLS-only, geen expliciete filter meegegeven). `namespace_conventie` legt vast
  // dat de generiek/fonds-scheiding via de kolom `bibliotheek` loopt (niet een
  // aparte fonds_id op de chunk). `fondsdiscipline_gedropt` = hoeveel chunks de
  // app-guard (handhaafFondsdiscipline) alsnog wegfilterde ná RLS+RPC; >0 is een
  // signaal dat een van de onderliggende lagen iets doorliet (zie decisions/0045).
  toegepaste_fonds_filter?: string | null;
  namespace_conventie?: "bibliotheek";
  fondsdiscipline_gedropt?: number;
  // True = de request leverde een fonds_id/namespace mee die afweek van de server-
  // side context; deze is genegeerd (T1.3). Puur signaal voor het auditspoor.
  body_fonds_id_genegeerd?: boolean;
  // Minimale bronversie-audit (§werkopdracht T4 #4): per geselecteerde bron de
  // herkomst-/versievelden, zodat achteraf herleidbaar is wélke fonds-namespace en
  // welke bron-/documentstatus in de prompt belandden. Append-only in retrieval_meta.
  bronversie_audit?: {
    document_id: string;
    bron: string;
    bibliotheek: string;
    fonds_id: string | null;
    documentstatus: string | null;
    bronstatus: string | null;
    documentdatum: string | null;
    documenttype?: string;
    wetsgeschiedenis_subtype?: string;
    dossiernummer?: string;
    normgewicht?: string;
    wettelijk_regime?: string;
    document_identiteit?: string;
    passage_identiteit?: string;
    citation_id?: string;
    versie?: {
      soort: "etag" | "ctag" | "hash" | "status-datum" | "onbekend";
      waarde: string | null;
      gecontroleerd_op: string | null;
      toestand: "sterk" | "gedegradeerd" | "onbekend";
    };
  }[];
  // Hybride retrieval (Fase C). Of de query-embedding lukte en, bij terugval op
  // FTS, waarom — zodat een stille terugval zichtbaar is in het auditspoor.
  embedding_query_success?: boolean;
  fallback_reason?: string;
  // AI-begrenzing (besluit 0180). Gezet zodra een kill switch het antwoord heeft
  // beïnvloed — vandaag alleen `mistral_gestopt`: de vector-arm lag stil en het
  // antwoord leunt uitsluitend op full-text search. Staat in het auditspoor
  // zodat achteraf verklaarbaar is waarom een antwoord smaller was dan normaal.
  ai_begrenzing?: string;
  // History-aware reformulatie (Fase B1). De vraag waarop daadwerkelijk is
  // gezocht, en of die afwijkt van de oorspronkelijke gebruikersvraag. Beide
  // optioneel zodat bestaande aanroepers ongemoeid blijven.
  zoekvraag?: string;
  gereformuleerd?: boolean;
  // Besluit 0139 (M-R3) — reproduceerbare, niet-destructieve retrieval. Per
  // hybride poging (primair + evt. augmentaties zoals de originele-vraag-poging
  // en, later, de M1-FTS-terugval) de gebruikte query en het aantal rijen;
  // `overgeslagen` = de poging werd niet gedraaid (bovengrens of embedding-fout).
  // `poging_herkomst` legt per GESELECTEERDE chunk vast wélke poging hem leverde.
  // Zo is achteraf zichtbaar of een reformulatie- of terugvalpoging het resultaat
  // bepaalde — zonder de fondsdiscipline te versoepelen (elke poging deelt de
  // fonds-/modus-/filterparameters identiek).
  retrieval_pogingen?: {
    naam: string;
    query: string;
    rijen: number | null;
    overgeslagen?: boolean;
  }[];
  poging_herkomst?: Record<string, string>;
  // Bronvermelding-validatie: aantal [Bron N]-citaties in het antwoord en
  // hoeveel daarvan niet naar een aangeleverde bron verwijzen (dangling).
  citaties?: { totaal: number; ongeldig: number };
  // Transformatie-vervolgactie (FO §13): de beurt bewerkt het VORIGE antwoord
  // (herstructureren/duiden/inkorten) i.p.v. een nieuwe documentvraag. Legt voor
  // de audit vast dat de strict-document-retrievaltak bewust is overgeslagen.
  transformatie?: boolean;
  // ADR 0028 — agendapunt-modus: de vraag is geframed door de toelichting van een
  // agendapunt. Legt voor de audit de herkomst vast als "agendapunt:<id>", zodat
  // herleidbaar is dat de toelichting (geen vastgestelde fondsbron) de context was.
  herkomst?: string;
  /** #462 PR-5 — inhoudsarme audit van automatisch gebruikte SharePoint-
   * koppelingen bij een agendapunt. Uitsluitend lokale refs en tellingen; geen
   * Graph-id, naam, pad, token, URL, prompt of documentinhoud. */
  agendapunt_sharepoint?: {
    document_refs: string[];
    map_refs: string[];
    kandidaten: number;
    gebruikte_documenten: number;
    afgekapt: boolean;
  };
  // Document-scope (increment 1/2). Aanwezig zodra een vraag tot één/enkele
  // document(en) is beperkt; legt voor de audit vast waarop gescoopt is en welke
  // retrievalstrategie is gekozen.
  scope?: {
    document_ids: string[];
    titels: string[];
    strategie: "targeted" | "full_document" | "map_reduce";
    algemene_kennis: boolean;
    // 12-08-2026 — primaire-documentmodus. `modus: "primair"` legt vast dat het
    // gekozen document het ONDERWERP was en niet de afbakening; de twee tellers
    // zeggen hoeveel de verbreding daadwerkelijk toevoegde. Zonder die getallen
    // is achteraf niet te zien of een antwoord op het gekozen stuk stond of
    // grotendeels op de rest van de bibliotheek. Optioneel: het brede pad
    // (doorgronden) zet ze niet.
    modus?: "primair";
    // Increment 2: bij dekkingsbrede strategieën — hoeveel chunks verwerkt en
    // (bij map-reduce) in hoeveel batches; afgekapt = dekking gedeeltelijk.
    verwerkte_chunks?: number;
    batches?: number;
    afgekapt?: boolean;
    /** #462 — inhoudsvrije audit van de gekozen SharePoint-context. */
    sharepoint_soort?: "document" | "map";
    kandidaten?: number;
    gebruikte_documenten?: number;
  };
  /** M1–M4 — gevalideerde, reproduceerbare routerbeslissing (geen vrije tekst). */
  vraagrouter?: Vraagroute;
  /** M4/M9 — code-gedreven routermeting; geen vrije fouttekst of vraaginhoud. */
  vraagrouter_uitvoering?: {
    router_ms: number;
    modelrouter: ModelrouterMeta;
  };
  /** M5/M9 — het gebruikte algemene analyseplan, uitsluitend gesloten ids. */
  analyseplan?: {
    kader: "algemeen_controleplan_niet_juridisch_volledig";
    criteria: {
      id: string;
      herkomst: "standaard_analyseplan" | "gebruikersvraag";
    }[];
  };
  /** M6 — code-gedreven bewijs van welke passages/batches echt zijn verwerkt. */
  documentdekking?: DocumentDekking;
  /** M7 — aanbod/uitvoering van de expliciete volledige-analysevervolgactie. */
  volledige_analyse?: {
    aangeboden: boolean;
    uitgevoerd: boolean;
    vorige_log_id?: string;
    document_id?: string;
  };
  // Besluit 0151 — AI-modulecontext. Aanwezig zodra een vraag in de context van een
  // module (procesdossier, risicomatrix of één risico) is gesteld. `procedure_id`/
  // `risico_id`/`bron_ids` zijn IDENTITEIT (audit-meta: `bron`); `blok_tekens` en
  // `validatie` zijn telemetrie/status (`basis`). Geen documenttekst.
  module_scope?: {
    soort: "proces" | "risicomatrix" | "risico";
    procedure_id?: string;
    risico_id?: string;
    validatie: "ok";
    bron_ids?: string[];
    blok_tekens?: number;
  };
  // 12-08-2026 — wat het AANVULLENDE spoor toevoegde bovenop het primaire
  // materiaal (gekozen document op /ai, gekoppelde stukken in agendapunt-modus).
  // Zonder deze twee getallen is achteraf niet te zien of een antwoord op het
  // primaire materiaal stond of grotendeels op de rest van de bibliotheek.
  // Afwezig = er draaide geen aanvullend spoor.
  aanvullend?: { chunks: number; documenten: number };
  // Besluit 0151 (criterium 11) — tijd tot eerste zichtbare token (ms), voor de
  // token-/latentiemeting per module-scope-soort.
  ttft_ms?: number;
  // Increment G — de toegepaste retrieval-filters (status/bronstatus/modus/
  // peildatum/bronsoort/procesinstantie). Append-only auditspoor (test #6).
  filters?: {
    modus: RetrievalModus;
    peildatum: string;
    bronstatus?: string[] | null;
    documentstatus?: string[] | null;
    procesinstantie_ids?: string[] | null;
    bronsoort?: string[] | null;
  };
  // Increment G — de actieve antwoordmodus (feitelijk|duiding|sparring|…) en, in
  // besluitvorming-modus, hoeveel Decision Object-besluitbronnen zijn meegenomen.
  antwoordmodus?: string;
  besluitbronnen?: number;
  // Increment I-1 (FO §11d) — auditspoor van de presentatielaag, zodat de
  // (verborgen) bronbasis en getoonde inline-meldingen volledig vastliggen ook
  // nu ze niet meer standaard zichtbaar zijn. Verandert niets aan retrieval.
  bronbasis?: string;
  inline_meldingen?: { type: string; tekst: string }[];
  // Increment I-3 — uniforme bronvermelding-transparantie. Alle herkomst van het
  // antwoord (document + model_knowledge + web) + telling per soort + de markeer-
  // handhaving. Puur auditspoor; verandert niets aan retrieval. `source_summary.
  // web_retrieval_actief` legt vast of voor dít antwoord live web-retrieval is
  // ingezet én ≥1 geverifieerde webbron opleverde (Scenario A, besluit 0072).
  sources?: AssistantSource[];
  source_summary?: AssistantSourceSamenvatting;
  // Scenario A (besluit 0072) — retrieval-provenance van de web-tak (FR-8). Bij
  // `ingezet:true`: bevraagde domeinen, gebruikte webbronnen (met normgewicht),
  // ophaaltijdstip, fallback-status en een eventuele web_search-foutcode. Bij
  // `ingezet:false`: de deterministische reden (vlag_uit/geen_whitelist/scope_actief/
  // geen_extern_signaal/pii_geblokkeerd) + bij PII de gedetecteerde soorten. Zo is
  // per antwoord herleidbaar of/waarom er wel of niet extern is gezocht.
  web?: {
    ingezet: boolean;
    reden?: string;
    pii_soorten?: string[];
    ophaaltijdstip?: string;
    bevraagde_domeinen?: string[];
    aantal_geciteerd?: number;
    aantal_gebruikt?: number;
    foutcode?: string | null;
    fallback?: boolean;
    gebruikte_bronnen?: { url: string; domein: string; normgewicht: string | null }[];
  };
  markeringen?: {
    algemene_kennis_markers: number;
    instanties: string[];
    /** True = pure algemeen-modus zonder enige algemene-kennismarker (signaal). */
    ontbrekend_signaal: boolean;
  };
  // Increment I-2 (FO §11a/§11d) — automatische bronkeuze. De door het systeem
  // bepaalde intentie + zekerheid, de daaruit afgeleide (verborgen) retrieval-
  // modus, en of de gebruiker de harde "Alleen fondsdocumenten"-restrictie aanzette.
  // Volledig herleidbaar nu de bron-as niet meer zichtbaar is; verandert niets
  // aan de retrieval-logica zelf (die blijft Increment G).
  bron_intent?: "fonds" | "algemeen" | "gecombineerd";
  bron_vertrouwen?: "zeker" | "onzeker";
  bron_modus_auto?: "documenten" | "combineren" | "algemeen";
  alleen_fondsdocumenten?: boolean;
  // True = de intentie is door de gebruiker BEVESTIGD via een verduidelijkingschip
  // ('Voor mijn fonds'/'In algemene zin'), niet heuristisch bepaald. Zonder deze
  // vlag is een bevestigde keuze in het auditspoor niet te onderscheiden van een
  // heuristisch-zekere keuze (beide bron_vertrouwen 'zeker').
  bron_intent_override?: boolean;
  // Contextbesef (besluit 0090) — of de PORTAALSTAND (eigen eerstvolgende
  // processtap, komende vergadering, agendapunten zonder eigen inbreng) als context
  // is meegestuurd. Alleen bij een persoonlijke/statusgerichte vraag; nooit bij een
  // zuiver algemene vraag. De stand komt uit query's onder RLS op de sessie (nooit
  // fondsbreed voor iets persoonlijks) — dit is het herleidbaarheidsspoor daarvan.
  portaalstand_gebruikt?: boolean;
  // Increment F (FO §14) — profielgestuurde PRIORITERING. Legt vast of het antwoord
  // op het persoonlijke profiel is geprioriteerd ('actief'), bewust collectief is
  // gehouden via 'algemeen perspectief' ('uitgeschakeld'), of de gebruiker geen
  // profiel heeft ingevuld ('geen-profiel'). Verandert niets aan retrieval: dezelfde
  // bronnen, alleen volgorde/nadruk in de presentatie. De _aspecten leggen vast
  // welke profielvelden de prioritering voedden (alleen metadata, geen inhoud).
  profielsturing?: "actief" | "uitgeschakeld" | "geen-profiel";
  profielsturing_aspecten?: {
    bestuurlijke_rol: boolean;
    primaire_expertise: boolean;
    secundaire_expertises: number;
    gremia: number;
    focusgebieden: number;
    antwoordvoorkeur: string | null;
    detailniveau: string | null;
  };
  // OP-2 (FO Organisatieprofiel v0.4 §8) — organisatiespecifiek contextprofiel.
  // Legt vast of een niet-leeg profiel is geïnjecteerd ('actief') of dat er geen
  // (bruikbaar) profiel was ('geen-profiel'). De _aspecten leggen vast wélke
  // veldgroepen zijn geïnjecteerd (alleen metadata, geen inhoud) + de peildatum.
  // Verandert niets aan retrieval: extra context, geen bron-filter.
  organisatieprofiel?: "actief" | "geen-profiel";
  organisatieprofiel_aspecten?: {
    organisatietype: boolean;
    uitvoerende_partijen: boolean;
    omvang: boolean;
    kernfeiten: boolean;
    missie: boolean;
    visie: boolean;
    strategische_speerpunten: boolean;
    risicohouding: boolean;
    peildatum: string | null;
  };
  // ── R1.3–R1.6 retrieval-kwaliteitsbundel — additief auditspoor ──────────────
  // R1.4 — toegepaste NL-jargonexpansies op de FTS-arm (leeg = geen). Puur
  // diagnostisch; de vectorquery blijft de originele vraag.
  jargon_expansie?: { van: string; naar: string }[];
  // R1.3 — Haiku-reranker: methode/model/scores per chunk_id/volgorde voor+na en,
  // bij fallback, de reden (RRF-volgorde behouden). `toegepast:false` = fallback.
  rerank?: RerankMeta;
  // R1.5 — relevantie-ondergrens op de rerankscore: drempelwaarde, scoreverdeling
  // (voor empirische bijstelling) en het aantal onder de drempel gedropte chunks.
  drempel?: {
    waarde: number;
    scoreverdeling: { min: number; max: number; mediaan: number };
    gedropt: number;
  };
  // R1.5 (b1) — de bronbasis is zwak (alleen ilike-treffers): die zijn NOOIT
  // citeerbaar en gaan niet als [Bron N] de prompt in. `mogelijk_gerelateerd`
  // legt de uitgesloten treffers vast als auditspoor (geen UI).
  zwakke_bronbasis?: boolean;
  mogelijk_gerelateerd?: { document_id: string; titel: string }[];
  // R1.6 — parent-retrieval: hoeveel treffers zijn uitgebreid met hun structuur-
  // unit, hoeveel vielen terug op de kale chunk, en het totale tekstbudget.
  parent?: ParentMeta;
  // ── T3 — selectie-diagnostiek (weeg+select-stap) ────────────────────────────
  // Maakt "opgehaald maar afgevallen" te onderscheiden van "nooit opgehaald".
  // `selectie` is operationele telemetrie (BASIS: geen identiteit): de actieve
  // intent/regime, de afgedwongen representatie-constraints en de tellingen van
  // wat is geselecteerd (per bibliotheek) resp. afgevallen (per reden). De
  // effectieve constraints worden ook bij flag-uit gelogd (alle minima 0).
  // `regime` spiegelt de retrieval-modus (ook in `filters.modus`), hier bewust
  // herhaald zodat de selectie-context in één object zelfstandig leesbaar is.
  selectie?: {
    intent: Bronsoortprofiel | null;
    regime: RetrievalModus;
    constraints: RepresentatieConstraints;
    geselecteerd_per_bibliotheek: { fonds: number; generiek: number };
    afgevallen_telling: {
      weging: number;
      zwak_generiek: number;
      quotum: number;
      dedup: number;
      budget: number;
      // R-3 (#492) — uitsluitend aanwezig als een juridisch beleid is toegepast;
      // anders blijft dit object byte-identiek aan vóór R-3.
      juridisch_gedemoveerd?: number;
      juridisch_uitgesloten?: number;
    };
    // R-3 (#492) — welk juridisch bronbeleid de selectie van DIT spoor stuurde.
    // Alleen gezet als de poort openging (anders ontbreekt de sleutel en is het
    // gedrag dat van `onbekend`). Gesloten enums en tellingen: geen vraagtekst,
    // geen documentidentiteit. Subsleutel van het bestaande basisobject
    // `selectie`, dat `meta_projectie()` als geheel doorlaat — migratievrij.
    juridisch?: {
      beleid:
        | "geldend_recht"
        | "bedoeling_totstandkoming"
        | "geldend_recht_en_wetsgeschiedenis"
        | "historische_peildatum";
      poort: "juridisch_anker" | "zwak_anker_zonder_fondscontext" | "vertrouwen_zeker";
      kandidaten: { wetgeving: number; wetsgeschiedenis: number };
      geselecteerd: { wetgeving: number; wetsgeschiedenis: number };
      gedemoveerd: number;
      uitgesloten: number;
      // #500 — alleen bij een expliciet artikel achter dezelfde poort. Tellingen
      // en een vlag; het artikelnummer zelf en de vraagtekst komen er niet in.
      artikel?: {
        verwijzingen: number;
        wet_genoemd: boolean;
        exact: number;
        geboost: number;
        geboost_geselecteerd: number;
        via_artikelspoor: number;
      };
    };
  };
  // De kandidatenset vóór selectie: per kandidaat de bron-identiteit + rang en of
  // hij is geselecteerd of (met welke reden) is afgevallen. Draagt bronidentiteit
  // (document_id/bibliotheek) → BRON-niveau, net als `chunks`/`bronversie_audit`.
  selectie_kandidaten?: {
    document_id: string;
    bibliotheek: string;
    rang: number | null;
    status: "geselecteerd" | "afgevallen";
    reden?:
      | "weging"
      | "zwak_generiek"
      | "quotum"
      | "dedup"
      | "budget"
      | "juridisch_gedemoveerd"
      | "juridisch_uitgesloten";
  }[];
  // P2 Deel B — "een document doorgronden": de parameters van de samengestelde
  // instructie volledig in het auditspoor (B6 / criterium 13). De zichtbare
  // gebruikersbeurt is korter dan de instructie die het model kreeg; zonder deze
  // parameters is achteraf niet te reconstrueren waaróm een antwoord eruitziet
  // zoals het eruitziet (gekozen secties + promptvariant). Append-only; geen
  // nieuw audit-event-type. `vorige_document_id` is gezet zodra "Afwijkingen"
  // meeging (de aantoonbaar eerdere versie is dan óók in de retrieval-scope).
  doorgrond?: {
    secties: string[];
    document_ids: string[];
    vorige_document_id: string | null;
    promptvariant: string;
  };
  // T2 — de bureau-stand ("Een stuk voorbereiden"). Zelfde motivering als
  // `doorgrond`: de zichtbare beurt is korter dan de samengestelde instructie, dus
  // zonder deze parameters is het antwoord achteraf niet reconstrueerbaar (FR-12,
  // ontwerp §6.4). Append-only, geen nieuw event-type; geclassificeerd als `bron`
  // in core/lib/audit-meta.ts (taak-/sectie-identiteit, géén documenttekst).
  // `bronbereik` is in T2 "fonds"/"generiek"; "web" volgt met deskresearch (T4).
  bureau?: {
    taak: "stukvoorbereiding";
    stuksoort: "oplegger" | "bestuursnotitie" | "memo" | "toelichting" | null;
    secties: string[];
    bronbereik: ("fonds" | "generiek" | "web")[];
    // T5 B1: false bij het bronloze concept-skelet (variant iii, geen
    // fondsdocument gekozen); true bij het bron-onderbouwde concept (variant i).
    bron_aanwezig?: boolean;
    promptvariant: string;
    rol_context: "bestuursbureau";
  };
  // P2 Deel A — markeert dat de beurt uit een aangeklikte (generieke) voorbeeldvraag
  // kwam i.p.v. zelf getypt. Telemetrie in het auditspoor; meelift op de bestaande
  // chat-logging, geen nieuwe tabel.
  startvraag_bron?: "voorbeeldvraag";
  // Ingreep 1/2 (30-07-2026) — HERKOMST van de bevestigde bron-intentie. Het
  // bestaande `bron_intent_override` is een boolean en zegt alleen DAT de intentie
  // is voorgezet, niet door wie. Nu er drie bronnen zijn (de bestuurder via een
  // chip, onze eigen startvraag-copy, of de module waaruit de assistent is geopend)
  // is dat onderscheid nodig om achteraf te kunnen verantwoorden wie de scope koos.
  // `bron_intent_herkomst` draagt bij "herkomst" de moduleslug (bv. "risicomatrix").
  bron_intent_bron?: "chip" | "startvraag" | "herkomst";
  bron_intent_herkomst?: string;
  // 30-07-2026 — schaduwtelling: hoeveel NIET-vastgestelde fondsstukken over dit
  // onderwerp zijn door de actualiteitsfilter buiten het antwoord gebleven, en of
  // de gebruiker ze daarna expliciet heeft meegenomen. Zonder dit veld is achteraf
  // niet te zien dat er stukken waren die het antwoord niet hebben gehaald.
  niet_vastgesteld?: {
    documenten: number;
    chunks: number;
    meegenomen: boolean;
  };
  // Besluit 0092 (30-07-2026) — deze logregel is een TERUGVRAAG, geen antwoord: de
  // assistent vroeg om verduidelijking (fonds of algemeen) en er is géén model
  // aangeroepen. Maakt de terugvraag herleidbaar én meetbaar (hoe vaak vraagt de
  // assistent door, en op welke vragen) zonder een tweede logmechanisme.
  verduidelijking?: boolean;
  geen_modelcall?: boolean;
  // H-12 (review 2026-07-30) — invoer-provenance. governance_log bewaart alleen
  // de laatste vraag en het antwoord; wie de historie manipuleerde (bv. een
  // gefabriceerde "assistant"-beurt om de instructieset te relativeren) was
  // achteraf niet zichtbaar. `historie_hash` legt vast wélke context tot dit
  // antwoord leidde zonder de inhoud te dupliceren; `invoer_tekens` maakt
  // kostenanalyse en misbruikdetectie per fonds mogelijk.
  invoer?: {
    beurten: number;
    tekens: number;
    historie_hash: string;
    // Plateau 1 — contextresolver-telemetrie (basis) en de door de resolver
    // voorgestelde kandidaatvraag (verwijderbare inhoud; zie audit-meta.ts
    // SUB_NIVEAUS.invoer). De effectieve zoekvraag zelf staat in `zoekvraag`.
    context?: {
      modus: "off" | "observe" | "enforce";
      relatie: "eerste_beurt" | "vervolg" | "nieuw_onderwerp" | "onduidelijk";
      vertrouwen: "hoog" | "middel" | "laag";
      historie_gebruikt: boolean;
      resolvermethode:
        | "geen_historie"
        | "overgeslagen"
        | "model"
        | "model_laag_vertrouwen"
        | "fallback";
      afgedwongen: boolean;
      model_aangeroepen: boolean;
      fallback_reden?: string;
      model?: string;
      duur_ms?: number;
      tokens_in?: number;
      tokens_out?: number;
      timeout?: boolean;
    };
    context_kandidaat_vraag?: string;
    // Plateau 1 — geen ANTWOORD-generatiecall (deterministische verduidelijkings-/
    // vergelijkingsreturn), terwijl er wél een contextresolver-providercall kan zijn
    // geweest. Onderscheiden van top-level `geen_modelcall` (= geen enkele
    // providercall). Bewust onder `invoer` zodat het migratievrij op basisniveau
    // blijft (geen wijziging aan de SQL-projecties).
    geen_generatiecall?: boolean;
    // Wetsgeschiedenis A-light R-2 (#491) — juridische vraagintentie van de
    // EFFECTIEVE vraag: gesloten enums (intentie, vertrouwen, signaalcategorieën),
    // geen vraagtekst. Observe-only: stuurt niets. Bewust onder `invoer` (basis,
    // niet genoemd in SUB_NIVEAUS.invoer) zodat het migratievrij door
    // `meta_projectie()` op beide leesniveaus zichtbaar blijft — net als
    // `geen_generatiecall`. R-3 (#492) mag hierop aansluiten.
    juridische_intentie?: JuridischeVraagintentieResultaat;
    // #500 — fasetijden van de retrievalketen (gesloten fasenamen, ms, status,
    // rijentellingen; geen tekst of identiteit). Bewust onder `invoer` (basis,
    // niet in SUB_NIVEAUS.invoer): migratievrij zichtbaar via `meta_projectie()`.
    retrieval_fasetijden?: import("./retrieval/fasetijden").FasetijdenSamenvatting;
  };
  // H-10 (review 2026-07-30) — hoeveel bronlabel-achtige patronen zijn
  // geneutraliseerd in de chunktekst vóórdat die de prompt in ging. >0 betekent
  // dat een document tekst bevatte die een extra `[Bron N]`-blok of een
  // scheidingslijn kon simuleren; structureel >0 is een injectiesignaal.
  context_geneutraliseerd?: number;
  // 30-07-2026 — de verslapte OR-terugval op de Dutch-FTS-arm is ingezet omdat de
  // strikte AND-keten nul rijen gaf. Legt vast welke termen zijn gebruikt, zodat
  // achteraf te zien is dat (en waarmee) er breder is gezocht.
  terugval?: {
    termen: string[];
    query: string;
    versie: string;
  };
  // ── P5 (03-08-2026) — operationele telemetrie ─────────────────────────────
  // Voedt signaal 3 (AI-respons-latency p95) en signaal 6 (tokenverbruik per
  // fonds) uit FO §19. Bewust in dit BESTAANDE jsonb-veld en niet in nieuwe
  // kolommen: dat scheelt een migratie op een append-only auditlogtabel, en het
  // voegt geen logregel toe — dezelfde ene insert, twee sleutels meer.
  //
  // Optioneel: gesprekken van vóór deze wijziging dragen ze niet, en de
  // terugvraagtak (verduidelijking, geen modelcall) evenmin. De signaalquery
  // slaat rijen zonder deze sleutels daarom over in plaats van ze als 0 te tellen.
  /** Duur van alléén de eindgeneratie: aanroep tot en met finalMessage(). */
  duur_ms?: number;
  /**
   * Totale MODELTIJD van de beurt: de map-reduce-lus én de eindgeneratie. Dit is
   * de bron voor signaal 3 — `duur_ms` alleen zou een trage map-reduce-beurt als
   * snel laten meetellen en de p95 omlaag trekken. Retrieval, query-reformulatie
   * en de reranker vallen hier buiten: het is modeltijd, geen doorlooptijd.
   */
  duur_model_ms?: number;
  /**
   * Tokenverbruik: eindgeneratie + map-lus, inclusief cache-tokens. Dit is een
   * ONDERGRENS — reranker, query-reformulatie, server-side web_search en de
   * AI-routes buiten de assistentchat zitten er niet in. Zie `tokendekking`.
   */
  tokens?: { in: number; out: number };
  /** Maakt expliciet wat er in `tokens` zit en wat niet, per gelogde beurt. */
  tokendekking?: {
    map_calls: number;
    bevat_reranker: boolean;
    bevat_query_reformulatie: boolean;
    bevat_web_search: boolean;
  };
  /**
   * #311 — de EFFECTIEVE provider/model/profiel/configuratieversie van de
   * eindgeneratie, zoals de AI-gateway die uit fonds + taakgroep bepaalde.
   * Auditbaar: welk profiel en welke versie stonden er toen. Geen inhoud.
   */
  gateway?: {
    provider: string;
    model: string;
    profiel_id: string;
    config_versie: number | null;
  };
}

// Platte rij zoals public.zoek_chunks(...) die teruggeeft (zie migratie
// 2026_05_30_rag_ranking.sql). Wordt naar DocumentChunk gemapt.
interface ZoekChunkRij {
  id: string;
  document_id: string;
  tekst: string;
  pagina: number | null;
  paragraaf: string | null;
  chunk_index: number;
  titel: string;
  bron: string;
  bibliotheek: string;
  opslag_pad: string | null;
  rang: number;
  // Besluit 0139 — arm-rangen uit de hybride RPC (row_number per arm; null als de
  // chunk niet in die arm zat). Alleen zoek_chunks_hybride levert deze kolommen.
  fts_rang?: number | null;
  vec_rang?: number | null;
  // Increment T4 — fonds van de bron (NULL = generiek). Alleen de T4-RPC levert dit.
  fonds_id?: string | null;
  // Increment G — denorm-velden uit de uitgebreide RPC-return.
  documentstatus?: string | null;
  bronstatus?: string | null;
  documentdatum?: string | null;
  geldig_vanaf?: string | null;
  geldig_tot?: string | null;
  procesinstantie_id?: string | null;
  bronorganisatie?: string | null;
  normgewicht?: string | null;
  extern_url?: string | null;
  // Increment T10 — reviewdatum uit de RPC-return (d.volgende_review).
  volgende_review?: string | null;
  // T4 Regime-borging — regime-facet uit de RPC-return (dc.wettelijk_regime).
  wettelijk_regime?: string | null;
}

export interface BronVerwijzing {
  /** Stabiele, providerneutrale bron+passage+versie-identiteit. */
  citation_id?: string;
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
  heeft_origineel: boolean;
  // Tranche 2B — soort stuk (elf waarden, labels in core/lib/document-metadata.ts)
  // en bestandsformaat (pdf/docx/xlsx/pptx). Beide OPTIONEEL en puur voor de
  // weergave: `documenttype` is nullable in de database en niet gebackfilld
  // (metadata-review-queue), `bestandstype` kan ontbreken als de verrijking niets
  // teruggaf. Een ontbrekende waarde mag nooit een lege chip of gebroken kaart
  // opleveren — de weergave laat het element dan simpelweg weg.
  documenttype?: string | null;
  wetsgeschiedenis_subtype?: string | null;
  dossiernummer?: string | null;
  wettelijk_regime?: string | null;
  bestandstype?: string | null;
  // Increment G — bronkaartvelden (status/bronstatus/datum/bronsoort + generiek-
  // metadata). Optioneel: de fallback-cascade levert ze niet.
  documentstatus?: string | null;
  bronstatus?: string | null;
  documentdatum?: string | null;
  geldig_tot?: string | null;
  bibliotheek?: string | null;
  bronorganisatie?: string | null;
  normgewicht?: string | null;
  extern_url?: string | null;
}

// Map een platte RPC-rij naar het DocumentChunk-shape met geneste documenten.
function rijNaarChunk(r: ZoekChunkRij): DocumentChunk {
  return {
    id: r.id,
    document_id: r.document_id,
    tekst: r.tekst,
    pagina: r.pagina,
    paragraaf: r.paragraaf,
    chunk_index: r.chunk_index,
    rang: r.rang,
    fts_rang: r.fts_rang ?? null,
    vec_rang: r.vec_rang ?? null,
    documenten: {
      titel: r.titel,
      bron: r.bron,
      bibliotheek: r.bibliotheek,
      opslag_pad: r.opslag_pad,
      fonds_id: r.fonds_id ?? null,
      documentstatus: r.documentstatus ?? null,
      bronstatus: r.bronstatus ?? null,
      documentdatum: r.documentdatum ?? null,
      geldig_vanaf: r.geldig_vanaf ?? null,
      geldig_tot: r.geldig_tot ?? null,
      procesinstantie_id: r.procesinstantie_id ?? null,
      bronorganisatie: r.bronorganisatie ?? null,
      normgewicht: r.normgewicht ?? null,
      extern_url: r.extern_url ?? null,
      volgende_review: r.volgende_review ?? null,
      wettelijk_regime: r.wettelijk_regime ?? null,
    },
  };
}


// ── Besluit 0139 (M-R3) — generiek "extra retrievalpoging"-mechanisme ────────
// Harde bovengrens op het aantal hybride RPC-aanroepen per beurt: 1 basispoging
// + maximaal 2 augmentaties (de M-R3 originele-vraag-poging en, later, de M1-
// FTS-terugval uit de recall-opdracht). Eén plek, geen losse takken: elke extra
// poging draait dezelfde RPC met IDENTIEKE fonds-/modus-/filterparameters en
// alleen een afwijkende query/embedding, en wordt hier gefuseerd.
const MAX_HYBRIDE_POGINGEN = 3;

export interface HybridePogingResultaat {
  naam: string;
  chunks: DocumentChunk[];
}

// Bouwt het GEDEELDE RPC-parameterblok dat elke hybride poging identiek gebruikt.
// Eén bron: zo kan een extra poging (M-R3/M1) de fonds-/modus-/filtergrens per
// constructie niet versoepelen — p_fonds_id en alle filters zitten hier vast.
// Alleen p_query/p_embedding worden per poging toegevoegd (zie draaiHybridePoging).
export function gedeeldeHybrideParams(
  overFetch: number,
  scope: string[] | null,
  filters: RetrievalFilters | undefined,
  fondsFilter: string | null
): Record<string, unknown> {
  return {
    p_limit: overFetch,
    p_document_ids: scope,
    ...rpcFilterParams(filters),
    p_fonds_id: fondsFilter,
  };
}

// Fuseert de kandidatensets van meerdere hybride pogingen: union op chunk-id,
// waarbij per chunk de poging met de BESTE (hoogste) RRF-rang wint. Zo kan een
// extra poging alleen recall TOEVOEGEN, nooit wegnemen. Determinisme: gesorteerd
// op rang aflopend met chunk-id als tiebreaker (app-laag-pendant van de SQL-
// tiebreaker), zodat gelijke scores nooit een niet-deterministische volgorde
// geven. Geeft ook per chunk-id terug welke poging hem leverde (auditherkomst).
export function fuseerHybridePogingen(pogingen: HybridePogingResultaat[]): {
  chunks: DocumentChunk[];
  herkomstPerId: Record<string, string>;
} {
  const besteChunk = new Map<string, DocumentChunk>();
  const besteRang = new Map<string, number>();
  const herkomstPerId: Record<string, string> = {};
  for (const { naam, chunks } of pogingen) {
    for (const c of chunks) {
      const r = c.rang ?? -Infinity;
      if (!besteChunk.has(c.id) || r > (besteRang.get(c.id) ?? -Infinity)) {
        besteChunk.set(c.id, c);
        besteRang.set(c.id, r);
        herkomstPerId[c.id] = naam;
      }
    }
  }
  const chunks = [...besteChunk.values()].sort(
    (a, b) => (b.rang ?? -Infinity) - (a.rang ?? -Infinity) || a.id.localeCompare(b.id)
  );
  return { chunks, herkomstPerId };
}

// Hoofdingang: kiest tussen hybride retrieval (Fase C, achter de flag) en de
// bestaande FTS-route. Hybride embedt de vraag, roept de RRF-RPC aan en valt
// veilig terug op FTS als de embedding of de RPC faalt. De terugval wordt in de
// meta vastgelegd (embedding_query_success / fallback_reason) zodat een stille
// terugval zichtbaar is in het auditspoor. Tenant-isolatie loopt overal via RLS.
/**
 * Eén hybride RPC-poging, gebonden aan het GEDEELDE parameterblok. Levert de
 * gerangschikte chunks, of `null` bij een RPC-fout (≠ leeg resultaat, dat is een
 * lege array). SECURITY INVOKER → RLS blijft gelden; `p_document_ids` scoopt
 * vóór de fusie.
 *
 * Elke poging die deze functie maakt deelt EXACT hetzelfde parameterblok; alleen
 * `p_query` en `p_embedding` verschillen per aanroep. Zo kan geen extra poging —
 * ook de verslapte van G-12 niet — scope, filters of fondsgrens verruimen.
 */
export function maakHybrideRpc(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => any },
  gedeeldeParams: Record<string, unknown>,
  signal?: AbortSignal,
  /** #500 — fasetijden per poging, en een melding van de foutvorm (nooit de tekst). */
  meting?: { meter?: Fasemeter; bijFout?: (fout: unknown) => void }
): (ftsQuery: string, embedding: number[], poging?: Fasepoging) => Promise<DocumentChunk[] | null> {
  const meter = meting?.meter ?? GEEN_FASEMETER;
  return async (ftsQuery, embedding, poging) => {
    const { data, error } = await meter.meet(
      "rpc_hybride",
      () =>
        metSignaal(
          supabase.rpc("zoek_chunks_hybride", {
            p_query: ftsQuery,
            p_embedding: naarVectorLiteral(embedding),
            ...gedeeldeParams,
          }),
          signal
        ) as Promise<{ data: unknown; error: unknown }>,
      {
        ...(poging ? { poging } : {}),
        rijen: (u) => (Array.isArray(u.data) ? u.data.length : undefined),
        status: (u) => statusVanPostgrest(u, signal),
      }
    );
    if (error) meting?.bijFout?.(error);
    // PostgREST GOOIT een abort niet door — hij levert een gewoon
    // foutresultaat. Het SIGNAAL is dus gezaghebbend, niet de vorm van de fout.
    bewaakNaIO(signal, error);
    if (error) {
      console.error("Hybride RPC-fout:", error);
      return null;
    }
    return Array.isArray(data) ? (data as ZoekChunkRij[]).map(rijNaarChunk) : [];
  };
}

// ── R1 (besluit 0218) — de gerangschikte tekstzoek-RPC ─────────────────────
/**
 * Eén bron voor de RPC-KEUZE van de gerangschikte FTS-pogingen (strikt én
 * terugval): `zoek_chunks_begrensd` met de vlag aan, anders `zoek_chunks`.
 * Beide krijgen EXACT hetzelfde parameterblok (`gedeeldeParams` + `p_query`);
 * alleen de functienaam verschilt — de twee namen staan hier letterlijk,
 * zodat de census en de afbreektest (`supabase.rpc("zoek_chunks…")` via
 * `metSignaal`) ze blijven zien.
 *
 * PGRST202-terugval. Ontbreekt `zoek_chunks_begrensd` in de database (migratie
 * niet toegepast, of de vlag te vroeg aan), dan antwoordt PostgREST met
 * `PGRST202`. Dan — en alleen dan — valt deze retrieval ÉÉNMAAL terug op
 * `zoek_chunks`: een request-lokale grendel zorgt dat elke verdere poging in
 * dezelfde retrieval (ook de speculatief gestarte terugval) direct de oude
 * functie neemt, met precies één warn-regel. Elke andere fout (57014, 42501,
 * netwerk) wordt NIET gemaskeerd. `pad()` levert de auditmarker: `nieuw`,
 * `fallback_pgrst202`, of `undefined` met de vlag uit (dan verandert er niets
 * aan de meta — byte-gelijk aan vóór R1).
 */
export function maakTekstRpc(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => any },
  gedeeldeParams: Record<string, unknown>,
  opties: { zoekTekstV2: boolean; signal?: AbortSignal; waarschuw?: (melding: string) => void }
): { draai: (p_query: string) => Promise<{ data: unknown; error: unknown }>; pad: () => Tekstzoekpad | undefined } {
  const waarschuw = opties.waarschuw ?? ((m: string) => console.warn(m));
  let tekstzoekpad: Tekstzoekpad | undefined = opties.zoekTekstV2 ? "nieuw" : undefined;
  const params = (p_query: string): Record<string, unknown> => ({ p_query, ...gedeeldeParams });
  return {
    async draai(p_query) {
      if (tekstzoekpad === "nieuw") {
        const nieuw = (await Promise.resolve(
          metSignaal(supabase.rpc("zoek_chunks_begrensd", params(p_query)), opties.signal)
        )) as { data: unknown; error: unknown };
        if (!isPgrst202(nieuw.error)) return nieuw;
        // Gelijktijdige pogingen kunnen hier beide binnenkomen; de grendel en
        // de warn-regel kantelen maar één keer.
        if (tekstzoekpad === "nieuw") {
          tekstzoekpad = "fallback_pgrst202";
          waarschuw(
            "[retrieval][tekstzoekpad] zoek_chunks_begrensd ontbreekt (PGRST202): migratie 2026_10_03_r1 niet toegepast of vlag ZOEK_TEKST_V2 te vroeg aan; eenmalige terugval op zoek_chunks voor deze retrieval"
          );
        }
      }
      return Promise.resolve(metSignaal(supabase.rpc("zoek_chunks", params(p_query)), opties.signal));
    },
    pad: () => tekstzoekpad,
  };
}

// ── #500 — Gericht artikelspoor (Supabase) ──────────────────────────────────
// WAAR DE PASSAGE WEGVIEL. De exact gelabelde artikelsgewijze toelichting
// (MvT Wtp p. 395, "Artikelsgewijze toelichting — Artikel 150d") kwam niet in
// de KANDIDATENSET van `zoek_chunks_hybride`: de strikte FTS-arm eist alle
// inhoudswoorden van de vraag in één chunk ('bedoel' & 'wetgever' & 'artikel'
// & '150d' & 'pensioenwet'; de artikelpassage bevat 'bedoel'/'wetgever' niet),
// en de vectorarm (top-`p_kandidaten` = 40 over alle chunks, 2.738 uit
// hetzelfde document) is niet gevoelig voor een artikelnummer. Daarna kapt
// `p_limit` (= kandidatenpool, 30) de fusie af. Een boost in de selectie kan
// een kandidaat die nooit binnenkwam niet redden — dus dit spoor.
//
// ONTWERP (geen migratie, geen RPC-wijziging, geen policywijziging):
//   1. Opzoeking, begrensd. Eerst (onder RLS) de JURIDISCHE documenten:
//      `documenten` met documenttype wetgeving/wetsgeschiedenis, `actief`,
//      binnen de documentscope — een handvol rijen. Daarna alleen BINNEN die
//      `document_id=in.(…)` de passages waarvan het structuurlabel of de
//      tekstbegin EXACT het artikel noemt (regex met woordgrens, zie
//      `artikelOpzoekfilter`). Zo loopt de opzoeking via `idx_chunks_document`
//      in plaats van over alle chunks. Het pure predicaat `artikelmatch`
//      controleert daarna nog eens.
//   2. TOELATING van nieuwe passages zonder zoek-RPC: een id-begrensde
//      opvraging onder RLS (`document_chunks?id=in.(…)`, ≤
//      `ARTIKEL_TOELATING_ID_MAX`) met EXPLICIET dezelfde semantiek als
//      `zoek_chunks` + `rpcFilterParams` + `p_fonds_id` + documentscope en
//      dezelfde frasevoorwaarde. Filters en predicaat staan puur en getest in
//      `retrieval/artikeltoelating.ts`; de pariteit met `zoek_chunks` bewijst
//      `supabase/checks/2026_09_29_500_artikelspoor.sql` onder echte RLS.
//      HOTFIX PRODUCTIETIME-OUT (#500): de eerdere toelating via
//      `zoek_chunks(p_limit => 200, p_document_ids => …)` eindigde op
//      Productie in 57014 (8 s): in het concrete plan werd het GIN-pad niet
//      gekozen (RLS-policy + functievorm + niet-leakproof `@@`), dus een seq
//      scan over alle chunks. Daarna nog de app-guard
//      `handhaafFondsdiscipline`. Normgewicht en regime worden daarna, net als
//      voor elke kandidaat, centraal in de selectie gewogen.
//   3. Samenvoegen binnen `maxKandidaten`: nieuwe exacte passages vervangen de
//      zwakste niet-exacte kandidaten aan de staart, zodat de orkestratie ze
//      niet weer afkapt. Bestaande kandidaten die exact passen krijgen hun
//      label mee, zodat de centrale selectie ze kan boosten.
// Fail-open: faalt de opzoeking of de toelating, dan blijft de kandidatenset
// ongewijzigd (een afbreking gaat wél door). Rerank en drempel zijn al gedaan;
// een exacte structuurtreffer omzeilt die bewust — het artikelnummer in de
// vraag is sterker bewijs dan een relevantiescore. Een toegelaten passage
// draagt daarom geen relevantiescore (`rang` = null).
// Grenzen: hooguit `ARTIKEL_JURIDISCHE_DOCUMENTEN_MAX` juridische documenten,
// `ARTIKEL_OPZOEK_MAX` aanwijzingen en evenveel toelatingsrijen.
export const ARTIKEL_OPZOEK_MAX = ARTIKEL_TOELATING_ID_MAX;
export const ARTIKEL_JURIDISCHE_DOCUMENTEN_MAX = 200;
const JURIDISCHE_DOCUMENTTYPEN = ["wetgeving", "wetsgeschiedenis"] as const;

interface ArtikelAanwijzingRij {
  id: string;
  document_id: string;
  tekst: string;
  structuur_label: string | null;
}

/**
 * PostgREST-`or` op het label of de tekstbegin, EXACT in de database: `imatch`
 * (POSIX `~*`) met een woordgrens vóór "artikel" en ná het nummer. Een
 * prefix-`ilike` ("artikel 15*") zou ook 150, 150a–z, 151–159 en 1500 treffen;
 * omdat alle chunks van één structuur-unit hetzelfde label dragen, konden dan
 * tientallen niet-exacte chunks de exacte passage uit de `limit` drukken vóórdat
 * `artikelmatch()` filtert (reviewpunt PR #501). `artikelmatch()` blijft de
 * tweede grens. Nummers zijn al beperkt tot [0-9a-z]; de patronen staan tussen
 * aanhalingstekens vanwege `(`, `)`, `|` en `,`, en bevatten bewust geen
 * backslash (`[.]` in plaats van `\.`) zodat PostgREST niets hoeft te ontsnappen.
 */
export function artikelOpzoekfilter(focus: Pick<Artikelfocus, "artikelen">): string {
  return focus.artikelen
    .flatMap((n) => [
      `structuur_label.imatch."(^|[^a-z])artikel +${n}([^0-9a-z]|$)"`,
      `tekst.imatch."^(artikel|art[.]?) +${n}([^0-9a-z]|$)"`,
    ])
    .join(",");
}

/** Een toelatingsrij → het DocumentChunk-shape (zoals `rijNaarChunk`, zonder rang). */
function toelatingsrijNaarChunk(r: ToelatingsRij): DocumentChunk {
  const d = r.documenten!;
  return {
    id: r.id,
    document_id: r.document_id,
    tekst: r.tekst,
    pagina: r.pagina,
    paragraaf: r.paragraaf,
    chunk_index: r.chunk_index,
    rang: null,
    fts_rang: null,
    vec_rang: null,
    documenten: {
      titel: d.titel,
      bron: d.bron,
      bibliotheek: d.bibliotheek,
      opslag_pad: d.opslag_pad,
      fonds_id: d.fonds_id ?? null,
      documentstatus: r.documentstatus ?? null,
      bronstatus: r.bronstatus ?? null,
      documentdatum: r.documentdatum ?? null,
      geldig_vanaf: r.geldig_vanaf ?? null,
      geldig_tot: r.geldig_tot ?? null,
      procesinstantie_id: r.procesinstantie_id ?? null,
      bronorganisatie: r.bronorganisatie ?? null,
      normgewicht: r.normgewicht ?? null,
      extern_url: r.extern_url ?? null,
      volgende_review: d.volgende_review ?? null,
      wettelijk_regime: r.wettelijk_regime ?? null,
    },
  };
}

export async function vulAanMetArtikelkandidaten(
  bestaand: DocumentChunk[],
  opdracht: {
    focus: Artikelfocus;
    fondsId: string | null;
    scope?: string[] | null;
    filters?: RetrievalFilters;
    maxKandidaten: number;
    signal?: AbortSignal;
    supabase?: { from: (tabel: string) => any };
    /** #500 — fasetijden (inhoudsvrij) van de drie begrensde queries. */
    fasemeter?: Fasemeter;
  }
): Promise<DocumentChunk[]> {
  const fondsFilter = opdracht.fondsId && opdracht.fondsId.length > 0 ? opdracht.fondsId : null;
  const meter = opdracht.fasemeter ?? GEEN_FASEMETER;
  const telRijen = (u: { data?: unknown }) => (Array.isArray(u.data) ? u.data.length : undefined);
  const statusVan = (u: { error?: unknown }) => statusVanPostgrest(u, opdracht.signal);
  const scope = opdracht.scope && opdracht.scope.length > 0 ? opdracht.scope : null;
  try {
    const supabase = opdracht.supabase ?? (await createServerSupabase());

    // 1a. De juridische documenten (onder RLS, klein).
    let dq = supabase
      .from("documenten")
      .select("id, bestand_hash, scan_resultaat")
      .in("documenttype", [...JURIDISCHE_DOCUMENTTYPEN])
      .eq("actief", true);
    if (scope) dq = dq.in("id", scope);
    dq = dq.order("id", { ascending: true }).limit(ARTIKEL_JURIDISCHE_DOCUMENTEN_MAX);
    const { data: docs, error: docFout } = await meter.meet(
      "artikel_documenten",
      () => metSignaal(dq, opdracht.signal) as Promise<{ data: unknown; error: unknown }>,
      { rijen: telRijen, status: statusVan }
    );
    bewaakNaIO(opdracht.signal, docFout);
    if (docFout || !Array.isArray(docs)) {
      if (docFout) console.error("[rag] artikelspoor: documentopzoeking mislukt — kandidaten ongewijzigd:", docFout);
      return bestaand;
    }
    // WP3 — een juridisch document zonder schoon scanbewijs levert geen
    // artikelkandidaten (de toelatingspoort zou ze weigeren, en een onbekende
    // versie zou de parentverrijking vóór die poort laten struikelen).
    const wp3 = isMalwarescanAan();
    const juridisch = (docs as { id: string; bestand_hash?: string | null; scan_resultaat?: Record<string, unknown> | null }[])
      .filter((d) => !wp3 || heeftSchoonScanbewijs({
        bestand_hash: d.bestand_hash ?? null,
        scan_resultaat: d.scan_resultaat ?? null,
      }))
      .map((d) => d.id);
    if (juridisch.length === 0) return bestaand;

    // 1b. De exacte passages, alleen binnen die documenten.
    const q = supabase
      .from("document_chunks")
      .select("id, document_id, tekst, structuur_label")
      .in("document_id", juridisch)
      .or(artikelOpzoekfilter(opdracht.focus))
      .order("document_id", { ascending: true })
      .order("chunk_index", { ascending: true })
      .limit(ARTIKEL_OPZOEK_MAX);
    const { data, error } = await meter.meet(
      "artikel_opzoeking",
      () => metSignaal(q, opdracht.signal) as Promise<{ data: unknown; error: unknown }>,
      { rijen: telRijen, status: statusVan }
    );
    bewaakNaIO(opdracht.signal, error);
    if (error || !Array.isArray(data)) {
      if (error) console.error("[rag] artikelspoor: opzoeking mislukt — kandidaten ongewijzigd:", error);
      return bestaand;
    }
    const exact = new Map<string, ArtikelAanwijzingRij>();
    for (const r of data as ArtikelAanwijzingRij[]) {
      if (artikelmatch(opdracht.focus, { structuurLabel: r.structuur_label, tekst: r.tekst })) exact.set(r.id, r);
    }
    if (exact.size === 0) return bestaand;

    for (const c of bestaand) {
      const r = exact.get(c.id);
      if (r) c.structuur_label = r.structuur_label;
    }
    const bekend = new Set(bestaand.map((c) => c.id));
    const nieuw = [...exact.values()].filter((r) => !bekend.has(r.id));
    if (nieuw.length === 0) return bestaand;

    // 2. Toelating: id-begrensd, onder RLS, met de zoek_chunks-semantiek.
    const parameters: Toelatingsparameters = {
      ids: nieuw.slice(0, ARTIKEL_TOELATING_ID_MAX).map((r) => r.id),
      frase: artikelFrasequery(opdracht.focus),
      documentscope: scope,
      filters: opdracht.filters,
      fondsId: fondsFilter,
      peildatum: effectievePeildatum(opdracht.filters),
    };
    const tq = pasToelatingsfiltersToe(
      supabase.from("document_chunks").select(TOELATING_SELECT),
      toelatingsfilters(parameters)
    )
      .order("document_id", { ascending: true })
      .order("chunk_index", { ascending: true })
      .limit(ARTIKEL_TOELATING_ID_MAX);
    const { data: rijen, error: toelatingsFout } = await meter.meet(
      "artikel_toelating",
      () => metSignaal(tq, opdracht.signal) as Promise<{ data: unknown; error: unknown }>,
      { rijen: telRijen, status: statusVan }
    );
    bewaakNaIO(opdracht.signal, toelatingsFout);
    if (toelatingsFout || !Array.isArray(rijen)) {
      if (toelatingsFout) console.error("[rag] artikelspoor: toelating mislukt — kandidaten ongewijzigd:", toelatingsFout);
      return bestaand;
    }
    const nieuwPerId = new Map(nieuw.map((r) => [r.id, r]));
    const toegelaten = (rijen as ToelatingsRij[])
      .filter((r) => r.documenten && nieuwPerId.has(r.id) && voldoetAanZoekfilters(r, parameters))
      .map(toelatingsrijNaarChunk);
    const bewaakt = handhaafFondsdiscipline(
      toegelaten,
      fondsFilter,
      parameters.peildatum,
      opdracht.filters?.modus
    ).chunks;
    if (bewaakt.length === 0) return bestaand;
    for (const c of bewaakt) {
      c.structuur_label = nieuwPerId.get(c.id)?.structuur_label ?? null;
      c.artikelspoor = true;
    }

    // Binnen de kandidatenpool blijven: de zwakste NIET-exacte kandidaten
    // (van achteren) maken plaats. Exacte kandidaten worden nooit verdrongen.
    const toegevoegd = bewaakt.slice(0, Math.max(opdracht.maxKandidaten, 0));
    let teVeel = bestaand.length + toegevoegd.length - opdracht.maxKandidaten;
    const behouden = [...bestaand];
    for (let i = behouden.length - 1; i >= 0 && teVeel > 0; i--) {
      if (!exact.has(behouden[i].id)) {
        behouden.splice(i, 1);
        teVeel--;
      }
    }
    return [...behouden, ...toegevoegd];
  } catch (e) {
    if (isAfbreking(e)) throw e;
    bewaakNaIO(opdracht.signal, e);
    console.error("[rag] artikelspoor mislukt — kandidaten ongewijzigd:", e);
    return bestaand;
  }
}

/** Gerichte wetsparagraaf binnen dezelfde RLS- en toelatingspoort als #500. */
export async function vulAanMetSectiekandidaten(
  bestaand: DocumentChunk[],
  opdracht: {
    focus: Sectiefocus;
    fondsId: string | null;
    scope?: string[] | null;
    filters?: RetrievalFilters;
    maxKandidaten: number;
    signal?: AbortSignal;
    supabase?: { from: (tabel: string) => any };
  }
): Promise<DocumentChunk[]> {
  const scope = opdracht.scope?.length ? opdracht.scope : null;
  const fondsFilter = opdracht.fondsId || null;
  try {
    const supabase = opdracht.supabase ?? (await createServerSupabase());
    // De gewone zoekslag heeft het relevante juridische document al als
    // kandidaat aangewezen. Begrens de tekstzoeking tot deze document-id's;
    // een brede ILIKE over alle wetschunks zou onder RLS te duur zijn.
    const kandidaatDocs = [...new Set(bestaand.map((c) => c.document_id))].slice(0, 30);
    if (kandidaatDocs.length === 0) return bestaand;
    let dq = supabase.from("documenten")
      .select("id,titel,bestand_hash,scan_resultaat")
      .eq("documenttype", "wetgeving").eq("actief", true)
      .in("id", kandidaatDocs);
    if (scope) dq = dq.in("id", scope);
    const { data: docs, error: docFout } = await metSignaal(
      dq.order("id", { ascending: true }).limit(ARTIKEL_JURIDISCHE_DOCUMENTEN_MAX),
      opdracht.signal
    );
    bewaakNaIO(opdracht.signal, docFout);
    if (docFout || !Array.isArray(docs)) return bestaand;
    const juridischeDocs = (docs as { id: string; titel: string; bestand_hash: string | null; scan_resultaat: Record<string, unknown> | null }[])
      .filter((d) => !isMalwarescanAan() || heeftSchoonScanbewijs(d));
    const explicietDocument = opdracht.focus.nummer && /\bBesluit\b/i.test(opdracht.focus.vraag)
      ? kiesJuridischDocument(opdracht.focus.vraag, juridischeDocs.map((d) => ({ ...d, extern_url: null })))
      : null;
    const ids = explicietDocument ? [explicietDocument.id] : juridischeDocs.map((d) => d.id);
    if (ids.length === 0) return bestaand;

    let hq = supabase.from("document_chunks")
      .select("id,document_id,chunk_index,tekst,structuur_label")
      .in("document_id", ids);
    hq = opdracht.focus.nummer
      ? hq.ilike("tekst", `%Paragraaf ${opdracht.focus.nummer}.%`)
      : hq.ilike("tekst", "%Paragraaf%");
    const { data: kopRijen, error: kopFout } = await metSignaal(
      hq.order("document_id", { ascending: true }).order("chunk_index", { ascending: true }).limit(200),
      opdracht.signal
    );
    bewaakNaIO(opdracht.signal, kopFout);
    if (kopFout || !Array.isArray(kopRijen)) return bestaand;
    const kop = kiesParagraafkop(opdracht.focus, kopRijen as Sectierij[]);
    if (!kop) return bestaand;

    const { data: sectieRijen, error: sectieFout } = await metSignaal(
      supabase.from("document_chunks")
        .select("id,document_id,chunk_index,tekst,structuur_label")
        .eq("document_id", kop.rij.document_id)
        .gte("chunk_index", kop.rij.chunk_index)
        .lte("chunk_index", kop.rij.chunk_index + 80)
        .order("chunk_index", { ascending: true }).limit(81),
      opdracht.signal
    );
    bewaakNaIO(opdracht.signal, sectieFout);
    if (sectieFout || !Array.isArray(sectieRijen)) return bestaand;
    const sectie = bakenParagraafAf(kop, sectieRijen as Sectierij[]);
    if (sectie.rijen.length < 2 || !["ok", "extractiegaten"].includes(sectie.reden)) return bestaand;
    const passages = /\btermijn|hoe lang|binnen hoeveel/i.test(opdracht.focus.vraag)
      ? kiesTermijnpassages(sectie, 10)
      : sectie.rijen.slice(1, 11);
    if (passages.length === 0) return bestaand;
    const parameters: Toelatingsparameters = {
      ids: passages.map((r) => r.id).slice(0, ARTIKEL_TOELATING_ID_MAX),
      frase: null,
      documentscope: scope,
      filters: opdracht.filters,
      fondsId: fondsFilter,
      peildatum: effectievePeildatum(opdracht.filters),
    };
    const { data: rijen, error: toelatingsFout } = await metSignaal(
      pasToelatingsfiltersToe(
        supabase.from("document_chunks").select(TOELATING_SELECT),
        toelatingsfilters(parameters)
      ).order("chunk_index", { ascending: true }).limit(ARTIKEL_TOELATING_ID_MAX),
      opdracht.signal
    );
    bewaakNaIO(opdracht.signal, toelatingsFout);
    if (toelatingsFout || !Array.isArray(rijen)) return bestaand;
    const perId = new Map(passages.map((r) => [r.id, r]));
    const toegelaten = (rijen as ToelatingsRij[])
      .filter((r) => r.documenten && perId.has(r.id) && voldoetAanZoekfilters(r, parameters))
      .map(toelatingsrijNaarChunk);
    const bewaakt = handhaafFondsdiscipline(toegelaten, fondsFilter, parameters.peildatum, opdracht.filters?.modus).chunks;
    if (bewaakt.length === 0) return bestaand;
    for (const c of bewaakt) {
      c.structuur_label = perId.get(c.id)?.structuur_label ?? null;
      c.sectiespoor = true;
    }
    const volgorde = new Map(passages.map((r, i) => [r.id, i]));
    bewaakt.sort((a, b) => (volgorde.get(a.id) ?? 999) - (volgorde.get(b.id) ?? 999));
    const gekozen = bewaakt.slice(0, Math.min(10, opdracht.maxKandidaten));
    const gekozenIds = new Set(gekozen.map((c) => c.id));
    return [...gekozen, ...bestaand.filter((c) => !gekozenIds.has(c.id))]
      .slice(0, opdracht.maxKandidaten);
  } catch (e) {
    if (isAfbreking(e)) throw e;
    bewaakNaIO(opdracht.signal, e);
    console.error("[rag] sectiespoor mislukt — kandidaten ongewijzigd:", e);
    return bestaand;
  }
}

export interface HybrideDeps {
  /** Eén hybride RPC-poging; `null` bij een RPC-fout. `poging` is alleen telemetrie. */
  draai(ftsQuery: string, embedding: number[], poging?: Fasepoging): Promise<DocumentChunk[] | null>;
  /** Embedding van de originele vraag (M-R3). */
  embed(tekst: string): Promise<number[]>;
  /** De STRIKTE FTS-query voor een tekst (eventueel jargon-verbreed). */
  ftsQueryVoor(tekst: string): string;
  signal?: AbortSignal;
  /**
   * #500 — start de (eventuele) G-12-verslapte poging GELIJKTIJDIG met de
   * primaire, in plaats van erna. De beslisregel en de parameters veranderen
   * niet: de uitkomst wordt alleen gebruikt als `moetHybrideVerslappen` dat
   * zegt, precies zoals sequentieel. Alleen bij `begrensVolscans`.
   */
  speculatieveVerslapping?: boolean;
  /** #500 — telemetrie: een speculatief gestarte poging bleef ongebruikt. */
  bijOngebruikt?: (poging: Fasepoging) => void;
}

export type HybrideUitkomst =
  | { soort: "rpc_fout" }
  | {
      soort: "pogingen";
      pogingen: HybridePogingResultaat[];
      pogingMeta: NonNullable<RetrievalMeta["retrieval_pogingen"]>;
    };

/**
 * G-12 — mag er een verslapte hybride poging bij? Alleen als de strikte
 * pogingen SAMEN wél kandidaten opleverden, maar in geen enkele daarvan de
 * FTS-arm iets bijdroeg (`fts_rang` overal leeg). Dan is de fusie in feite
 * alleen vector — de strikte AND-keten van `websearch_to_tsquery` vond niets.
 *
 *   • geen kandidaten      → nee: de bestaande FTS-terugval neemt het over;
 *   • ergens een fts-rang  → nee: precisie heeft gewerkt, niet verslappen;
 *   • kandidaten, geen fts → ja: één verslapte poging.
 *
 * Gemeten over ALLE strikte pogingen samen, niet per poging. Anders valt een lege
 * primaire poging naast een originele met alleen vectorresultaten tussen wal en
 * schip: de primaire geeft niets om te beoordelen, de originele wordt nooit
 * bekeken. Gemeten ná de fonds-, scope- en statusfilters (die past de RPC al in
 * SQL toe) en vóór rerank en selectie — beslissing D2.
 */
export function moetHybrideVerslappen(strikt: readonly (readonly DocumentChunk[])[]): boolean {
  const alle = strikt.flat();
  if (alle.length === 0) return false;
  return !alle.some((c) => c.fts_rang !== null && c.fts_rang !== undefined);
}

/**
 * De strikte hybride pogingen en — G-12 — hooguit één verslapte.
 *
 * `rpc_fout` alleen als de PRIMAIRE poging faalt: dan valt de aanroeper terug op
 * FTS. Een lege uitkomst is geen fout; die komt als `pogingen` terug en de
 * aanroeper beslist na de fusie over de terugval.
 */
export async function voerHybridePogingenUit(
  vraag: string,
  primaireQuery: string,
  vector: number[],
  origineleVraag: string | undefined,
  deps: HybrideDeps
): Promise<HybrideUitkomst> {
  const pogingen: HybridePogingResultaat[] = [];
  const pogingMeta: NonNullable<RetrievalMeta["retrieval_pogingen"]> = [];

  // #500 — speculatief: de verslapte poging loopt vanaf hier mee met de strikte.
  // Hij gebruikt dezelfde primaire vector en hetzelfde parameterblok als
  // sequentieel; of zijn uitkomst telt, beslist verderop ongewijzigd G-12.
  const speculatieveTerugval = deps.speculatieveVerslapping ? bouwTerugvalFtsQuery(vraag) : null;
  const speculatief = speculatieveTerugval
    ? vangAf(deps.draai(speculatieveTerugval.query, vector, "verslapt"))
    : null;
  let speculatiefGebruikt = false;
  const laatSpeculatiefVallen = () => {
    if (speculatief && !speculatiefGebruikt) deps.bijOngebruikt?.("verslapt");
  };

  // Poging 1 (primair): de (mogelijk geherformuleerde) vraag.
  const primair = await deps.draai(primaireQuery, vector, "primair");
  if (primair === null) {
    laatSpeculatiefVallen();
    return { soort: "rpc_fout" };
  }
  pogingen.push({ naam: "primair", chunks: primair });
  pogingMeta.push({ naam: "primair", query: primaireQuery, rijen: primair.length });

  // Poging 2 (M-R3): bij een geherformuleerde vraag draaien we OOK de originele
  // vraag en fuseren, zodat de reformulatie alleen recall kan toevoegen. Faalt de
  // embedding van de originele vraag, dan blijft de primaire poging staan
  // (non-destructief).
  const origineel = origineleVraag?.trim();
  if (origineel && origineel !== vraag.trim()) {
    if (pogingen.length < MAX_HYBRIDE_POGINGEN) {
      const origFts = deps.ftsQueryVoor(origineel);
      try {
        const origVec = await deps.embed(origineel);
        const origChunks = await deps.draai(origFts, origVec, "origineel");
        if (origChunks === null) {
          pogingMeta.push({ naam: "origineel", query: origFts, rijen: null });
        } else {
          pogingen.push({ naam: "origineel", chunks: origChunks });
          pogingMeta.push({ naam: "origineel", query: origFts, rijen: origChunks.length });
        }
      } catch (e) {
        if (isAfbreking(e)) throw e;
        console.error("Hybride: embedding originele vraag mislukt (M-R3), primair blijft:", e);
        pogingMeta.push({ naam: "origineel", query: origFts, rijen: null, overgeslagen: true });
      }
    } else {
      pogingMeta.push({ naam: "origineel", query: origineel, rijen: null, overgeslagen: true });
    }
  }

  // Poging 3 (G-12): de verslapte OR-keten, op de PRIMAIRE vector — geen extra
  // embedding. Dezelfde query die het FTS-pad als poging 1b gebruikt
  // (`bouwTerugvalFtsQuery`), en via `deps.draai` hetzelfde parameterblok als de
  // strikte pogingen: alleen `p_query` verschilt. Bij één zoekterm is de
  // verslapte query gelijk aan de strikte; dan levert hij niets toe en draait hij
  // niet — en komt er ook géén meta-regel bij.
  if (moetHybrideVerslappen(pogingen.map((p) => p.chunks)) && pogingen.length < MAX_HYBRIDE_POGINGEN) {
    const terugval = bouwTerugvalFtsQuery(vraag);
    if (terugval) {
      // Een extra RPC valt binnen de beurtdeadline; start hem niet als die al
      // verstreken is.
      bewaakNaIO(deps.signal);
      // #500 — al speculatief gestart? Dan is dit exact dezelfde aanroep
      // (zelfde query uit dezelfde pure functie, zelfde vector en parameters).
      speculatiefGebruikt = speculatief !== null;
      const verslapt = speculatief
        ? pakUit(await speculatief)
        : await deps.draai(terugval.query, vector, "verslapt");
      if (verslapt === null) {
        // Non-destructief: de strikte uitkomst blijft staan.
        pogingMeta.push({ naam: "verslapt", query: terugval.query, rijen: null });
      } else {
        pogingen.push({ naam: "verslapt", chunks: verslapt });
        pogingMeta.push({ naam: "verslapt", query: terugval.query, rijen: verslapt.length });
      }
    }
  }
  laatSpeculatiefVallen();

  return { soort: "pogingen", pogingen, pogingMeta };
}

export async function zoekRelevanteChunksMetMeta(
  vraag: string,
  fondsId: string,
  maxResults = 8,
  hybrideAan?: boolean,
  documentIds?: string[],
  filters?: RetrievalFilters,
  opties?: RetrievalOpties
): Promise<{ chunks: DocumentChunk[]; meta: RetrievalMeta }> {
  // Documentscope (increment 1): null = hele bibliotheek. Wordt vóór ranking in
  // de RPC's toegepast. Onafhankelijk van de (mogelijk geherformuleerde) vraag,
  // zodat reformulatie de scope nooit kan wijzigen.
  const scope = documentIds && documentIds.length > 0 ? documentIds : null;

  // Increment T4 — de expliciete fondsfilter. De aanroeper geeft de server-side
  // geresolveerde fonds_id door (uit profiel via RLS; body wordt genegeerd). Leeg/
  // afwezig → null = RLS-only (geen expliciete filter). Deze waarde gaat als
  // p_fonds_id naar de RPC én voedt de app-guard (handhaafFondsdiscipline).
  const fondsFilter = fondsId && fondsId.length > 0 ? fondsId : null;

  // R1.3–R1.6 — vlaggen resolven (env-default als de aanroeper niets meegeeft).
  const opt = volledigeOpties(opties);
  const peildatum = effectievePeildatum(filters);

  // Per-aanroep instelling (uit het portaal) is leidend; valt terug op de
  // env-default HYBRID_SEARCH als er geen waarde is meegegeven.
  const hybride = hybrideAan ?? HYBRID_ENABLED;
  if (!hybride) {
    return zoekViaFTS(vraag, maxResults, scope, filters, fondsFilter, opt);
  }

  const supabase = await createServerSupabase();
  const overFetch = Math.max(maxResults * 3, 20);
  const maxPerDoc = maxPerDocVoor(maxResults);

  // Embed de (al door B1 geherformuleerde) vraag. Faalt dat → FTS-fallback.
  //
  // AI-BEGRENZING (besluit 0180). Staat de Mistral-kill-switch uit, dan gooit de
  // poort hier. Het routecontract is dan bewust GEEN foutmelding maar een
  // functionele terugval op full-text search — de assistent blijft antwoorden,
  // alleen zonder vector-arm. Dat mag uitsluitend omdat het ZICHTBAAR gebeurt:
  // `ai_begrenzing` landt in retrieval_meta en de weergave meldt dat de
  // semantische zoekarm uit staat. Stil degraderen zou een zwakker antwoord als
  // normaal presenteren, en dat is precies wat het huisprincipe "maak vereisten
  // en blokkers expliciet" verbiedt.
  let vector: number[];
  try {
    vector = await opt.fasemeter.meet("embedding", () => embedTekst({ supabase, label: "rag.hybride" }, vraag, opt.signal), {
      poging: "primair",
    });
  } catch (e) {
    // PR-B — een AFBREKING is geen providerfout. De terugval hieronder bestaat
    // voor een dichte kill-switch of een falende provider; vangt hij ook een
    // annulering of deadline, dan doet de keten ná het afbreken alsnog een
    // volledige FTS-retrieval. Doorgooien dus.
    bewaakNaIO(opt.signal, e);
    const gestopt = isPoortGesloten(e);
    if (gestopt) {
      console.warn(`Hybride: Mistral-poort dicht (${e.reden}) — terugval op FTS.`);
    } else {
      console.error("Hybride: query-embedding mislukt, terugval op FTS:", e);
    }
    const r = await zoekViaFTS(vraag, maxResults, scope, filters, fondsFilter, opt);
    return {
      chunks: r.chunks,
      meta: {
        ...r.meta,
        embedding_query_success: false,
        fallback_reason: gestopt ? "mistral_gestopt" : "embedding_error",
        ...(gestopt ? { ai_begrenzing: "mistral_gestopt" } : {}),
      },
    };
  }

  // R1.4 — FTS-arm (evt.) jargon-verbreed; de vectorquery blijft de originele vraag.
  const { ftsQuery, jargon } = ftsQueryVoor(vraag, opt);

  // Gedeelde RPC-parameters — IDENTIEK voor ELKE poging (één bron, zie
  // gedeeldeHybrideParams). Increment T4/T10 + Increment G: p_fonds_id, de modus-/
  // peildatum- en overige filters gaan in beide armen vóór de fusion mee; een extra
  // poging (M-R3/M1) kan de fondsgrens of modusfilter per constructie niet
  // versoepelen. Alleen p_query/p_embedding verschillen (zie draaiHybridePoging).
  const gedeeldeRpcParams = gedeeldeHybrideParams(overFetch, scope, filters, fondsFilter);

  // De strikte pogingen (primair, en bij reformulatie de originele vraag) en —
  // G-12 — hooguit één verslapte. Uitgebreid in `voerHybridePogingenUit`, zodat
  // de beslisregels hermetisch te toetsen zijn; hier alleen de bedrading.
  // #500 — kreeg een hybride poging een DATABASE-time-out (57014)? Alleen de
  // foutvorm, nooit de tekst; stuurt uitsluitend onder `begrensVolscans`.
  let hybrideDbTimeout = false;
  const uitkomst = await voerHybridePogingenUit(vraag, ftsQuery, vector, opties?.origineleVraag, {
    draai: maakHybrideRpc(supabase, gedeeldeRpcParams, opt.signal, {
      meter: opt.fasemeter,
      bijFout: (fout) => {
        if (isDbTimeout(fout)) hybrideDbTimeout = true;
      },
    }),
    embed: (tekst) =>
      opt.fasemeter.meet("embedding", () => embedTekst({ supabase, label: "rag.hybride.origineel" }, tekst, opt.signal), {
        poging: "origineel",
      }),
    ftsQueryVoor: (tekst) => ftsQueryVoor(tekst, opt).ftsQuery,
    signal: opt.signal,
    ...(opt.begrensVolscans
      ? {
          speculatieveVerslapping: true,
          bijOngebruikt: (poging: Fasepoging) => opt.fasemeter.noteer("rpc_hybride", "ongebruikt", { poging }),
        }
      : {}),
  });
  // #500 — begrensde volscans: na een DB-time-out geen nieuwe volscan via de
  // FTS-terugval (die doet er tot vier). Het artikelspoor levert de exacte
  // passages; de lege uitkomst draagt zichtbaar `volscan_begrensd`.
  const begrensNaDbTimeout = (pogingMeta?: RetrievalMeta["retrieval_pogingen"]) => {
    opt.fasemeter.noteer("rpc_fts", "overgeslagen");
    return {
      chunks: [] as DocumentChunk[],
      meta: {
        ...bouwMeta("geen", 0, []),
        filters: metaFilters(filters),
        ...fondsMeta(fondsFilter, 0),
        embedding_query_success: true,
        fallback_reason: VOLSCAN_BEGRENSD,
        ...(pogingMeta ? { retrieval_pogingen: pogingMeta } : {}),
      },
    };
  };
  if (uitkomst.soort === "rpc_fout") {
    // Vóór de terugval: is er intussen afgebroken, dan start hij niet.
    bewaakNaIO(opt.signal);
    if (opt.begrensVolscans && hybrideDbTimeout) return begrensNaDbTimeout();
    // RPC faalde → terugval op FTS (embedding lukte wél). GEEN verslapte hybride
    // poging: de RPC zelf is stuk, een tweede aanroep ervan helpt niet.
    const r = await zoekViaFTS(vraag, maxResults, scope, filters, fondsFilter, opt);
    return {
      chunks: r.chunks,
      meta: { ...r.meta, embedding_query_success: true, fallback_reason: "rpc_error" },
    };
  }
  const { pogingen, pogingMeta } = uitkomst;

  // Fusie van alle pogingen (union op id, beste RRF-rang wint, deterministisch).
  const { chunks: gefuseerd, herkomstPerId } = fuseerHybridePogingen(pogingen);

  if (gefuseerd.length === 0) {
    bewaakNaIO(opt.signal);
    if (opt.begrensVolscans && hybrideDbTimeout) return begrensNaDbTimeout(pogingMeta);
    // Geen enkele poging leverde treffers → terugval op FTS (embedding lukte wél).
    const r = await zoekViaFTS(vraag, maxResults, scope, filters, fondsFilter, opt);
    return {
      chunks: r.chunks,
      meta: {
        ...r.meta,
        embedding_query_success: true,
        fallback_reason: "geen_hybride_treffers",
        retrieval_pogingen: pogingMeta,
      },
    };
  }

  // T4 — app-guard náást de RPC: dropt (theoretische) cross-tenant/niet-published
  // lekken en telt ze, zodat een falen van RLS+RPC zichtbaar wordt in de meta.
  // Draait over de GEFUSEERDE set, dus ook over de originele-vraag-poging.
  const bewaakt = handhaafFondsdiscipline(gefuseerd, fondsFilter, peildatum, filters?.modus);
  // R1.3 (rerank op dit sterke pad) → R1.5 (drempel/ilike) → weeg → R1.6 (parent).
  const na = await naVerwerking(
    bewaakt.chunks, "hybride_rrf", vraag, filters, maxResults, maxPerDoc,
    fondsFilter, peildatum, opt, true
  );
  return {
    chunks: na.chunks,
    meta: {
      ...bouwMeta("hybride_rrf", bewaakt.chunks.length, na.chunks),
      embedding_query_success: true,
      filters: metaFilters(filters),
      ...fondsMeta(fondsFilter, bewaakt.gedropt),
      ...(jargon.length ? { jargon_expansie: jargon } : {}),
      retrieval_pogingen: pogingMeta,
      // Herkomst per GESELECTEERDE chunk: welke poging leverde hem (audit).
      poging_herkomst: Object.fromEntries(
        na.chunks.map((c) => [c.id, herkomstPerId[c.id] ?? "primair"])
      ),
      ...na.extra,
    },
  };
}

export interface FtsDeps {
  /** Eén gerangschikte `zoek_chunks`-aanroep; `poging` is alleen telemetrie. */
  draai(pQuery: string, poging: "strikt" | "terugval"): Promise<{ data: unknown; error: unknown }>;
  signal?: AbortSignal;
  /** #500 — zie `RetrievalOpties.begrensVolscans`. */
  begrensVolscans?: boolean;
  /** #500 — telemetrie: de speculatief gestarte terugval bleef ongebruikt. */
  bijOngebruikt?: () => void;
}

export type FtsPogingUitkomst =
  | { soort: "strikt"; rijen: ZoekChunkRij[] }
  | { soort: "terugval"; rijen: ZoekChunkRij[]; terugval: NonNullable<ReturnType<typeof bouwTerugvalFtsQuery>> }
  /** #500 — DB-time-out op een gerangschikte poging onder `begrensVolscans`: geen vangnet. */
  | { soort: "begrensd" }
  /** Door naar het ongerangschikte vangnet (plain → ilike), ongewijzigd. */
  | { soort: "vangnet" };

/**
 * De twee GERANGSCHIKTE FTS-pogingen: strikt (AND-keten), en alleen als die
 * niets oplevert de verslapte OR-keten (30-07-2026). Uitgebreid in een eigen
 * functie zodat de beslisregels hermetisch te toetsen zijn.
 *
 * #500 — met `begrensVolscans` start de terugval GELIJKTIJDIG met de strikte
 * poging (dezelfde pure query, hetzelfde parameterblok). De beslisregel is
 * ongewijzigd — strikt met rijen wint, anders de terugval — dus de uitkomst ook;
 * alleen de wandklok wordt max(strikt, terugval) in plaats van de som. Brak de
 * database een van beide af (57014) en leverde geen van beide rijen, dan volgt
 * `begrensd` in plaats van het vangnet.
 */
export async function voerFtsPogingenUit(
  vraag: string,
  ftsQuery: string,
  deps: FtsDeps
): Promise<FtsPogingUitkomst> {
  // De verslapte query is een pure functie van de vraag; vooraf bepalen
  // verandert niets aan wanneer of hoe hij wordt gebruikt.
  const terugval = bouwTerugvalFtsQuery(vraag);
  const speculatief = deps.begrensVolscans && terugval ? vangAf(deps.draai(terugval.query, "terugval")) : null;

  const { data, error } = await deps.draai(ftsQuery, "strikt");
  bewaakNaIO(deps.signal, error);
  if (!error && Array.isArray(data) && data.length > 0) {
    if (speculatief) deps.bijOngebruikt?.();
    return { soort: "strikt", rijen: data as ZoekChunkRij[] };
  }

  let dbTimeout = isDbTimeout(error);
  if (terugval) {
    const { data: dataT, error: errorT } = speculatief
      ? pakUit(await speculatief)
      : await deps.draai(terugval.query, "terugval");
    bewaakNaIO(deps.signal, errorT);
    if (!errorT && Array.isArray(dataT) && dataT.length > 0) {
      return { soort: "terugval", rijen: dataT as ZoekChunkRij[], terugval };
    }
    if (isDbTimeout(errorT)) dbTimeout = true;
  }
  return deps.begrensVolscans && dbTimeout ? { soort: "begrensd" } : { soort: "vangnet" };
}

// Bestaande FTS-route mét retrieval-diagnostiek (fundament en fallback).
//
// Strategie:
//   1. RPC zoek_chunks — Dutch FTS met relevantie-sortering (ts_rank_cd),
//      over-fetch (~3× of min. 20) zodat de selectie iets te kiezen heeft.
//   2. Fallback: FTS zonder Dutch-config (niet-Nederlandse documenten).
//   3. Laatste redmiddel: ILIKE op het langste trefwoord.
// Tenant-isolatie loopt overal via RLS (de RPC is SECURITY INVOKER).
async function zoekViaFTS(
  vraag: string,
  maxResults = 8,
  scope: string[] | null = null,
  filters?: RetrievalFilters,
  // Increment T4 — expliciete fondsfilter (server-side geresolveerd). Voedt zowel
  // p_fonds_id op de RPC als de app-guard op ELK fallbackpad (die de RPC niet raakt).
  fondsFilter: string | null = null,
  // R1.3–R1.6 — na-verwerkingsvlaggen (env-default als afwezig).
  opties?: RetrievalOpties
): Promise<{ chunks: DocumentChunk[]; meta: RetrievalMeta }> {
  const supabase = await createServerSupabase();
  const overFetch = Math.max(maxResults * 3, 20);
  const maxPerDoc = maxPerDocVoor(maxResults);
  const fMeta = metaFilters(filters);
  const opt = volledigeOpties(opties);
  const peildatum = effectievePeildatum(filters);

  // Poging 1: gerangschikte RPC (Dutch FTS + ts_rank_cd).
  // p_document_ids = scope vóór ranking (null = hele bibliotheek).
  // Increment G — retrieval-filters vóór ranking in de RPC.
  // Increment T4 — p_fonds_id dwingt de fondsgrens al in de RPC af.
  // R1.4 — de FTS-query is hier (evt.) jargon-verbreed (websearch-arm).
  const { ftsQuery, jargon } = ftsQueryVoor(vraag, opt);
  // #500 — één bron voor beide gerangschikte FTS-pogingen: hetzelfde
  // parameterblok, alleen `p_query` verschilt. De meter is pure telemetrie.
  // R1 (0218) — hetzelfde parameterblok gaat naar `zoek_chunks_begrensd`
  // (vlag aan) of `zoek_chunks` (vlag uit); de RPC-naam is de enige keuze.
  const tekstRpc = maakTekstRpc(
    supabase,
    { p_limit: overFetch, p_document_ids: scope, ...rpcFilterParams(filters), p_fonds_id: fondsFilter },
    { zoekTekstV2: opt.zoekTekstV2, signal: opt.signal }
  );
  const rangschikFts = (p_query: string, poging: "strikt" | "terugval") =>
    opt.fasemeter.meet(
      "rpc_fts",
      () => tekstRpc.draai(p_query),
      {
        poging,
        rijen: (u) => (Array.isArray(u.data) ? u.data.length : undefined),
        status: (u) => statusVanPostgrest(u, opt.signal),
      }
    );
  const fts = await voerFtsPogingenUit(vraag, ftsQuery, {
    draai: rangschikFts,
    signal: opt.signal,
    begrensVolscans: opt.begrensVolscans,
    bijOngebruikt: () => opt.fasemeter.noteer("rpc_fts", "ongebruikt", { poging: "terugval" }),
  });
  // R1 — auditmarker (alleen met de vlag aan): `retrieval_fasetijden.tekstzoekpad`
  // in retrieval_meta.invoer én in de [retrieval][fasetijden]-logregel.
  const tekstzoekpad = tekstRpc.pad();
  if (tekstzoekpad) opt.fasemeter.markeerTekstzoekpad(tekstzoekpad);

  if (fts.soort === "strikt") {
    const gerangschikt = fts.rijen.map(rijNaarChunk);
    const bewaakt = handhaafFondsdiscipline(gerangschikt, fondsFilter, peildatum, filters?.modus);
    // R1.3 rerank (sterk pad) → R1.5 drempel → weeg → R1.6 parent.
    const na = await naVerwerking(
      bewaakt.chunks, "fts_dutch_ranked", vraag, filters, maxResults, maxPerDoc,
      fondsFilter, peildatum, opt, true
    );
    return {
      chunks: na.chunks,
      meta: {
        ...bouwMeta("fts_dutch_ranked", bewaakt.chunks.length, na.chunks),
        filters: fMeta,
        ...fondsMeta(fondsFilter, bewaakt.gedropt),
        ...(jargon.length ? { jargon_expansie: jargon } : {}),
        ...na.extra,
      },
    };
  }

  // ── Poging 1b: verslapte OR-query op DEZELFDE gerangschikte RPC (30-07-2026) ──
  // `websearch_to_tsquery('dutch', …)` maakt van een vraagzin een AND-keten. Een
  // natuurlijke vraag ("documenten met beleggingsbeleid ken je?") eist dan dat één
  // chunk álle inhoudswoorden bevat, wat zelden lukt. Zonder deze stap viel de
  // retrieval door naar het ilike-vangnet: géén ranking, géén reranker, treffers
  // die niet citeerbaar zijn. Op productie-logdata stond bij precies deze vragen
  // `methode: "ilike"`. Eén extra RPC-aanroep met de inhoudswoorden als OR-keten
  // houdt de vraag op het gerangschikte pad — inclusief ts_rank_cd, bronsoort-
  // weging, reranker (R1.3) en relevantie-ondergrens (R1.5).
  // De strikte query blijft poging 1: precisie waar precisie werkt, recall alleen
  // waar streng zoeken niets oplevert. (Uitgevoerd in `voerFtsPogingenUit`.)
  if (fts.soort === "terugval") {
    const { terugval } = fts;
    const gerangschikt = fts.rijen.map(rijNaarChunk);
    const bewaakt = handhaafFondsdiscipline(gerangschikt, fondsFilter, peildatum, filters?.modus);
    // Rerank is hier JUIST gewenst: de OR-keten verbreedt de kandidatenset, en de
    // reranker is precies het instrument dat daar de precisie in terugbrengt.
    // De rerank draait op de ORIGINELE vraag, niet op de verslapte query — we
    // willen weten of een chunk de vráág beantwoordt.
    const na = await naVerwerking(
      bewaakt.chunks, "fts_dutch_terugval", vraag, filters, maxResults, maxPerDoc,
      fondsFilter, peildatum, opt, true
    );
    return {
      chunks: na.chunks,
      meta: {
        ...bouwMeta("fts_dutch_terugval", bewaakt.chunks.length, na.chunks),
        filters: fMeta,
        ...fondsMeta(fondsFilter, bewaakt.gedropt),
        ...(jargon.length ? { jargon_expansie: jargon } : {}),
        terugval: {
          termen: terugval.termen,
          query: terugval.query,
          versie: terugval.versie,
        },
        ...na.extra,
      },
    };
  }

  // #500 — begrensde volscans: brak de database een gerangschikte poging af
  // (57014), dan zijn de ongerangschikte vangnetten hieronder óók volscans onder
  // dezelfde RLS-kosten. Niet starten; het artikelspoor levert de exacte passages.
  if (fts.soort === "begrensd") {
    opt.fasemeter.noteer("fts_plain", "overgeslagen");
    opt.fasemeter.noteer("fts_ilike", "overgeslagen");
    return {
      chunks: [],
      meta: {
        ...bouwMeta("geen", 0, []),
        filters: fMeta,
        ...fondsMeta(fondsFilter, 0),
        fallback_reason: VOLSCAN_BEGRENSD,
      },
    };
  }

  // Fallback-cascade (ongerangschikt) — vangnet als de RPC niets oplevert.
  const zoekterm = vraag
    .replace(/[?!.,;:()'"/\\]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .join(" ");

  // Increment T4 — óók de fallback-selects leveren nu fonds_id + document-/bronstatus
  // (uit de documenten-join; `documentstatus:status` = PostgREST-alias naar de
  // documenten-kolom `status`), zodat handhaafFondsdiscipline op dit RLS-only pad
  // de fondsgrens én de published-generiek-regel kan afdwingen.
  const selectQuery = `
    id,
    document_id,
    tekst,
    pagina,
    paragraaf,
    chunk_index,
    documenten!inner(titel, bron, bibliotheek, opslag_pad, normgewicht, fonds_id, documentstatus:status, bronstatus, volgende_review)
  `;

  if (zoekterm.length > 0) {
    // Poging 2: FTS zonder Dutch-config. Scope ook hier toepassen, anders zou
    // het vangnet buiten het gescopete document kunnen lekken.
    let q2 = supabase
      .from("document_chunks")
      .select(selectQuery)
      .eq("documenten.actief", true)
      .textSearch("zoek_vector", zoekterm, { type: "plain" })
      .limit(overFetch);
    if (scope) q2 = q2.in("document_id", scope);
    // Increment G — filters ook op het vangnet (geen lek langs de modusfilter).
    if (filters?.modus === "actueel") {
      const peil = filters.peildatum ?? new Date().toISOString().slice(0, 10);
      q2 = q2
        .in("documentstatus", ["vastgesteld", "van_kracht"])
        .or("bronstatus.is.null,bronstatus.eq.actief")
        .or(`geldig_vanaf.is.null,geldig_vanaf.lte.${peil}`)
        .or(`geldig_tot.is.null,geldig_tot.gte.${peil}`);
    }
    if (filters?.bronstatus) q2 = q2.in("bronstatus", filters.bronstatus);
    if (filters?.documentstatus) q2 = q2.in("documentstatus", filters.documentstatus);
    if (filters?.procesinstantie_ids) q2 = q2.in("procesinstantie_id", filters.procesinstantie_ids);
    if (filters?.bronsoort) q2 = q2.in("bibliotheek", filters.bronsoort);
    const { data: data2, error: error2 } = await opt.fasemeter.meet(
      "fts_plain",
      () => Promise.resolve(metSignaal(q2, opt.signal)),
      { rijen: (u) => (Array.isArray(u.data) ? u.data.length : undefined), status: (u) => statusVanPostgrest(u, opt.signal) }
    );
    bewaakNaIO(opt.signal, error2);

    if (!error2 && data2 && data2.length > 0) {
      const gevonden = data2 as unknown as DocumentChunk[];
      const bewaakt = handhaafFondsdiscipline(gevonden, fondsFilter, peildatum, filters?.modus);
      // Geen rerank op dit vangnet (plainto=AND, zwakke kandidaten); wél R1.5/R1.6.
      const na = await naVerwerking(
        bewaakt.chunks, "fts_plain", vraag, filters, maxResults, maxPerDoc,
        fondsFilter, peildatum, opt, false
      );
      return {
        chunks: na.chunks,
        meta: {
          ...bouwMeta("fts_plain", bewaakt.chunks.length, na.chunks),
          filters: fMeta,
          ...fondsMeta(fondsFilter, bewaakt.gedropt),
          ...na.extra,
        },
      };
    }
  }

  // Poging 3: ILIKE op het langste trefwoord.
  const trefwoorden = zoekterm.split(" ").filter((w) => w.length > 3);
  if (trefwoorden.length > 0) {
    const hoofdwoord = trefwoorden.sort((a, b) => b.length - a.length)[0];
    let q3 = supabase
      .from("document_chunks")
      .select(selectQuery)
      .eq("documenten.actief", true)
      .ilike("tekst", `%${hoofdwoord}%`)
      .limit(overFetch);
    if (scope) q3 = q3.in("document_id", scope);
    // Increment G — zelfde filters op het laatste vangnet.
    if (filters?.modus === "actueel") {
      const peil = filters.peildatum ?? new Date().toISOString().slice(0, 10);
      q3 = q3
        .in("documentstatus", ["vastgesteld", "van_kracht"])
        .or("bronstatus.is.null,bronstatus.eq.actief")
        .or(`geldig_vanaf.is.null,geldig_vanaf.lte.${peil}`)
        .or(`geldig_tot.is.null,geldig_tot.gte.${peil}`);
    }
    if (filters?.bronstatus) q3 = q3.in("bronstatus", filters.bronstatus);
    if (filters?.documentstatus) q3 = q3.in("documentstatus", filters.documentstatus);
    if (filters?.procesinstantie_ids) q3 = q3.in("procesinstantie_id", filters.procesinstantie_ids);
    if (filters?.bronsoort) q3 = q3.in("bibliotheek", filters.bronsoort);
    const { data: data3, error: error3 } = await opt.fasemeter.meet(
      "fts_ilike",
      () => Promise.resolve(metSignaal(q3, opt.signal)),
      { rijen: (u) => (Array.isArray(u.data) ? u.data.length : undefined), status: (u) => statusVanPostgrest(u, opt.signal) }
    );
    bewaakNaIO(opt.signal, error3);

    if (data3 && data3.length > 0) {
      const gevonden = data3 as unknown as DocumentChunk[];
      const bewaakt = handhaafFondsdiscipline(gevonden, fondsFilter, peildatum, filters?.modus);
      // R1.5 (b1): ilike-treffers zijn nooit citeerbaar → naVerwerking haalt ze
      // uit de prompt-set (achter de RELEVANTIE_DREMPEL-vlag) en logt ze als
      // mogelijk_gerelateerd. Geen rerank op dit laatste vangnet.
      const na = await naVerwerking(
        bewaakt.chunks, "ilike", vraag, filters, maxResults, maxPerDoc,
        fondsFilter, peildatum, opt, false
      );
      return {
        chunks: na.chunks,
        meta: {
          ...bouwMeta("ilike", bewaakt.chunks.length, na.chunks),
          filters: fMeta,
          ...fondsMeta(fondsFilter, bewaakt.gedropt),
          ...na.extra,
        },
      };
    }
  }

  return {
    chunks: [],
    meta: { ...bouwMeta("geen", 0, []), filters: fMeta, ...fondsMeta(fondsFilter, 0) },
  };
}

// ============================================================================
//  Schaduwtelling: bestaan er NIET-ACTUELE fondsstukken over dit onderwerp?
//  (30-07-2026)
// ----------------------------------------------------------------------------
//  Waarom. Onder p_modus='actueel' filtert de RPC alles weg wat niet
//  'vastgesteld'/'van_kracht' is (harde conceptregel, FO §6 / TO §3.1). De
//  gefilterde rijen zijn daarna ONZICHTBAAR voor de aanroeper, dus meldt de
//  assistent "geen relevante fondsdocumenten gevonden" ook wanneer er wél een
//  bestuursvoorstel over het onderwerp ligt. Die melding leidt tot de omgekeerde
//  conclusie van de werkelijkheid. Deze telling maakt het verschil zichtbaar.
//
//  Kostenbewust en fail-safe:
//   • Draait UITSLUITEND in het nul-treffergeval (aanroeper beslist) — precies
//     het geval waarin we nu een misleidend antwoord geven.
//   • FTS-ONLY (hybride uit): geen embedding-call, dus één goedkope RPC. FTS is
//     smaller dan hybride; vindt de telling niets, dan tonen we géén melding.
//     Een onderschatting leidt dus tot het huidige gedrag, nooit tot een
//     bewering over stukken die er niet zijn.
//   • Alleen bronsoort 'fonds': de melding gaat over fondsstukken, niet over de
//     generieke bibliotheek (die is per definitie 'van_kracht').
//   • Telt alleen chunks die de actualiteitstoets NIET halen; een treffer die er
//     wél door zou komen hoort niet in deze melding thuis.
//  RLS blijft leidend (dezelfde RPC's, SECURITY INVOKER).
// ============================================================================

/** Statussen die (los van bronstatus) een actuele bron kunnen zijn. Bewust hier
 *  herhaald i.p.v. geïmporteerd: rag.ts is de retrievallaag en mag niet aan de
 *  statustransitie-module hangen. Zelfde bron van waarheid als de RPC-clausule
 *  en ACTUELE_BRON_STATUSSEN in document-status-transities.ts — wijk je hier af,
 *  dan wijkt de melding af van de filter. */
const ACTUELE_STATUSSEN_RAG = new Set(["vastgesteld", "van_kracht"]);

/** Zou deze chunk de actualiteitsfilter van de RPC hebben gehaald? */
function zouActueelZijn(c: DocumentChunk, peildatum: string): boolean {
  const d = c.documenten;
  const status = d.documentstatus ?? "";
  const bronstatus = d.bronstatus ?? "actief";
  if (!ACTUELE_STATUSSEN_RAG.has(status)) return false;
  if (bronstatus !== "actief") return false;
  if (d.geldig_vanaf && d.geldig_vanaf > peildatum) return false;
  if (d.geldig_tot && d.geldig_tot < peildatum) return false;
  return true;
}

export async function telNietActueleFondstreffers(
  vraag: string,
  fondsId: string,
  peildatum?: string
): Promise<{ documenten: number; chunks: number; titels: string[] }> {
  const peil = peildatum ?? vandaagISO();
  try {
    const { chunks } = await zoekRelevanteChunksMetMeta(
      vraag,
      fondsId,
      12,
      false, // FTS-only: geen embedding-call
      undefined,
      { modus: "alles", bronsoort: ["fonds"], peildatum: peil }
    );
    const nietActueel = chunks.filter((c) => !zouActueelZijn(c, peil));
    const perDocument = new Map<string, string>();
    for (const c of nietActueel) {
      if (!perDocument.has(c.document_id))
        perDocument.set(c.document_id, c.documenten.titel);
    }
    return {
      documenten: perDocument.size,
      chunks: nietActueel.length,
      // Maximaal drie titels: genoeg om te herkennen, geen bronvermelding (die
      // hoort bij een antwoord dat op het stuk is gebaseerd — dit is het niet).
      titels: [...perDocument.values()].slice(0, 3),
    };
  } catch (e) {
    // Fail-safe: een mislukte telling mag het antwoord nooit blokkeren.
    console.error("Schaduwtelling niet-actuele fondstreffers mislukt:", e);
    return { documenten: 0, chunks: 0, titels: [] };
  }
}

// Backwards-compatibele wrapper: geeft alleen de chunks terug.
export async function zoekRelevanteChunks(
  vraag: string,
  fondsId: string,
  maxResults = 8,
  filters?: RetrievalFilters
): Promise<DocumentChunk[]> {
  const { chunks } = await zoekRelevanteChunksMetMeta(
    vraag,
    fondsId,
    maxResults,
    undefined,
    undefined,
    filters
  );
  return chunks;
}

// H-10 (review 2026-07-30) — de bron-afbakening en -neutralisatie leven in een
// eigen, PURE module (core/lib/bron-afbakening.ts): rag.ts trekt de Supabase-
// client aan en is daardoor niet standalone testbaar, terwijl juist dit deel
// een eigen regressietest verdient. Hier alleen re-export, zodat aanroepers
// één importpad houden.
export { neutraliseerBrontekst, maakBronSentinel };

// Maak een gestructureerde context-string voor Claude
// `startIndex` (optioneel): laat de [Bron N]-nummering hoger beginnen, zodat een
// aanroeper eigen bronnen (bv. gekoppelde vergaderstukken in de agendaprep) vóór
// de bibliotheek-chunks kan nummeren en één doorlopende bronlijst ontstaat.
// `sentinel` (optioneel): bron-afbakening met een onvoorspelbare markering. Laat
// je hem weg, dan wordt er één gegenereerd — maar geef bij een prompt met
// MEERDERE contextblokken dezelfde sentinel mee, anders sluit het model de
// blokken niet consistent.
/** Chunk → contract-`Bronresultaat`, inclusief de weergavemetadata die de
 *  centrale citaatopbouw nodig heeft. Eén plek voor rag.ts en de adapter. */
export function chunkAlsBronresultaat(chunk: DocumentChunk, positie = 0): Bronresultaat {
  const d = chunk.documenten;
  const namespace = d.bibliotheek === "generiek" ? "generiek" : `fonds:${d.fonds_id ?? "onbekend"}`;
  const documentId = maakDocumentIdentiteit(namespace, chunk.document_id);
  const passageId = maakPassageIdentiteit(documentId, `chunk-index:${chunk.chunk_index}`);
  const volledigeVersie =
    chunk.indexering_versie && d.bestand_hash && /^[a-f0-9]{64}$/.test(d.bestand_hash)
      ? maakVolledigeVersieHash(chunk.document_id, chunk.indexering_versie, d.bestand_hash)
      : null;
  return {
    ref: passageId,
    bronsoort: d.bibliotheek === "generiek" ? "generiek" : chunk.notulen ? "notulen" : "fonds",
    titel: d.titel,
    documentIdentiteit: {
      id: documentId,
      bibliotheek: d.bibliotheek ?? null,
      bron: d.bron ?? null,
      fondsId: d.fonds_id ?? null,
      procesId: d.procesinstantie_id ?? null,
    },
    passageIdentiteit: { id: passageId },
    // R1 (T2-3) brengt de volledige hash. Tot dan is de documentdatum de ZWAKKE
    // legacyfallback, en is er geen controlemoment: `gecontroleerdOp: null` zegt
    // dat expliciet. Zonder documentdatum is er helemaal geen versiebewijs.
    versie: volledigeVersie
      ? { soort: "hash" as const, waarde: volledigeVersie, gecontroleerdOp: new Date().toISOString() }
      : d.documentdatum
      ? { soort: "status-datum" as const, waarde: d.documentdatum, gecontroleerdOp: null }
      : { soort: "onbekend" as const, waarde: null, gecontroleerdOp: null },
    locator: {
      pagina: chunk.pagina,
      paragraaf: chunk.paragraaf,
      chunkIndex: chunk.chunk_index,
      // #500 — alleen aanwezig als het artikelspoor het label ophaalde.
      ...(chunk.structuur_label !== undefined ? { structuurLabel: chunk.structuur_label } : {}),
    },
    passage: chunk.tekst,
    status: {
      documentstatus: d.documentstatus ?? null,
      bronstatus: d.bronstatus ?? null,
      geldigTot: d.geldig_tot ?? null,
      actueel: (d.documentstatus ?? null) === "van_kracht",
    },
    rang: {
      positie,
      score: chunk.rang ?? null,
      fts: chunk.fts_rang ?? null,
      vec: chunk.vec_rang ?? null,
      ...(chunk.sectiespoor ? { poging: "sectiespoor" } : chunk.artikelspoor ? { poging: "artikelspoor" } : {}),
    },
    curatie: { normgewicht: d.normgewicht ?? null, wettelijkRegime: d.wettelijk_regime ?? null },
    weergave: {
      bronorganisatie: d.bronorganisatie ?? null,
      documentdatum: d.documentdatum ?? null,
      opslagPad: d.opslag_pad ?? null,
      externUrl: d.extern_url ?? null,
      documenttype: d.documenttype ?? null,
      wetsgeschiedenisSubtype: d.wetsgeschiedenis_subtype ?? null,
      dossiernummer: d.dossiernummer ?? null,
      bestandstype: d.bestandstype ?? null,
      notulen: chunk.notulen
        ? {
            vergaderingTitel: chunk.notulen.vergadering_titel,
            agendapuntVolgnummer: chunk.notulen.agendapunt_volgnummer,
            agendapuntTitel: chunk.notulen.agendapunt_titel,
          }
        : null,
      aangeleverdePassage: chunk.aangeleverde_passage ?? null,
    },
  };
}

/**
 * T2-1 — DUNNE WRAPPER. De citaatopbouw leeft centraal in
 * `core/lib/retrieval/citatie.ts`: nummering, sentinel, neutralisatie en
 * `BronVerwijzing` mogen niet per provider verschillen (besluit 0213 punt 5).
 * Deze wrapper houdt de bestaande aanroepers (reflectiepad, breed pad, AQLab)
 * ongewijzigd. Zonder contextgrens — die geldt op het contractpad.
 */
export function maakContext(
  chunks: DocumentChunk[],
  startIndex = 0,
  sentinel: string = maakBronSentinel(),
  primaireDocumentIds?: ReadonlySet<string> | null,
  peildatum?: string,
  primairLabel: string = " [hoofddocument]"
): { contextTekst: string; bronnen: BronVerwijzing[]; geneutraliseerd: number; sentinel: string } {
  const r = bouwCitaties(chunks.map((c, i) => chunkAlsBronresultaat(c, i)), {
    primaireDocumentIds: primaireDocumentIds ?? new Set<string>(),
    peildatum: peildatum ?? "",
    hoofddocumentLabel: primairLabel,
    maxContextTekens: 0,
    sentinel,
    startIndex,
  });
  return { contextTekst: r.contextTekst, bronnen: r.bronnen, geneutraliseerd: r.geneutraliseerd, sentinel: r.sentinel };
}


// Haalt alle technisch toegestane chunks van de gescopete document(en) op,
// geordend op document en chunk-index — voor full-document en map-reduce. Géén
// ranking. Het resultaat draagt een exact count-/afkapsignaal: "volledig" mag
// nooit meer worden afgeleid uit alleen het aantal teruggegeven rijen.
// Increment T4 — `fondsId` (server-side geresolveerd; body genegeerd) dwingt de
// fonds-discipline ook op dit dekkingsbrede pad af. Dit pad loopt NIET via de RPC
// (met p_fonds_id), dus de app-guard (handhaafFondsdiscipline) is hier de enige
// expliciete laag náást RLS. De select levert daarom fonds_id + document-/bronstatus.
export const VOLLEDIGE_DOCUMENT_CHUNK_CAP = 5000;
const VOLLEDIGE_DOCUMENT_PAGINA = 1000;

export interface DocumentChunkOphaalresultaat {
  chunks: DocumentChunk[];
  totaal_chunks: number | null;
  opgehaalde_chunks: number;
  volledig: boolean;
  afkapreden: "chunk_cap" | "retrieval_fout" | null;
  fondsdiscipline_gedropt: number;
}

/** Exacte, RLS-begrensde telling zonder documenttekst op te halen. */
export async function telDocumentChunks(documentIds: string[]): Promise<number | null> {
  if (documentIds.length === 0) return 0;
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .in("document_id", documentIds);
  if (error) {
    console.error("telDocumentChunks fout:", error);
    return null;
  }
  return typeof count === "number" ? count : null;
}

export async function haalDocumentChunksMetDekking(
  documentIds: string[],
  fondsId: string | null = null
): Promise<DocumentChunkOphaalresultaat> {
  if (documentIds.length === 0) {
    return {
      chunks: [],
      totaal_chunks: 0,
      opgehaalde_chunks: 0,
      volledig: false,
      afkapreden: null,
      fondsdiscipline_gedropt: 0,
    };
  }
  const supabase = await createServerSupabase();
  const { count, error: countFout } = await supabase
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .in("document_id", documentIds);
  if (countFout) {
    console.error("haalDocumentChunks count-fout:", countFout);
    return {
      chunks: [],
      totaal_chunks: null,
      opgehaalde_chunks: 0,
      volledig: false,
      afkapreden: "retrieval_fout",
      fondsdiscipline_gedropt: 0,
    };
  }

  const totaal = typeof count === "number" ? count : null;
  const teLezen = Math.min(totaal ?? VOLLEDIGE_DOCUMENT_CHUNK_CAP, VOLLEDIGE_DOCUMENT_CHUNK_CAP);
  const rijen: DocumentChunk[] = [];
  for (let offset = 0; offset < teLezen; offset += VOLLEDIGE_DOCUMENT_PAGINA) {
    const einde = Math.min(offset + VOLLEDIGE_DOCUMENT_PAGINA, teLezen) - 1;
    const { data, error } = await supabase
      .from("document_chunks")
      .select(
        `id, document_id, tekst, pagina, paragraaf, chunk_index,
         documenten!inner(titel, bron, bibliotheek, opslag_pad, fonds_id, documentstatus:status, bronstatus, volgende_review, bestand_hash, scan_resultaat)`
      )
      .in("document_id", documentIds)
      .eq("documenten.actief", true)
      .order("document_id", { ascending: true })
      .order("chunk_index", { ascending: true })
      .range(offset, einde);
    if (error || !data) {
      console.error("haalDocumentChunks pagina-fout:", error);
      const fondsFilter = fondsId && fondsId.length > 0 ? fondsId : null;
      const bewaakt = bewaakDekking(rijen, fondsFilter);
      return {
        chunks: bewaakt.chunks,
        totaal_chunks: totaal,
        opgehaalde_chunks: bewaakt.chunks.length,
        volledig: false,
        afkapreden: "retrieval_fout",
        fondsdiscipline_gedropt: bewaakt.gedropt,
      };
    }
    rijen.push(...(data as unknown as DocumentChunk[]));
    if (data.length < einde - offset + 1) break;
  }

  const fondsFilter = fondsId && fondsId.length > 0 ? fondsId : null;
  const bewaakt = bewaakDekking(rijen, fondsFilter);
  const capBereikt = totaal !== null && totaal > VOLLEDIGE_DOCUMENT_CHUNK_CAP;
  const volledig =
    totaal !== null &&
    totaal > 0 &&
    bewaakt.gedropt === 0 &&
    bewaakt.chunks.length === totaal &&
    !capBereikt;
  return {
    chunks: bewaakt.chunks,
    totaal_chunks: totaal,
    opgehaalde_chunks: bewaakt.chunks.length,
    volledig,
    afkapreden: capBereikt ? "chunk_cap" : null,
    fondsdiscipline_gedropt: bewaakt.gedropt,
  };
}

// Fondsdiscipline + WP3-scanleespoort voor het dekkingsbrede pad. Een door de
// scanpoort geweigerde rij telt als gedropt, dus de dekking is dan nooit
// "volledig" en de prompt krijgt de tekst niet.
function bewaakDekking(
  rijen: DocumentChunk[],
  fondsFilter: string | null
): { chunks: DocumentChunk[]; gedropt: number } {
  const fonds = handhaafFondsdiscipline(rijen, fondsFilter);
  const scan = handhaafScanbewijs(fonds.chunks, isMalwarescanAan());
  return { chunks: scan.chunks, gedropt: fonds.gedropt + scan.gedropt };
}

/** Backwards-compatible wrapper voor bestaande aanroepers die alleen rijen nodig hebben. */
export async function haalDocumentChunks(
  documentIds: string[],
  fondsId: string | null = null
): Promise<DocumentChunk[]> {
  return (await haalDocumentChunksMetDekking(documentIds, fondsId)).chunks;
}

// ── Plateau B / G3 — de bevroren reflectiebronset ──────────────────────────
// Tijdens een actieve reflectieflow wordt er GEEN retrieval gedaan (FR-54): geen
// embedding, geen RPC, geen FTS, geen PostgREST-terugval. Retrieval op een zin
// als "ik maak mij zorgen over gepensioneerden" levert willekeurige treffers die
// vervolgens als bron worden getóónd — schijnzekerheid bovenop een twijfel.
//
// In plaats daarvan worden precies de chunks opgehaald die bij het oorspronkelijke
// antwoord zijn gebruikt. Nieuwe antwoorden dragen uitsluitend een opaque
// passage-identiteit; de server leest daarom kandidaten via de lokale document-
// route-ids uit de verwijderbare antwoordinhoud en bindt ze daarna exact aan de
// opnieuw berekende passage-identiteit. Legacy-antwoorden met een rauwe chunk-id
// blijven leesbaar. Deterministisch: geen ranking, geen selectie, geen drempel.
// Dat is strenger dan het filter dat het technisch ontwerp §6.3
// voorstelt (`p_document_ids` op de retrieval-RPC's): een filter kan worden
// omzeild door een pad dat de RPC niet gebruikt, deze aanpak niet — want er
// draait geen enkel retrievalpad.
//
// De fonds-discipline geldt onverkort (T4, besluit 0045). Dat is hier geen
// formaliteit: de bronset komt uit een logregel die dagen oud kan zijn. Is een
// document intussen ingetrokken, van fonds gewisseld of over zijn verplichte
// review heen, dan valt het hier alsnog af — de bevriezing bevriest de SELECTIE,
// niet de toegang.
const LOKALE_UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSAGE_IDENTITEIT_EXACT = /^passage_v1_[a-f0-9]{64}$/;

/** Pure laatste binding: een kandidaat telt alleen wanneer zijn raw legacy-id
 * of zijn opnieuw berekende providerneutrale passage-id exact was bevroren. */
export function selecteerBevrorenChunksOpRefs(
  kandidaten: DocumentChunk[],
  passageRefs: readonly string[],
  bronbindingen: readonly BevrorenBronbinding[] = []
): DocumentChunk[] {
  const refs = new Set(passageRefs);
  const bindingPerPassage = new Map(bronbindingen.map((binding) => [binding.passageIdentiteit, binding]));
  return kandidaten.filter((chunk) => {
    if (refs.has(chunk.id)) return true; // uitsluitend historische raw UUID-meta
    const actueel = chunkAlsBronresultaat(chunk);
    if (!refs.has(actueel.passageIdentiteit.id)) return false;
    const bevroren = bindingPerPassage.get(actueel.passageIdentiteit.id);
    const versieWaarde = actueel.versie.waarde;
    if (
      !bevroren ||
      typeof versieWaarde !== "string" ||
      bevroren.documentIdentiteit !== actueel.documentIdentiteit.id ||
      bevroren.versieSoort !== actueel.versie.soort ||
      bevroren.versieWaarde !== versieWaarde
    ) return false;
    return bevroren.citationId === maakCitationId(
      actueel.documentIdentiteit.id,
      actueel.passageIdentiteit.id,
      actueel.versie.soort,
      versieWaarde
    );
  });
}

export const REFLECTIE_KANDIDATEN_MAX = 2_000;
const REFLECTIE_KANDIDATEN_PAGINA = 500;
export function planReflectieKandidatenPagina(van: number): { van: number; tot: number } | null {
  if (!Number.isInteger(van) || van < 0 || van >= REFLECTIE_KANDIDATEN_MAX) return null;
  return {
    van,
    tot: Math.min(van + REFLECTIE_KANDIDATEN_PAGINA - 1, REFLECTIE_KANDIDATEN_MAX - 1),
  };
}
const REFLECTIE_SELECT = `id, document_id, tekst, pagina, paragraaf, chunk_index, indexering_versie,
  documenten!inner(titel, bron, bibliotheek, opslag_pad, fonds_id, documentstatus:status,
    bronstatus, documentdatum, geldig_tot, volgende_review, bestand_hash, scan_resultaat)`;

export interface BevrorenChunksResultaat {
  chunks: DocumentChunk[];
  status: {
    volledig: boolean;
    reden: "opgelost" | "kandidaatcap" | "ontbrekende_ref" | "ontbrekende_binding" | "private_scope_ontbreekt" | "providerfout";
    kandidaatcap: number;
  };
}

function bevrorenUitkomst(
  chunks: DocumentChunk[],
  volledig: boolean,
  reden: BevrorenChunksResultaat["status"]["reden"]
): BevrorenChunksResultaat {
  return {
    // Atomair: een onvolledige bronset mag nooit als gedeeltelijke context naar
    // het model. Ook reeds gevonden geldige chunks vallen dan volledig weg.
    chunks: volledig ? chunks : [],
    status: { volledig, reden, kandidaatcap: REFLECTIE_KANDIDATEN_MAX },
  };
}

/** Pure atomaire eindpoort, apart getest met cap- en missing-refgevallen. */
export function finaliseerBevrorenChunks(
  gevonden: DocumentChunk[],
  passageRefs: readonly string[],
  onderzocht: number
): BevrorenChunksResultaat {
  const uniekeRefs = new Set(passageRefs);
  const uniekGevonden = [...new Map(gevonden.map((chunk) => [chunk.id, chunk])).values()];
  const opgelosteRefs = new Set<string>();
  for (const chunk of uniekGevonden) {
    if (uniekeRefs.has(chunk.id)) opgelosteRefs.add(chunk.id);
    const passage = chunkAlsBronresultaat(chunk).passageIdentiteit.id;
    if (uniekeRefs.has(passage)) opgelosteRefs.add(passage);
  }
  if ([...uniekeRefs].every((ref) => opgelosteRefs.has(ref))) {
    return bevrorenUitkomst(uniekGevonden, true, "opgelost");
  }
  return bevrorenUitkomst(
    [],
    false,
    onderzocht >= REFLECTIE_KANDIDATEN_MAX ? "kandidaatcap" : "ontbrekende_ref"
  );
}

export async function haalBevrorenChunks(
  passageRefs: string[],
  lokaleDocumentRefs: string[],
  fondsId: string | null = null,
  bronbindingen: readonly BevrorenBronbinding[] = [],
  signal?: AbortSignal
): Promise<BevrorenChunksResultaat> {
  if (passageRefs.length === 0) return bevrorenUitkomst([], true, "opgelost");
  bewaakNaIO(signal);
  const supabase = await createServerSupabase();
  const legacyIds = [...new Set(passageRefs.filter((ref) => LOKALE_UUID_EXACT.test(ref)))];
  const opaqueRefs = passageRefs.filter((ref) => PASSAGE_IDENTITEIT_EXACT.test(ref));
  const documentRefs = [...new Set(lokaleDocumentRefs.filter((ref) => LOKALE_UUID_EXACT.test(ref)))];
  const uniekeRefs = new Set(passageRefs);
  const gevonden: DocumentChunk[] = [];
  const fondsFilter = fondsId && fondsId.length > 0 ? fondsId : null;
  if (legacyIds.length + opaqueRefs.length !== uniekeRefs.size) {
    return bevrorenUitkomst([], false, "ontbrekende_ref");
  }
  const gebondenPassages = new Set(bronbindingen.map((binding) => binding.passageIdentiteit));
  if (opaqueRefs.some((ref) => !gebondenPassages.has(ref))) {
    return bevrorenUitkomst([], false, "ontbrekende_binding");
  }

  if (legacyIds.length > 0) {
    let query = supabase
      .from("document_chunks")
      .select(REFLECTIE_SELECT)
      .in("id", legacyIds)
      .eq("documenten.actief", true)
      .order("document_id", { ascending: true })
      .order("chunk_index", { ascending: true });
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    bewaakNaIO(signal, error);
    if (error || !data) {
      console.error("haalBevrorenChunks legacy-fout:", error);
      return bevrorenUitkomst([], false, "providerfout");
    }
    // WP3: een chunk zonder schoon scanbewijs lost niet op ⇒ de atomaire
    // eindpoort maakt de hele bevroren set leeg (ontbrekende_ref).
    const toegestaan = handhaafScanbewijs(
      handhaafFondsdiscipline(data as unknown as DocumentChunk[], fondsFilter).chunks,
      isMalwarescanAan()
    ).chunks;
    gevonden.push(...selecteerBevrorenChunksOpRefs(toegestaan, legacyIds));
  }

  // Geen lokale documentroute bij een opaque bronset: fail-closed. Zonder die
  // server-side begrenzing zouden we de hele corpus-tabel moeten scannen.
  if (opaqueRefs.length > 0 && documentRefs.length === 0) {
    return bevrorenUitkomst([], false, "private_scope_ontbreekt");
  }

  let onderzocht = 0;
  if (opaqueRefs.length > 0) {
    let van = 0;
    while (true) {
      bewaakNaIO(signal);
      const bereik = planReflectieKandidatenPagina(van);
      if (!bereik) break;
      const paginaGrootte = bereik.tot - bereik.van + 1;
      let query = supabase
        .from("document_chunks")
        .select(REFLECTIE_SELECT)
        .in("document_id", documentRefs)
        .eq("documenten.actief", true)
        .order("document_id", { ascending: true })
        .order("chunk_index", { ascending: true })
        .range(bereik.van, bereik.tot);
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      bewaakNaIO(signal, error);
      if (error || !data) {
        console.error("haalBevrorenChunks opaque-resolutiefout:", error);
        return bevrorenUitkomst([], false, "providerfout");
      }
      onderzocht += data.length;
      const toegestaan = handhaafScanbewijs(
        handhaafFondsdiscipline(data as unknown as DocumentChunk[], fondsFilter).chunks,
        isMalwarescanAan()
      ).chunks;
      gevonden.push(...selecteerBevrorenChunksOpRefs(toegestaan, opaqueRefs, bronbindingen));
      const gevondenPassages = new Set(
        gevonden.map((chunk) => chunkAlsBronresultaat(chunk).passageIdentiteit.id)
      );
      if (opaqueRefs.every((ref) => gevondenPassages.has(ref)) || data.length < paginaGrootte) break;
      van = bereik.tot + 1;
    }
  }

  bewaakNaIO(signal);
  return finaliseerBevrorenChunks(gevonden, passageRefs, onderzocht);
}

// Increment D — verrijk opgehaalde chunks met de vergadering/agendapunt van hun
// bevestigde notulensegment, zodat maakContext de bronvermelding "Vastgestelde
// notulen [verg], agendapunt N — [titel]" kan renderen. De retrieval-RPC's
// (zoek_chunks/zoek_chunks_hybride) leveren dit NIET en blijven ongewijzigd; dit
// is één gebatchte vervolgquery op de chunk-id's. RLS-veilig (anon-client). Muteert
// de meegegeven chunks in-place en geeft ze terug.
export async function verrijkNotulenChunks(
  chunks: DocumentChunk[],
  signal?: AbortSignal
): Promise<DocumentChunk[]> {
  if (chunks.length === 0) return chunks;
  const supabase = await createServerSupabase();
  const ids = chunks.map((c) => c.id);

  const { data, error } = await metSignaal(supabase
    .from("document_chunks")
    .select(
      `id,
       notulen_segment_id,
       notulen_segmenten!inner(
         agendapunt_id,
         agendapunten(volgorde, titel),
         vergaderingen!inner(titel)
       )`
    )
    .in("id", ids)
    .not("notulen_segment_id", "is", null), signal);
  bewaakNaIO(signal, error);

  if (error || !data || data.length === 0) return chunks;

  const perChunk = new Map<string, DocumentChunk["notulen"]>();
  for (const rij of data as unknown as NotulenVerrijkingRij[]) {
    const seg = rij.notulen_segmenten;
    if (!seg) continue;
    perChunk.set(rij.id, {
      vergadering_titel: seg.vergaderingen?.titel ?? "vergadering",
      agendapunt_volgnummer: seg.agendapunten?.volgorde ?? null,
      agendapunt_titel: seg.agendapunten?.titel ?? null,
    });
  }

  for (const c of chunks) {
    const n = perChunk.get(c.id);
    if (n) c.notulen = n;
  }
  return chunks;
}

// ============================================================================
//  Tranche 2B — documenttype en bestandstype voor de WEERGAVE
// ----------------------------------------------------------------------------
//  Waarom een aparte vervolgquery en niet gewoon twee kolommen in de selects:
//  het gerangschikte pad loopt via de RPC's `zoek_chunks` en
//  `zoek_chunks_hybride`, en die hebben een VASTE `returns table`. Een kolom
//  toevoegen aan een RPC-return vereist `drop function` + `create` — dus een
//  migratie (zie 2026_07_10_t10, dat om precies die reden droppen moest). De
//  afspraak voor deze tranche was: geen migratie.
//
//  Deze functie zit ná de splitsing in retrieval-paden, op de plek waar RPC,
//  fallback-cascade, dekkingsbrede scope en parent-context weer samenkomen. Dat
//  is niet alleen goedkoper dan zeven selects bijhouden — het maakt "geen pad
//  gemist" ook structureel in plaats van een controle die je elke keer opnieuw
//  moet doen.
//
//  Zelfde patroon als verrijkNotulenChunks() hierboven: één gebatchte query op
//  de unieke document-id's, RLS-veilig via de anon-client. Een document buiten
//  het eigen fonds komt niet terug en het veld blijft leeg — nooit een lek,
//  nooit een gebroken kaart.
//
//  GRENS: deze velden zijn doorgeefwaarden voor weergave, prompt-/bronduiding
//  (R-1) en — sinds R-3 (#492) — de juridische rol in de CENTRALE selectie
//  (retrieval/juridisch-beleid.ts). Op het orkestratiepad draait deze functie in
//  de adapterhook `verrijkKandidaten()`, dus vóór de toelatingspoort en vóór de
//  selectie. Filtering en de zoek-RPC's lezen ze niet. `maakContext()` bouwt de
//  modelcontext uit expliciet benoemde velden — het bronnen-array gaat nergens
//  door JSON.stringify.
// ============================================================================
/** Rijvorm van de verrijkingsquery. */
interface DocumentmetadataRij {
  id: string;
  fonds_id: string | null;
  bibliotheek: string | null;
  documenttype: string | null;
  wetsgeschiedenis_subtype: string | null;
  dossiernummer: string | null;
  bestandstype: string | null;
  documentdatum: string | null;
  geldig_tot: string | null;
  normgewicht: string | null;
  bronorganisatie: string | null;
  extern_url: string | null;
  wettelijk_regime: string | null;
}

export async function verrijkDocumentmetadata(
  chunks: DocumentChunk[],
  fondsId: string | null = null,
  signal?: AbortSignal
): Promise<DocumentChunk[]> {
  if (chunks.length === 0) return chunks;
  const ids = [...new Set(chunks.map((c) => c.document_id))];
  const supabase = await createServerSupabase();

  const { data, error } = await metSignaal(supabase
    .from("documenten")
    .select(
      "id, fonds_id, bibliotheek, documenttype, wetsgeschiedenis_subtype, dossiernummer, bestandstype, documentdatum, geldig_tot, normgewicht, bronorganisatie, extern_url, wettelijk_regime"
    )
    .in("id", ids), signal);

  // Een AFBREKING is geen "metadata niet beschikbaar": doorgooien vóór de
  // fail-safe hieronder, anders bouwt de keten na een annulering alsnog de
  // volledige weergave op.
  bewaakNaIO(signal, error);

  // Fail-safe: zonder deze metadata valt de weergave netjes terug (geen chip,
  // geen badge). Een fout mag het antwoord nooit tegenhouden.
  if (error || !data) {
    if (error) console.error("verrijkDocumentmetadata fout:", error);
    return chunks;
  }

  const perDocument = new Map(
    (data as DocumentmetadataRij[]).map((d) => [d.id, d])
  );
  for (const c of chunks) {
    const d = perDocument.get(c.document_id);
    if (!d) continue;
    // App-guard náást RLS (T4-patroon, decisions/0045): RLS geeft een vreemd
    // fonds al niet terug, maar mocht er bovenstrooms iets misgaan, dan willen we
    // zo'n document níét netjes decoreren met een typechip — dan hoort het op te
    // vallen, niet weg te vallen.
    if (fondsId && d.fonds_id && d.fonds_id !== fondsId && d.bibliotheek !== "generiek") {
      continue;
    }
    c.documenten.documenttype = d.documenttype ?? null;
    c.documenten.wetsgeschiedenis_subtype = d.wetsgeschiedenis_subtype ?? null;
    c.documenten.dossiernummer = d.dossiernummer ?? null;
    c.documenten.bestandstype = d.bestandstype ?? null;
    // De overige velden alleen AANVULLEN. De RPC's leveren ze op het
    // gerangschikte pad al; overschrijven zou daar niets toevoegen en een
    // afwijking kunnen maskeren. Op het dekkingsbrede pad ontbreken ze wél —
    // `haalDocumentChunks` selecteert alleen wat de fondsguard nodig heeft —
    // en daar vult deze stap ze aan, zodat de documentlijst er niet zonder
    // status en datum bij staat.
    const doc = c.documenten;
    doc.documentdatum ??= d.documentdatum ?? null;
    doc.geldig_tot ??= d.geldig_tot ?? null;
    doc.normgewicht ??= d.normgewicht ?? null;
    doc.bronorganisatie ??= d.bronorganisatie ?? null;
    doc.extern_url ??= d.extern_url ?? null;
    doc.wettelijk_regime ??= d.wettelijk_regime ?? null;
  }
  return chunks;
}

// Vorm van de verrijkingsquery hierboven (PostgREST nest embedded relaties).
interface NotulenVerrijkingRij {
  id: string;
  notulen_segment_id: string | null;
  notulen_segmenten: {
    agendapunt_id: string | null;
    agendapunten: { volgorde: number | null; titel: string | null } | null;
    vergaderingen: { titel: string | null } | null;
  } | null;
}

// Chunk-helpers leven in lib/chunking.ts (Supabase-vrij, zuiver testbaar).
// Hier opnieuw geëxporteerd zodat bestaande imports uit "@/core/lib/rag" blijven werken.
export { maakChunks, maakChunksUitSegmenten, type ChunkMetLocatie } from "./chunking";
