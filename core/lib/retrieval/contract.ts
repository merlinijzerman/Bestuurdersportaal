// ============================================================================
//  #322 F4-T2-1 — Het providerneutrale retrievalcontract.
// ----------------------------------------------------------------------------
//  SERVER-ONLY. Ontwerp: RETRIEVALCONTRACT-F4-ONTWERP.md §4, besluit 0213.
//
//  De kernscheiding (besluit 0213 punt 5): een ADAPTER levert kandidaten, de
//  ORKESTRATIE selecteert, voegt samen, citeert en schrijft het auditspoor.
//  Gaf `zoek()` de volledige uitkomst terug, dan kon elke provider zijn eigen
//  selectie- en citatieregels meebrengen — precies de divergentie die dit
//  contract opheft.
//
//  Wat hier NOOIT in mag: providertokens, endpoints, ruwe Graph-/Search-
//  responses of database-implementatiedetails.
// ============================================================================
import type { RetrievalFilters, RetrievalMeta, BronVerwijzing } from "../rag";
import type { Actor, Taaktype } from "../ai-gateway/contract";
import type { RetrievalModus } from "../vraagtype";

export type Bronsoort = "fonds" | "generiek" | "sharepoint" | "notulen" | "web";
export type Retrievalstrategie = "gericht" | "volledig" | "vergelijk" | "bevroren";

/** Welke bronsoorten dit fonds mag raadplegen; komt uit de fondsconfiguratie. */
export interface Bronbeleid {
  bronsoorten: Bronsoort[];
}

/**
 * Server-side vastgesteld, nooit uit de request-body. `correlationId` is
 * dezelfde waarde die naar de AI-gateway en het governancespoor gaat, zodat
 * retrieval → generatie → audit aan één identiteit hangen.
 */
export interface RetrievalContext {
  fondsId: string;
  actor: Actor;
  taaktype: Taaktype;
  bronbeleid: Bronbeleid;
  /**
   * DE ENIGE bron van waarheid voor scope. Stond hij ook op de query, dan
   * konden twee waarden uiteenlopen en zou een gescopete beurt stil breder
   * kunnen zoeken dan de gebruiker koos.
   */
  scope?: {
    documentIds?: string[];
    vergaderingId?: string;
    agendapuntId?: string;
    procesId?: string;
    bevrorenChunkIds?: string[];
  };
  correlationId: string;
  /** T2-1/PR-B: de samengestelde afbraak- én deadlinegrendel over de hele keten. */
  signal?: AbortSignal;
}

/**
 * Eén zoekopdracht. C1 stuurt er twee (primair spoor + aanvullende
 * bibliotheek); de orkestratie voegt ze deterministisch samen.
 */
export interface RetrievalQuery {
  /** Herkenbaar label voor audit en diagnostiek, bv. "primair" of "aanvullend". */
  naam: string;
  /**
   * SCOPE PER SPOOR, server-side vastgesteld. C1 draait het primaire spoor op de
   * gekozen documenten en het aanvullende spoor bewust ZONDER documentscope —
   * dat is juist de verbreding naar de bibliotheek. Eén gedeelde scope op de
   * context zou dat aanvullende spoor mee-scopen en de verbreding stil opheffen.
   *
   * DE ADAPTER LEEST DIT VELD NIET. De orkestratie zet het in de afgeleide
   * spoorcontext; `ctx.scope.documentIds` is de enige bron van waarheid voor
   * een adapter. Twee leesplekken zouden opnieuw uiteen kunnen lopen.
   */
  documentScope?: string[];
  origineleVraag: string;
  /** Gevalideerd/geherformuleerd. Kan de scope NOOIT wijzigen. */
  zoekvraag: string;
  filters?: RetrievalFilters;
  strategie: Retrievalstrategie;
  /**
   * Omvang van de EINDSELECTIE: hoeveel passages er uiteindelijk de prompt in
   * gaan. Dit is wat vóór T2-1 `maxResults` heette.
   */
  maxResultaten: number;
  /**
   * Omvang van de KANDIDATENPOOL die de adapter mag teruggeven. Bewust ruimer
   * dan `maxResultaten` — vuistregel `max(3 × maxResultaten, 20)` — want de
   * centrale weging (bronsoort, regime, representatie) mag een kandidaat van
   * plek 15 alsnog in de top halen. Kapte de orkestratie hier terug naar
   * `maxResultaten`, dan zou die promotie verdwijnen en verandert de selectie
   * stil ten opzichte van vóór T2-1.
   */
  maxKandidaten: number;
  /**
   * Harde bovengrens op de omvang van de modelcontext (ontwerp §4.1). De
   * orkestratie kapt de geselecteerde passages af zodra de som deze grens
   * overschrijdt en meldt `truncatie.reden = "tekens"`.
   */
  maxContextTekens: number;
  /** Per-query hybride-stand; `undefined` = de fonds-/env-default. */
  hybrideAan?: boolean;
}

