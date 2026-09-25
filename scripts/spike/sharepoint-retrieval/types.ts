// #353 — spike-uitbreidingen op het definitieve contract uit gemergde PR #352.
// Alleen de ene Preview-only serverbrug mag deze map importeren; de boundarygate
// verbiedt elk chat-, zoek-, vergelijk- of productieadapterpad.
import type { Bronresultaat, Toegangsbewijs } from "../../../core/lib/retrieval/contract";

export type SpikeRoute = "microsoft_search" | "drive_search_extract" | "candidate_union";
/**
 * #407 — de Copilot Retrieval API is een vierde MEETARM, geen vierde waarde van
 * `SpikeRoute`. `SpikeRoute` verbreden zou de typecheck van de Preview-brug
 * breken (die geeft een `VeiligeMeetrij` terug als `SharePointRetrievalVeiligeMeting`
 * met exact drie routes) en daarmee live-retrievalproductiecode raken. De
 * vergelijkingslaag gebruikt daarom een eigen, bredere routeaanduiding.
 */
export type SpikeCopilotRoute = "copilot_retrieval";
export type SpikeVergelijkRoute = SpikeRoute | SpikeCopilotRoute;
export type MicrosoftSearchScope = "tenant" | "site_list" | "path";
export type SpikeActualiteitsbeleid = "alleen_actueel" | "alleen_historisch" | "actueel_en_historisch";
export type SpikeFixtureStatus = "actueel" | "historisch";

export const SPIKE_AFWIJSCATEGORIEEN = [
  "mapping",
  "binding",
  "root",
  "rechten_configuratie",
  "versie",
  "extractie",
  "preview",
  "actualiteit",
  // #407 — negende categorie, uitsluitend bereikbaar via de Copilot-meetarm: een
  // Microsoft-extract dat niet uniek in de eigen, actuele extractie terug te
  // vinden is. De drie bestaande routes bieden geen extract aan en houden deze
  // teller dus altijd op 0. De auditprojectie van de Preview-brug blijft de
  // acht vaste platte `afwijzing_*`-velden gebruiken en verandert niet.
  "lokalisatie",
] as const;
export type SpikeAfwijscategorie = typeof SPIKE_AFWIJSCATEGORIEEN[number];
export type SpikeAfwijzingen = Record<SpikeAfwijscategorie, number>;
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
  | "graph_bad_request"
  | "graph_response"
  | "graph_timeout"
  | "graph_ratelimit"
  | "graph_toestemming"
  | "ongeldige_download_url"
  | "ongeldige_graph_url"
  | "ongeldige_preview_url"
  | "onveilig_vervolgpad"
  | "versie_ontbreekt"
  // #407 — Copilot Retrieval-meetarm.
  | "copilot_filter_ongeldig"
  | "copilot_budget_overschreden"
  | "copilot_vraag_ongeldig"
  // 401/403: NIET tot één oorzaak te herleiden — ontbrekend/ingetrokken consent
  // óf een ontbrekende Copilot-licentie. Bewust neutraal.
  | "copilot_toegang_geweigerd"
  // Uitsluitend 402 (Payment Required): eenduidig licentie-/billingsignaal.
  | "copilot_licentie_of_billing"
  | "copilot_response";

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
  /** Serververtrouwde teststatus. De Preview-brug koppelt deze uitsluitend op
   * fixturecode; nooit vanuit browserinvoer, naam, pad of versievelden. */
  fixtureStatus: SpikeFixtureStatus;
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
  /** Private Microsoft Entra-object-id die bij actorId hoort; nooit loggen. */
  microsoftActorObjectId: string;
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
  downloads: number;
  responseBytes: number;
  contentBytes: number;
  throttles: number;
  retries: number;
}

export interface SpikeUitkomstBasis<R extends SpikeVergelijkRoute> {
  route: R;
  searchScope: MicrosoftSearchScope | null;
  provider: "microsoft";
  methode: "sharepoint_live";
  kandidaten: SpikeBronresultaat[];
  kandidatenVoorVerificatie: number;
  latencyMs: number;
  fout?: SpikeFoutcategorie;
  foutcode?: SpikeFoutcode;
  afwijzingen: SpikeAfwijzingen;
  meting: GraphMeting;
}

export type SpikeUitkomst = SpikeUitkomstBasis<SpikeRoute>;

/**
 * #407 — uitkomst van de Copilot Retrieval-meetarm. Dezelfde vorm als de drie
 * bestaande routes, aangevuld met uitsluitend inhoudsvrije extracttellingen.
 * Extracttekst zelf verlaat de verificatieketen nooit.
 */
