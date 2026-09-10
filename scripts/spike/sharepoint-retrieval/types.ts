// #353 — spike-uitbreidingen op het definitieve contract uit gemergde PR #352.
// De productiecode importeert deze map nooit; de boundarygate bewaakt dat.
import type { Bronresultaat, Toegangsbewijs } from "../../../core/lib/retrieval/contract";

export type SpikeRoute = "microsoft_search" | "drive_search_extract";
export type SpikeFase =
  | "na_zoeken"
  | "na_eerste_rechtencheck"
  | "na_content"
  | "voor_laatste_rechtencheck"
  | "voor_toelating";

export type SpikeFoutcategorie =
  | "geen_resultaten"
  | "buiten_scope"
  | "toestemming_geweigerd"
  | "configuratiefout"
  | "timeout"
  | "rate_limit"
  | "providerfout"
  | "annulering"
  | "versiebewijs_ontbreekt"
  | "onondersteund_bestand";

export type SpikeFoutcode =
  | "actor_of_tenant_mismatch"
  | "configuratie_gewijzigd"
  | "document_buiten_bron"
  | "document_niet_geregistreerd"
  | "document_gewijzigd"
  | "document_verwijderd"
  | "extractie_leeg"
  | "graph_annulering"
  | "graph_response"
  | "graph_timeout"
  | "graph_ratelimit"
  | "graph_toestemming"
  | "ongeldige_graph_url"
  | "ongeldige_preview_url"
  | "onveilig_vervolgpad"
  | "versie_ontbreekt";

export class SpikeError extends Error {
  constructor(
    readonly categorie: SpikeFoutcategorie,
    readonly code: SpikeFoutcode,
    options?: { cause?: unknown },
  ) {
    super(`SharePoint-retrievalspike: ${categorie}/${code}`, options);
    this.name = "SpikeError";
  }
}

/** Alleen de lokale mapping mag private Graph-identifiers bevatten. */
export interface SpikeDocumentMapping {
  fixtureCode: string;
  ref: string;
  itemId: string;
  titel: string;
  bestandstype: "docx" | "pdf" | "pptx" | "anders";
  geregistreerdMappad?: string;
  verwachteMappad?: string;
}

/**
 * Komt in een live run uit microsoft_private via de bestaande vaultgrens.
 * Tests injecteren dezelfde vorm. Geen instantie hiervan mag worden gelogd.
 */
export interface SpikeBronSnapshot {
  fondsId: string;
  actorId: string;
  tenantId: string;
  bronId: string;
  status: "actief" | "fout" | "toestemming_nodig" | "ontkoppeld";
  configuratieversie: number;
  siteId: string;
  siteHostnaam: string;
  driveId: string;
  driveNaam: string;
  rootItemId: string;
  documenten: SpikeDocumentMapping[];
}

export interface DelegatedToken {
  accessToken: string;
  tenantId: string;
  actorObjectId: string;
}

export type SpikeToegangsbewijs = Toegangsbewijs & { basis: "delegated_user" };

/** Het echte Bronresultaat, aangevuld met uitsluitend een synthetische meetcode. */
export interface SpikeBronresultaat extends Bronresultaat {
  fixtureCode: string;
  bronsoort: "sharepoint";
  versie: {
    soort: "etag" | "ctag";
    waarde: string;
    gecontroleerdOp: string;
  };
  toegangscontrole: SpikeToegangsbewijs;
  previewMogelijk: true;
}

export interface GraphMeting {
  calls: number;
  responseBytes: number;
  contentBytes: number;
  throttles: number;
  retries: number;
}

export interface SpikeUitkomst {
  route: SpikeRoute;
  provider: "microsoft";
  methode: "sharepoint_live";
  kandidaten: SpikeBronresultaat[];
  latencyMs: number;
  fout?: SpikeFoutcategorie;
  foutcode?: SpikeFoutcode;
  meting: GraphMeting;
}

export interface SpikeVraag {
  code: string;
  soort: "gericht" | "fondsbreed" | "meerdere_documenten" | "versieconflict" | "powerpoint" | "pdf" | "negatief";
  vraag: string;
  verwachteFixtures: string[];
  maxKandidaten?: number;
}

/** Inhoudsvrije vorm die veilig als meetbewijs mag worden opgeslagen. */
export interface VeiligeMeetrij {
  ronde: number;
  vraagcode: string;
  route: SpikeRoute;
  resultaat: "geslaagd" | "geen_resultaten" | "mislukt";
  foutcategorie: SpikeFoutcategorie | null;
  foutcode: SpikeFoutcode | null;
  gevondenFixtures: string[];
  recall: number;
  locatorDekking: number;
  versieDekking: number;
  previewDekking: number;
  latencyMs: number;
  microsoftCalls: number;
  responseBytes: number;
  contentBytes: number;
  throttles: number;
  retries: number;
  versieVingerafdrukken: string[];
}