/** Twee gescheiden bewijzen met gescheiden tijdstippen — zie ontwerp §4.1. */
export interface Versiebewijs {
  soort: "etag" | "ctag" | "hash" | "status-datum" | "onbekend";
  waarde: string | null;
  /**
   * Moment waarop de VERSIE is vastgesteld — niet de rechtencheck. **`null` =
   * onbekend**, en dat is een geldige uitkomst: op het Supabase-pad bestaat er
   * (tot T2-3/R1) geen controlemoment. Een lege string zou een tijdstempel
   * suggereren die er niet is, en de toelatingspoort van PR-C gaat hierop
   * toetsen — dan is schijnzekerheid het gevaarlijkst.
   */
  gecontroleerdOp: string | null;
}

/**
 * Rechtenbewijs, gebonden aan actor én verzoek. Zonder `gebruikerId` en
 * `correlationId` zou een verse, op zichzelf geldige proof van een andere
 * gebruiker of uit een eerdere request door de toelatingspoort komen.
 * Geldigheid: ontwerp §4.2.1, voorwaarden V1–V5.
 */
export interface Toegangsbewijs {
  toegestaan: true;
  gebruikerId: string;
  correlationId: string;
  gecontroleerdOp: string;
  basis: "delegated_user" | "rls";
  bronconfiguratieVersie: number;
}

export interface Bronresultaat {
  /** Lokale, fondsgebonden referentie (chunk-id of sharepoint_documenten.id). */
  ref: string;
  bronsoort: Bronsoort;
  titel: string;
  documentIdentiteit: { documentId: string; bibliotheek?: string | null; bron?: string | null; fondsId?: string | null };
  versie: Versiebewijs;
  /** Verplicht zodra de adapter `permissionProof` claimt (§4.2.1). */
  toegangscontrole?: Toegangsbewijs;
  locator: { pagina?: number | null; paragraaf?: string | null; mappad?: string; chunkIndex?: number };
  /** Geneutraliseerd en begrensd. */
  passage: string;
  status: {
    documentstatus?: string | null;
    bronstatus?: string | null;
    geldigTot?: string | null;
    actueel: boolean;
  };
  rang: { positie: number; score?: number | null; fts?: number | null; vec?: number | null; poging?: string };
  /** SharePoint: alleen `true` ná een geslaagde permission-check. */
  previewMogelijk?: boolean;
  /**
   * BRONBELEID-gegevens die de selectie stuurt: sectorcuratie (`normgewicht`)
   * en het wettelijk regime. Bewust hier en niet in een providerspecifieke
   * bijlage — het zijn beleidsbegrippen, geen opslagvorm, en de weging hoort
   * centraal (zie de kop van selectie.ts).
   */
  curatie?: { normgewicht?: string | null; wettelijkRegime?: string | null };
  /**
   * WEERGAVEMETADATA voor de centrale citaatopbouw. De adapter levert de
   * gegevens; de orkestratie bepaalt als enige de VORM — nummering, sentinel,
   * neutralisatie en `BronVerwijzing`. Zou de adapter dat zelf doen, dan kan
   * elke provider bronlabels simuleren, neutralisatie overslaan of een andere
   * citaat-ID-semantiek gebruiken: precies de divergentie die dit contract
   * moet voorkomen.
   */
  weergave?: {
    bronorganisatie?: string | null;
    documentdatum?: string | null;
    opslagPad?: string | null;
    externUrl?: string | null;
    documenttype?: string | null;
    bestandstype?: string | null;
    /** Notulensegment: levert een eigen bronvermelding. */
    notulen?: { vergaderingTitel: string; agendapuntVolgnummer: number | null; agendapuntTitel: string | null } | null;
    /**
     * R1.6 small-to-big: de tot de structuur-unit uitgebreide passage. Is hij
     * gezet, dan gaat DEZE tekst de prompt in — en telt hij dus ook mee voor de
     * contextgrens. `passage` blijft de kale treffer, want die draagt het
     * fragment en de vindplaats in de bronkaart.
     */
    aangeleverdePassage?: string | null;
  };
}

