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
  origineleVraag: string;
  /** Gevalideerd/geherformuleerd. Kan de scope NOOIT wijzigen. */
  zoekvraag: string;
  filters?: RetrievalFilters;
  strategie: Retrievalstrategie;
  /**
   * Harde bovengrens op het aantal kandidaten dat de adapter TERUGGEEFT. Een
   * adapter mag intern ruimer ophalen (de Supabase-RPC overfetcht 3×) — dat is
   * zijn eigen zaak — maar wat het contract verlaat is begrensd, en de
   * orkestratie kapt alsnog af met `truncatie.reden = "kandidaten"`.
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
  /** Moment waarop de VERSIE is vastgesteld — niet de rechtencheck. */
  gecontroleerdOp: string;
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
  /** Bestaande audit-vorm, byte-compatibel met vóór de verplaatsing. */
  meta: RetrievalMeta;
}

/** VOLTOOID. Het enige dat de generatielaag mag gebruiken. */
export interface RetrievalUitkomst extends RetrievalTussenresultaat {
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
}

export interface CitaatResultaat {
  resultaten: Bronresultaat[];
  contextTekst: string;
  bronverwijzingen: BronVerwijzing[];
  sentinel: string;
  geneutraliseerd: number;
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
    geselecteerd: Bronresultaat[]
  ): Promise<{ resultaten: Bronresultaat[]; meta?: Partial<RetrievalMeta> }>;
  /**
   * Providercorrecte weergave van de geselecteerde passages. De ORKESTRATIE
   * bepaalt wát geciteerd wordt en in welke volgorde; de adapter weet hoe zijn
   * eigen bron eruitziet. Zo blijft `DocumentChunk` buiten het contract.
   */
  citeer(
    ctx: RetrievalContext,
    geselecteerd: Bronresultaat[],
    opdracht: CitaatOpdracht
  ): Promise<CitaatResultaat>;
}

/** Hulptype voor de orkestratie: de modus die de filters dragen. */
export type { RetrievalModus };

/** Ten minste één query — een lege lijst is door het type onmogelijk. */
export type Queries<T> = readonly [T, ...T[]];
