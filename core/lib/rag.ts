// RAG pipeline: zoek relevante document chunks voor een vraag
import { neutraliseerBrontekst, maakBronSentinel } from "./bron-afbakening";
import { createServerSupabase } from "./supabase-server";
import { bouwTerugvalFtsQuery } from "./fts-terugval";
import { selecteerChunks } from "./rag-select";
import { embedTekst, naarVectorLiteral } from "./embeddings";
import { notulenBronLabel } from "./notulen";
import { bouwBronfragment } from "./bronfragment";
import type { RetrievalModus } from "./vraagtype";
import { weegBronsoort, type Bronsoortprofiel } from "./weeg-bronsoort";
import { isStandaardZichtbaarInRag } from "./generiek-curatie";
import { isReviewVerlopen } from "./generiek-status";
import type { AssistantSource, AssistantSourceSamenvatting } from "./assistant-source";
// R1.3–R1.6 retrieval-kwaliteitsbundel. Elk onderdeel draait achter een eigen
// vlag (zie RetrievalOpties) en heeft een eigen fail-safe; defaults reproduceren
// het huidige gedrag. jargon-expansie is puur; rerank/parent-context hebben een
// zuivere kern + een onzuivere schil.
import { expandeerFtsQuery } from "./jargon-expansie";
import { rerankChunks, type RerankMeta, type RerankClient } from "./rerank";
import { verrijkMetParents, type ParentMeta } from "./parent-context";

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
function filterZwakkeGeneriek(
  chunks: DocumentChunk[],
  filters?: RetrievalFilters
): DocumentChunk[] {
  if (filters?.toonZwakkeGeneriek) return chunks;
  return chunks.filter(
    (c) =>
      c.documenten.bibliotheek !== "generiek" ||
      isStandaardZichtbaarInRag(c.documenten.normgewicht)
  );
}

// ── Increment T4: expliciete fonds-discipline op het retrievalpad ───────────
// Defense-in-depth NÁÁST RLS én de RPC-fondsfilter (p_fonds_id). Dropt elke chunk
// die de fondsgrens of de published-generiek-regel schendt, en telt de droppings
// zodat een (theoretisch) lek zichtbaar wordt in retrieval_meta. Wordt op ELK
// retrievalpad toegepast — óók de PostgREST-fallback en haalDocumentChunks, die
// niet door de RPC (met p_fonds_id) lopen. Zie decisions/0045.
//
// Vereist dat het pad `documenten.fonds_id` (en voor regel 2 documentstatus/
// bronstatus) heeft geselecteerd; alle aanroepers hieronder doen dat.
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
// tot de prompt-set. De weging gebeurt VÓÓR selecteerChunks — dat behoudt de
// inkomende volgorde, dus de boost werkt door in welke chunks de top-N halen.
// §8.3 #6-uitsluiting draait als eerste, zodat zwakke generieke chunks geen
// prompt-plek bezetten die anders naar een fonds-/sterke bron was gegaan.
function weegEnSelecteer(
  gerangschikt: DocumentChunk[],
  filters: RetrievalFilters | undefined,
  maxResults: number,
  maxPerDoc: number
): DocumentChunk[] {
  const zichtbaar = filterZwakkeGeneriek(gerangschikt, filters);
  const gewogen = filters?.bronsoortprofiel
    ? weegBronsoort(zichtbaar, (c) => c.documenten.bibliotheek, filters.bronsoortprofiel)
    : zichtbaar;
  return selecteerChunks(gewogen, maxResults, maxPerDoc);
}

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
  relevantieDrempel?: boolean; // R1.5 ilike-uitsluiting (b1) + scoredrempel (b2)
  jargonExpansie?: boolean; // R1.4 FTS-jargonexpansie
  parentRetrieval?: boolean; // R1.6 small-to-big
  drempelWaarde?: number; // R1.5 b2-drempel op de rerankscore (0–100)
  rerankClient?: RerankClient; // injectie voor hermetische tests
  // Besluit 0139 (M-R3) — de OORSPRONKELIJKE gebruikersvraag, meegegeven wanneer
  // `vraag` een geherformuleerde zoekvraag is. Is deze gezet en wijkt hij af, dan
  // draait de hybride retrieval een EXTRA poging met de originele vraag en fuseert
  // de kandidatensets, zodat een (mogelijk verkeerde) reformulatie alleen recall
  // kan TOEVOEGEN, nooit wegnemen. Leeg/gelijk → geen extra poging (huidig gedrag).
  origineleVraag?: string;
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
  drempelWaarde: number;
  rerankClient?: RerankClient;
};