export interface SpikeCopilotUitkomst extends SpikeUitkomstBasis<SpikeCopilotRoute> {
  searchScope: null;
  /** Aantal extracts dat Microsoft aanbood voor hits die de root-prefilter haalden. */
  aangebodenExtracts: number;
  /** Aantal daarvan dat uniek in de eigen, actuele extractie is teruggevonden. */
  gelokaliseerdeExtracts: number;
}

/** Uitsluitend inhoudsvrij bewijs voor de delegated permissionprobe. */
export interface PermissionProbeUitkomst {
  status: "toegestaan" | SpikeFoutcategorie;
  foutcode: SpikeFoutcode | null;
  latencyMs: number;
  microsoftCalls: number;
}

export interface SpikeVraag {
  code: string;
  soort: "gericht" | "fondsbreed" | "meerdere_documenten" | "versieconflict" | "powerpoint" | "pdf" | "negatief";
  vraag: string;
  /** Expliciet server-side beleid; nooit afgeleid uit soort of vraagtekst. */
  actualiteitsbeleid: SpikeActualiteitsbeleid;
  /** Vaste, server-side termen voor DriveItem search. Meerdere termen worden
   * afzonderlijk gezocht en daarna stabiel ontdubbeld. */
  driveZoektermen?: readonly string[];
  /** Vaste, server-side varianten voor Microsoft Search. De vrije browserinvoer
   * kan deze lijst niet leveren of het KQL-pad wijzigen. */
  microsoftZoektermen?: readonly string[];
  /**
   * #407 — één vaste, server-side natuurlijke zin voor `POST /v1.0/copilot/retrieval`.
   * Ontbreekt hij, dan gebruikt de meetarm `vraag`. Browserinvoer levert deze
   * waarde nooit; de runner leest hem uit de vastgelegde scenarioset.
   */
  copilotVraag?: string;
  /**
   * #407 — server-side vastgelegd semantisch scenario: de doelpassage bevat geen
   * letterlijke term uit de vraag. Wordt nooit uit de vraagtekst afgeleid.
   */
  semantisch?: boolean;
  verwachteFixtures: string[];
  /** Optionele vooraf vastgelegde primaire bron voor MRR/nDCG. */
  primaireFixture?: string;
  maxKandidaten?: number;
}

/** Inhoudsvrije vorm die veilig als meetbewijs mag worden opgeslagen. */
export interface VeiligeMeetrijBasis<R extends SpikeVergelijkRoute> {
  ronde: number;
  vraagcode: string;
  route: R;
  searchScope: MicrosoftSearchScope | null;
  resultaat: "geslaagd" | "geen_resultaten" | "mislukt";
  foutcategorie: SpikeFoutcategorie | "acceptatie_afwijking" | null;
  foutcode: SpikeFoutcode | "onverwachte_bronset" | null;
  gevondenFixtures: string[];
  exacteBronset: boolean;
  recall: number;
  /** Kandidaatprecision vóór verificatie: relevante toegelaten bronnen gedeeld
   * door kandidatenVoorVerificatie, niet door de uiteindelijke bronset. */
  precision: number;
  mrr: number;
  ndcg: number;
  locatorDekking: number;
  versieDekking: number;
  previewDekking: number;
  latencyMs: number;
  microsoftCalls: number;
  downloads: number;
  kandidatenVoorVerificatie: number;
  responseBytes: number;
  contentBytes: number;
  throttles: number;
  retries: number;
  versieVingerafdrukken: string[];
  afwijzingMapping: number;
  afwijzingBinding: number;
  afwijzingRoot: number;
  afwijzingRechtenConfiguratie: number;
  afwijzingVersie: number;
  afwijzingExtractie: number;
  afwijzingPreview: number;
  afwijzingActualiteit: number;
}

/**
 * De bestaande meetrij, letterlijk ongewijzigd van vorm. De Preview-brug geeft
 * deze terug als `SharePointRetrievalVeiligeMeting`; die toewijzing moet blijven
 * werken, dus hier komt geen Copilot-route en geen extra verplicht veld bij.
 */
export type VeiligeMeetrij = VeiligeMeetrijBasis<SpikeRoute>;

/**
 * #407 — rij van de vergelijkingslaag. Bevat de vierde arm en de twee
 * Copilot-specifieke, inhoudsvrije maten. Wordt nooit door de Preview-brug of
 * de DB-auditprojectie gebruikt.
 */
export interface VeiligeVergelijkrij extends VeiligeMeetrijBasis<SpikeVergelijkRoute> {
  /** Hits die op unieke extractlokalisatie zijn afgevallen; 0 voor de andere armen. */
  afwijzingLokalisatie: number;
  /** Aandeel toegelaten passages dat uit een gelokaliseerd Microsoft-extract komt. */
  extractLokalisatieDekking: number;
  /** Server-side vastgelegd: de vraag deelt geen letterlijke term met de doelpassage. */
  semantisch: boolean;
}