export type RetrievalFoutcategorie =
  | "geen_resultaten"
  | "buiten_scope"
  | "toestemming_geweigerd"
  | "configuratiefout"
  | "timeout"
  | "rate_limit"
  | "providerfout"
  | "truncatie"
  | "annulering";

export interface AdapterCapabilities {
  bronsoorten: Bronsoort[];
  strategieen: Retrievalstrategie[];
  /** Een filter dat hier niet in staat is een FOUT, nooit een stille no-op. */
  ondersteundeFilters: (keyof RetrievalFilters)[];
  versiebewijs: boolean;
  permissionProof: boolean;
  preview: boolean;
  cancellation: boolean;
  timeout: boolean;
}

/**
 * Wat een ADAPTER teruggeeft. Bewust géén `geselecteerd`, `bronverwijzingen` of
 * `meta`: dat zijn taken van de orkestratie (besluit 0213 punt 5).
 */
export interface AdapterUitkomst {
  kandidaten: Bronresultaat[];
  methode: RetrievalMeta["methode"] | "sharepoint_live" | "geen";
  provider: "supabase" | "microsoft" | "geen";
  latencyMs: number;
  truncatie?: { reden: "kandidaten" | "tijd" | "annulering" };
  fout?: RetrievalFoutcategorie;
  /**
   * Adapterspecifieke diagnostiek die de orkestratie ONGEWIJZIGD in het
   * auditspoor opneemt. Voor de Supabase-adapter is dit het bestaande
   * `RetrievalMeta`-restant (filters, fondsdiscipline, rerank, drempel, pogingen).
   */
  diagnostiek?: Partial<RetrievalMeta>;
  /** Aantal kandidaten vóór selectie — voedt `RetrievalMeta.opgehaald`. */
  opgehaald: number;
}

/**
 * ONVOLTOOID. Wat `voerRetrievalUit` oplevert: de selectie staat vast, maar er
 * zijn nog geen citaties. Bewust een EIGEN type en geen `RetrievalUitkomst` met
 * een lege lijst — een half resultaat mag niet typecompatibel zijn met wat de
 * generatielaag mag gebruiken.
 */
