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
import type { DocumentChunk, RetrievalFilters, RetrievalMeta, BronVerwijzing } from "../rag";
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
  /** Harde bovengrens op het aantal kandidaten dat de adapter mag teruggeven. */
  maxKandidaten: number;
  /** Documentscope voor déze query; `undefined` = de hele toegestane bibliotheek. */
  documentIds?: string[];
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
  documentIdentiteit: { documentId: string; bibliotheek?: string | null; bron?: string | null };
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
   * T2-1 — de onderliggende chunk. Zolang de Supabase-adapter de enige
   * productieadapter is, draagt de orkestratie deze mee zodat selectie,
   * parent-retrieval en citaatvorming byte-identiek blijven aan vóór de
   * verplaatsing. Een Microsoftresultaat draagt hem niet.
   */
  chunk?: DocumentChunk;
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

/** Wat de ORKESTRATIE oplevert; het enige dat de generatielaag te zien krijgt. */
export interface RetrievalUitkomst {
  kandidaten: Bronresultaat[];
  geselecteerd: Bronresultaat[];
  /** Bestaande vorm, ongewijzigd voor C1/C7. */
  bronverwijzingen: BronVerwijzing[];
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

export interface RetrievalAdapter {
  readonly naam: "supabase-rag" | "microsoft-sharepoint";
  capabilities(): AdapterCapabilities;
  zoek(ctx: RetrievalContext, query: RetrievalQuery): Promise<AdapterUitkomst>;
}

/** Hulptype voor de orkestratie: de modus die de filters dragen. */
export type { RetrievalModus };