function volledigeOpties(o?: RetrievalOpties): VolledigeOpties {
  return {
    rerank: o?.rerank ?? process.env.RERANK === "on",
    relevantieDrempel: o?.relevantieDrempel ?? process.env.RELEVANTIE_DREMPEL === "on",
    jargonExpansie: o?.jargonExpansie ?? process.env.JARGON_EXPANSIE === "on",
    parentRetrieval: o?.parentRetrieval ?? process.env.PARENT_RETRIEVAL === "on",
    drempelWaarde: o?.drempelWaarde ?? DEFAULT_RELEVANTIE_DREMPEL,
    rerankClient: o?.rerankClient,
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
async function haalContextPrefixes(ids: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;
  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase
      .from("document_chunks")
      .select("id, context_prefix")
      .in("id", ids);
    for (const r of (data ?? []) as { id: string; context_prefix: string | null }[]) {
      map.set(r.id, r.context_prefix ?? null);
    }
  } catch (e) {
    console.error("[rag] context_prefix ophalen mislukt — rerank over kale tekst:", e);
  }
  return map;
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
  let kandidaten = bewaakteChunks;

  // A — Haiku-reranker (alleen op de sterke paden: hybride + Dutch-FTS-ranked).
  let rerankScores: Record<string, number> | null = null;
  if (opties.rerank && rerankToegestaan && kandidaten.length >= 2) {
    const prefixMap = await haalContextPrefixes(kandidaten.map((c) => c.id));
    const r = await rerankChunks(
      zoekvraag,
      kandidaten,
      (c) => verrijkTekst(prefixMap.get(c.id), c.tekst),
      { client: opties.rerankClient }
    );
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

  // Bronsoort-weging + dedup + top-N (ongewijzigd; werkt op de nieuwe volgorde).
  let geselecteerd = weegEnSelecteer(kandidaten, filters, maxResults, maxPerDoc);

  // B1 — ilike-treffers zijn NOOIT citeerbaar: uit de prompt-set gehaald, alleen
  // als audit vastgelegd. Leeg resultaat valt op het bestaande geen-treffers-pad.
  if (opties.relevantieDrempel && methode === "ilike" && geselecteerd.length > 0) {
    extra.zwakke_bronbasis = true;
    extra.mogelijk_gerelateerd = geselecteerd.map((c) => ({
      document_id: c.document_id,
      titel: c.documenten.titel,
    }));
    geselecteerd = [];
  }

  // D — parent-retrieval (small-to-big): treffers uitbreiden met hun structuur-
  // unit. Fondsdiscipline draait binnen verrijkMetParents op de siblings.
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
  // Relevantie-score uit ts_rank_cd; null bij fallback-zoekpaden zonder ranking.
  rang?: number | null;
  // Besluit 0139 — RRF-arm-rangen (1-based) waaruit deze chunk kwam: fts_rang =
  // positie in de lexicale arm, vec_rang = positie in de vector-arm; null = niet
  // in die arm gevonden. Alleen de hybride RPC levert ze (overige paden laten ze
  // weg). Voedt retrieval_meta zodat bij een incident zichtbaar is uit welke arm
  // een fragment kwam en of een arm dood was.
  fts_rang?: number | null;
  vec_rang?: number | null;
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
    // Increment T10 — verplichte reviewdatum van de (generieke) bron. Voedt de
    // review-verval-regel in handhaafFondsdiscipline (defense-in-depth náást de
    // T10-RPC-gate). Alleen de T10-RPC en de fallback-selects leveren dit.
    volgende_review?: string | null;
    // Tranche 2B — soort stuk en bestandsformaat, UITSLUITEND voor de weergave
    // (de documentlijst bij antwoordmodus `bronoverzicht`). Geen enkel retrieval-,
    // rangschik- of filterpad leest deze velden. Gevuld door
    // verrijkDocumentmetadata() ná retrieval; zie daar waarom niet via de select.
    documenttype?: string | null;
    bestandstype?: string | null;
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
export interface RetrievalMeta {
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
  }[];
  // Hybride retrieval (Fase C). Of de query-embedding lukte en, bij terugval op
  // FTS, waarom — zodat een stille terugval zichtbaar is in het auditspoor.
  embedding_query_success?: boolean;
  fallback_reason?: string;
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
  // Document-scope (increment 1/2). Aanwezig zodra een vraag tot één/enkele
  // document(en) is beperkt; legt voor de audit vast waarop gescoopt is en welke
  // retrievalstrategie is gekozen.
  scope?: {
    document_ids: string[];
    titels: string[];
    strategie: "targeted" | "full_document" | "map_reduce";
    algemene_kennis: boolean;
    // Increment 2: bij dekkingsbrede strategieën — hoeveel chunks verwerkt en
    // (bij map-reduce) in hoeveel batches; afgekapt = dekking gedeeltelijk.
    verwerkte_chunks?: number;
    batches?: number;
    afgekapt?: boolean;
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
}

export interface BronVerwijzing {
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
    },
  };
}

function bouwMeta(
  methode: RetrievalMeta["methode"],
  opgehaald: number,
  geselecteerd: DocumentChunk[]
): RetrievalMeta {
  return {
    methode,
    opgehaald,
    geselecteerd: geselecteerd.length,
    chunks: geselecteerd.map((c) => ({
      id: c.id,
      document_id: c.document_id,
      rang: c.rang ?? null,
      // Besluit 0139 — arm-herkomst mee in het auditspoor.
      fts_rang: c.fts_rang ?? null,
      vec_rang: c.vec_rang ?? null,
    })),
    // T4 — minimale bronversie-audit over de daadwerkelijk geselecteerde chunks.
    bronversie_audit: geselecteerd.map((c) => ({
      document_id: c.document_id,
      bron: c.documenten.bron,
      bibliotheek: c.documenten.bibliotheek,
      fonds_id: c.documenten.fonds_id ?? null,
      documentstatus: c.documenten.documentstatus ?? null,
      bronstatus: c.documenten.bronstatus ?? null,
      documentdatum: c.documenten.documentdatum ?? null,
    })),
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
  const peildatum = filters?.peildatum ?? vandaagISO();

  // Per-aanroep instelling (uit het portaal) is leidend; valt terug op de
  // env-default HYBRID_SEARCH als er geen waarde is meegegeven.
  const hybride = hybrideAan ?? HYBRID_ENABLED;
  if (!hybride) {
    return zoekViaFTS(vraag, maxResults, scope, filters, fondsFilter, opt);
  }

  const supabase = await createServerSupabase();
  const overFetch = Math.max(maxResults * 3, 20);
  const maxPerDoc = Math.max(3, Math.ceil(maxResults / 2));

  // Embed de (al door B1 geherformuleerde) vraag. Faalt dat → FTS-fallback.
  let vector: number[];
  try {
    vector = await embedTekst(vraag);
  } catch (e) {
    console.error("Hybride: query-embedding mislukt, terugval op FTS:", e);
    const r = await zoekViaFTS(vraag, maxResults, scope, filters, fondsFilter, opt);
    return {
      chunks: r.chunks,
      meta: { ...r.meta, embedding_query_success: false, fallback_reason: "embedding_error" },
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

  // Eén hybride RPC-poging. Geeft de gerangschikte chunks terug, of null bij een
  // RPC-fout (≠ leeg resultaat, dat is een lege array). SECURITY INVOKER → RLS
  // blijft gelden; p_document_ids scoopt vóór de fusion.
  async function draaiHybridePoging(
    ftsQ: string,
    emb: number[]
  ): Promise<DocumentChunk[] | null> {
    const { data, error } = await supabase.rpc("zoek_chunks_hybride", {
      p_query: ftsQ,
      p_embedding: naarVectorLiteral(emb),
      ...gedeeldeRpcParams,
    });
    if (error) {
      console.error("Hybride RPC-fout:", error);
      return null;
    }
    return Array.isArray(data) ? (data as ZoekChunkRij[]).map(rijNaarChunk) : [];
  }

  const pogingen: HybridePogingResultaat[] = [];
  const pogingMeta: NonNullable<RetrievalMeta["retrieval_pogingen"]> = [];

  // Poging 1 (primair): de (mogelijk geherformuleerde) vraag.
  const primair = await draaiHybridePoging(ftsQuery, vector);
  if (primair === null) {
    // RPC faalde → terugval op FTS (embedding lukte wél).
    const r = await zoekViaFTS(vraag, maxResults, scope, filters, fondsFilter, opt);
    return {
      chunks: r.chunks,
      meta: { ...r.meta, embedding_query_success: true, fallback_reason: "rpc_error" },
    };
  }
  pogingen.push({ naam: "primair", chunks: primair });
  pogingMeta.push({ naam: "primair", query: ftsQuery, rijen: primair.length });

  // Poging 2 (M-R3): bij een geherformuleerde vraag draaien we OOK de originele
  // vraag en fuseren, zodat de reformulatie alleen recall kan toevoegen. Faalt de
  // embedding van de originele vraag, dan blijft de primaire poging staan
  // (non-destructief). De M1-FTS-terugval uit de recall-opdracht komt later als
  // derde poging op exact deze plek erbij (zelfde bovengrens, zelfde fusie).
  const origineel = opties?.origineleVraag?.trim();
  if (origineel && origineel !== vraag.trim()) {
    if (pogingen.length < MAX_HYBRIDE_POGINGEN) {
      const { ftsQuery: origFts } = ftsQueryVoor(origineel, opt);
      try {
        const origVec = await embedTekst(origineel);
        const origChunks = await draaiHybridePoging(origFts, origVec);
        if (origChunks === null) {
          pogingMeta.push({ naam: "origineel", query: origFts, rijen: null });
        } else {
          pogingen.push({ naam: "origineel", chunks: origChunks });
          pogingMeta.push({ naam: "origineel", query: origFts, rijen: origChunks.length });
        }
      } catch (e) {
        console.error("Hybride: embedding originele vraag mislukt (M-R3), primair blijft:", e);
        pogingMeta.push({ naam: "origineel", query: origFts, rijen: null, overgeslagen: true });
      }
    } else {
      pogingMeta.push({ naam: "origineel", query: origineel, rijen: null, overgeslagen: true });
    }
  }

  // Fusie van alle pogingen (union op id, beste RRF-rang wint, deterministisch).
  const { chunks: gefuseerd, herkomstPerId } = fuseerHybridePogingen(pogingen);

  if (gefuseerd.length === 0) {
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
  const maxPerDoc = Math.max(3, Math.ceil(maxResults / 2));
  const fMeta = metaFilters(filters);
  const opt = volledigeOpties(opties);
  const peildatum = filters?.peildatum ?? vandaagISO();

  // Poging 1: gerangschikte RPC (Dutch FTS + ts_rank_cd).
  // p_document_ids = scope vóór ranking (null = hele bibliotheek).
  // Increment G — retrieval-filters vóór ranking in de RPC.
  // Increment T4 — p_fonds_id dwingt de fondsgrens al in de RPC af.
  // R1.4 — de FTS-query is hier (evt.) jargon-verbreed (websearch-arm).
  const { ftsQuery, jargon } = ftsQueryVoor(vraag, opt);
  const { data, error } = await supabase.rpc("zoek_chunks", {
    p_query: ftsQuery,
    p_limit: overFetch,
    p_document_ids: scope,
    ...rpcFilterParams(filters),
    p_fonds_id: fondsFilter,
  });

  if (!error && Array.isArray(data) && data.length > 0) {
    const gerangschikt = (data as ZoekChunkRij[]).map(rijNaarChunk);
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
  // waar streng zoeken niets oplevert.
  const terugval = bouwTerugvalFtsQuery(vraag);
  if (terugval) {
    const { data: dataT, error: errorT } = await supabase.rpc("zoek_chunks", {
      p_query: terugval.query,
      p_limit: overFetch,
      p_document_ids: scope,
      ...rpcFilterParams(filters),
      p_fonds_id: fondsFilter,
    });

    if (!errorT && Array.isArray(dataT) && dataT.length > 0) {
      const gerangschikt = (dataT as ZoekChunkRij[]).map(rijNaarChunk);
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
    const { data: data2, error: error2 } = await q2;

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
    const { data: data3 } = await q3;

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
export function maakContext(
  chunks: DocumentChunk[],
  startIndex = 0,
  sentinel: string = maakBronSentinel()
): {
  contextTekst: string;
  bronnen: BronVerwijzing[];
  geneutraliseerd: number;
  sentinel: string;
} {
  if (chunks.length === 0) {
    return {
      contextTekst: "Er zijn geen relevante documenten gevonden in de bibliotheek.",
      bronnen: [],
      geneutraliseerd: 0,
      sentinel,
    };
  }

  const bronnen: BronVerwijzing[] = [];
  const contextDelen: string[] = [];
  let geneutraliseerdTotaal = 0;

  chunks.forEach((chunk, index) => {
    const doc = chunk.documenten;
    const bronLabel = `[Bron ${startIndex + index + 1}]`;
    const locatie = [
      chunk.paragraaf && `${chunk.paragraaf}`,
      chunk.pagina && `pag. ${chunk.pagina}`,
    ]
      .filter(Boolean)
      .join(", ");

    // Increment D — notulensegmenten dragen een agendapunt-specifieke bronvermelding
    // ("Vastgestelde notulen [verg], agendapunt N — [titel]"); overige chunks houden
    // het bestaande "[bron] — [titel]"-label.
    const bronTitel = chunk.notulen
      ? notulenBronLabel(
          chunk.notulen.vergadering_titel,
          chunk.notulen.agendapunt_volgnummer,
          chunk.notulen.agendapunt_titel
        )
      : `${doc.bron} — ${doc.titel}`;

    // Increment G — generieke bronnen expliciet labelen, zodat het model ze niet
    // presenteert als door het fonds bestuurlijk vastgesteld (#22/#23). Het label
    // staat in de contextregel; de gestructureerde velden gaan mee in `bronnen`.
    const bronsoortLabel =
      doc.bibliotheek === "generiek"
        ? ` [generiek/extern kader${doc.bronorganisatie ? ` — ${doc.bronorganisatie}` : ""}]`
        : "";

    // R1.6 — is de treffer uitgebreid tot zijn structuur-unit, dan leveren we die
    // samengevoegde passage als brontekst; het bronlabel/locatie/fragment-preview
    // blijft op de treffer-chunk. Bewuste small-to-big-afweging: de aangeleverde
    // passage kan tekst van een náást-liggende pagina/paragraaf bevatten, terwijl
    // de getoonde locatie die van de treffer-chunk is. De citatie-ANKER (welk
    // document/welke unit) blijft dus exact; de pagina-aanduiding kan de bredere
    // unit onder-specificeren. Alleen achter de parent-vlag; kale chunk = default.
    const ruweBrontekst = chunk.aangeleverde_passage ?? chunk.tekst;
    const { tekst: brontekst, geneutraliseerd } = neutraliseerBrontekst(ruweBrontekst);
    geneutraliseerdTotaal += geneutraliseerd;

    // H-10: elke bron in een eigen, met een onvoorspelbare sentinel afgebakend
    // blok. Alles tussen de openings- en sluittag is DATA, nooit instructie.
    const kop = `${bronLabel} ${bronTitel}${bronsoortLabel}${locatie ? ` (${locatie})` : ""}`;
    contextDelen.push(
      `<bron s="${sentinel}" nr="${startIndex + index + 1}">\n${kop}:\n${brontekst}\n</bron s="${sentinel}">`
    );

    bronnen.push({
      document_id: chunk.document_id,
      titel: chunk.notulen ? bronTitel : doc.titel,
      bron: doc.bron,
      pagina: chunk.pagina,
      paragraaf: chunk.paragraaf,
      // Het citaat is sinds tranche 2 het bewijsstuk in de hover-preview op de
      // pill: afkappen op een zinsgrens i.p.v. blind op 150 tekens, en alleen
      // een beletselteken als er écht is afgekapt (zie core/lib/bronfragment.ts).
      // Bewust de KALE chunk-tekst, niet `aangeleverde_passage`: de vindplaats
      // die erbij staat is die van de treffer-chunk.
      fragment: bouwBronfragment(chunk.tekst),
      heeft_origineel: !!doc.opslag_pad,
      documentstatus: doc.documentstatus ?? null,
      bronstatus: doc.bronstatus ?? null,
      documentdatum: doc.documentdatum ?? null,
      geldig_tot: doc.geldig_tot ?? null,
      bibliotheek: doc.bibliotheek ?? null,
      bronorganisatie: doc.bronorganisatie ?? null,
      normgewicht: doc.normgewicht ?? null,
      extern_url: doc.extern_url ?? null,
      // Tranche 2B — doorgeefvelden voor de documentlijst. Ze staan hier ná de
      // context-opbouw hierboven en raken die niet: `contextTekst` wordt uit
      // expliciet benoemde velden gebouwd, het bronnen-array wordt nergens
      // geserialiseerd. Zie verrijkDocumentmetadata().
      documenttype: doc.documenttype ?? null,
      bestandstype: doc.bestandstype ?? null,
    });
  });

  return {
    contextTekst: contextDelen.join("\n\n"),
    bronnen,
    geneutraliseerd: geneutraliseerdTotaal,
    sentinel,
  };
}

// Haalt ALLE chunks van de gescopete document(en) op, geordend op document en
// chunk-index — voor de dekkingsbrede strategieën van increment 2 (full-document
// en map-reduce). Géén ranking: bij een samenvatting/beoordeling wil je het
// volledige document, niet de top-N. RLS blijft leidend (anon-client); de
// scope-filter (`.in("document_id", …)`) is een AND bovenop de fonds-isolatie.
// Increment T4 — `fondsId` (server-side geresolveerd; body genegeerd) dwingt de
// fonds-discipline ook op dit dekkingsbrede pad af. Dit pad loopt NIET via de RPC
// (met p_fonds_id), dus de app-guard (handhaafFondsdiscipline) is hier de enige
// expliciete laag náást RLS. De select levert daarom fonds_id + document-/bronstatus.
export async function haalDocumentChunks(
  documentIds: string[],
  fondsId: string | null = null
): Promise<DocumentChunk[]> {
  if (documentIds.length === 0) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("document_chunks")
    .select(
      `id, document_id, tekst, pagina, paragraaf, chunk_index,
       documenten!inner(titel, bron, bibliotheek, opslag_pad, fonds_id, documentstatus:status, bronstatus, volgende_review)`
    )
    .in("document_id", documentIds)
    .eq("documenten.actief", true)
    .order("document_id", { ascending: true })
    .order("chunk_index", { ascending: true })
    .limit(5000); // veiligheidsplafond tegen extreem grote documenten

  if (error || !data) {
    console.error("haalDocumentChunks fout:", error);
    return [];
  }
  const chunks = data as unknown as DocumentChunk[];
  const fondsFilter = fondsId && fondsId.length > 0 ? fondsId : null;
  return handhaafFondsdiscipline(chunks, fondsFilter).chunks;
}

// ── Plateau B / G3 — de bevroren reflectiebronset ──────────────────────────
// Tijdens een actieve reflectieflow wordt er GEEN retrieval gedaan (FR-54): geen
// embedding, geen RPC, geen FTS, geen PostgREST-terugval. Retrieval op een zin
// als "ik maak mij zorgen over gepensioneerden" levert willekeurige treffers die
// vervolgens als bron worden getóónd — schijnzekerheid bovenop een twijfel.
//
// In plaats daarvan worden precies de chunks opgehaald die bij het oorspronkelijke
// antwoord zijn gebruikt, op ID. Deterministisch: geen ranking, geen selectie,
// geen drempel. Dat is strenger dan het filter dat het technisch ontwerp §6.3
// voorstelt (`p_document_ids` op de retrieval-RPC's): een filter kan worden
// omzeild door een pad dat de RPC niet gebruikt, deze aanpak niet — want er
// draait geen enkel retrievalpad.
//
// De fonds-discipline geldt onverkort (T4, besluit 0045). Dat is hier geen
// formaliteit: de bronset komt uit een logregel die dagen oud kan zijn. Is een
// document intussen ingetrokken, van fonds gewisseld of over zijn verplichte
// review heen, dan valt het hier alsnog af — de bevriezing bevriest de SELECTIE,
// niet de toegang.
export async function haalBevrorenChunks(
  chunkIds: string[],
  fondsId: string | null = null
): Promise<DocumentChunk[]> {
  if (chunkIds.length === 0) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("document_chunks")
    .select(
      `id, document_id, tekst, pagina, paragraaf, chunk_index,
       documenten!inner(titel, bron, bibliotheek, opslag_pad, fonds_id, documentstatus:status, bronstatus, volgende_review)`
    )
    .in("id", chunkIds)
    .eq("documenten.actief", true)
    .order("document_id", { ascending: true })
    .order("chunk_index", { ascending: true })
    .limit(200); // een bronset is de top-N van één antwoord, nooit een heel dossier

  if (error || !data) {
    console.error("haalBevrorenChunks fout:", error);
    return [];
  }
  const chunks = data as unknown as DocumentChunk[];
  const fondsFilter = fondsId && fondsId.length > 0 ? fondsId : null;
  return handhaafFondsdiscipline(chunks, fondsFilter).chunks;
}

// Increment D — verrijk opgehaalde chunks met de vergadering/agendapunt van hun
// bevestigde notulensegment, zodat maakContext de bronvermelding "Vastgestelde
// notulen [verg], agendapunt N — [titel]" kan renderen. De retrieval-RPC's
// (zoek_chunks/zoek_chunks_hybride) leveren dit NIET en blijven ongewijzigd; dit
// is één gebatchte vervolgquery op de chunk-id's. RLS-veilig (anon-client). Muteert
// de meegegeven chunks in-place en geeft ze terug.
export async function verrijkNotulenChunks(
  chunks: DocumentChunk[]
): Promise<DocumentChunk[]> {
  if (chunks.length === 0) return chunks;
  const supabase = await createServerSupabase();
  const ids = chunks.map((c) => c.id);

  const { data, error } = await supabase
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
    .not("notulen_segment_id", "is", null);

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
//  HARDE GRENS: deze velden zijn PURE DOORGEEFWAARDEN. Ze mogen niet worden
//  gelezen door retrieval, ranking, filtering of promptopbouw. De functie draait
//  ná handhaafFondsdiscipline en ná naVerwerking, en `maakContext()` bouwt de
//  modelcontext uit expliciet benoemde velden — het bronnen-array gaat nergens
//  door JSON.stringify.
// ============================================================================
/** Rijvorm van de verrijkingsquery. */
interface DocumentmetadataRij {
  id: string;
  fonds_id: string | null;
  bibliotheek: string | null;
  documenttype: string | null;
  bestandstype: string | null;
  documentdatum: string | null;
  geldig_tot: string | null;
  normgewicht: string | null;
  bronorganisatie: string | null;
  extern_url: string | null;
}

export async function verrijkDocumentmetadata(
  chunks: DocumentChunk[],
  fondsId: string | null = null
): Promise<DocumentChunk[]> {
  if (chunks.length === 0) return chunks;
  const ids = [...new Set(chunks.map((c) => c.document_id))];
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("documenten")
    .select(
      "id, fonds_id, bibliotheek, documenttype, bestandstype, documentdatum, geldig_tot, normgewicht, bronorganisatie, extern_url"
    )
    .in("id", ids);

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