export interface RetrievalTussenresultaat {
  kandidaten: Bronresultaat[];
  geselecteerd: Bronresultaat[];
  perAdapter: {
    naam: RetrievalAdapter["naam"];
    query: string;
    methode: AdapterUitkomst["methode"];
    latencyMs: number;
    kandidaten: number;
    fout?: RetrievalFoutcategorie;
  }[];
  latencyMs: number;
  truncatie?: { reden: "kandidaten" | "tekens" | "tijd" | "annulering" };
  fout?: RetrievalFoutcategorie;
  /**
   * Auditvorm over de op DIT moment geselecteerde bronnen. Kapt de
   * contextopbouw later blokken af, dan bouwt `citeer()` deze meta opnieuw op
   * exact de opgenomen bronnen — anders noemt het auditspoor bronnen die nooit
   * naar het model zijn gegaan.
   */
  meta: RetrievalMeta;
  /** De gezaghebbende contextgrens, overgenomen van de primaire query. */
  maxContextTekens: number;
  /**
   * De afbreekgrendel van DEZE beurt — een LEVEND handvat, geen waarde. Hij is
   * GELEEND: `voerVolledigeRetrievalUit()` maakt hem, geeft hem aan beide fasen
   * en sluit hem in zijn eigen `finally`. Geen van beide fasen is eigenaar.
   *
   * Hij loopt door tot en met de citaatvorming, want de weergaveverrijking en
   * de contextopbouw doen nog database-werk en horen binnen dezelfde deadline.
   *
   * `RetrievalUitkomst` draagt hem bewust niet. Een grendel in het eindresultaat
   * zou een handvat zijn waarvan de ontvanger de levensduur niet kent — en het
   * hoort niet thuis in een object dat verder alleen data is en gelogd wordt.
   */
  grendel?: import("./afbreken").Afbreekgrendel;
  /** Ingrediënten om de meta opnieuw te bouwen na afkappen. Intern. */
  metaBasis: {
    methode: RetrievalMeta["methode"];
    opgehaald: number;
    diagnostiek: Partial<RetrievalMeta>;
    extra: Partial<RetrievalMeta>;
    primaireRefs: ReadonlySet<string>;
    meerdereSporen: boolean;
  };
}

/**
 * VOLTOOID. Het enige dat de generatielaag mag gebruiken.
 *
 * `Omit<…, "grendel">`: het eindresultaat is pure data. De grendel is een
 * levend handvat dat bij de afronding is gesloten; hem meedragen nodigt uit tot
 * gebruik ná zijn levensduur.
 */
export interface RetrievalUitkomst extends Omit<RetrievalTussenresultaat, "grendel"> {
  /** Bestaande vorm, ongewijzigd voor C1/C7. */
  bronverwijzingen: BronVerwijzing[];
  contextTekst: string;
  sentinel: string;
  geneutraliseerd: number;
}

/** Wat de citaatvorming van de route meekrijgt — data, geen logica. */
export interface CitaatOpdracht {
  primaireDocumentIds: ReadonlySet<string>;
  peildatum: string;
  hoofddocumentLabel: string;
  /** Vaste sentinel (tests); anders per beurt onvoorspelbaar. */
  sentinel?: string;
  startIndex?: number;
}

export interface RetrievalAdapter {
  readonly naam: "supabase-rag" | "microsoft-sharepoint";
  capabilities(): AdapterCapabilities;
  zoek(ctx: RetrievalContext, query: RetrievalQuery): Promise<AdapterUitkomst>;
  /**
   * Providerspecifieke uitbreiding van de SELECTIE — voor Supabase de
   * parent-context (siblings uit `document_chunks`). Draait per spoor, direct
   * ná de selectie. Een adapter die niets uit te breiden heeft, laat hem weg.
   */
  verrijkSelectie?(
    ctx: RetrievalContext,
    geselecteerd: Bronresultaat[],
    /** De peildatum van DIT spoor. Nooit "vandaag" afleiden: dan zou een
     *  historische retrieval ongemerkt met de datum van nu worden verrijkt. */
    opties: { peildatum: string }
  ): Promise<{ resultaten: Bronresultaat[]; meta?: Partial<RetrievalMeta> }>;
  /**
   * Providerspecifieke WEERGAVEMETADATA aanvullen (notulenlabel, documenttype,
   * de uitgebreide parent-passage). De adapter levert gegevens; hij bouwt GEEN
   * citaties. Nummering, sentinel, neutralisatie en `BronVerwijzing` zijn
   * exclusief van de orkestratie.
   */
  verrijkWeergave?(ctx: RetrievalContext, geselecteerd: Bronresultaat[]): Promise<Bronresultaat[]>;
}

/** Hulptype voor de orkestratie: de modus die de filters dragen. */
export type { RetrievalModus };

/** Ten minste één query — een lege lijst is door het type onmogelijk. */
export type Queries<T> = readonly [T, ...T[]];
