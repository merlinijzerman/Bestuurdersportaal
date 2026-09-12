// ============================================================================
//  #368 — Providerneutraal contract voor niet-zoekende evidencelezingen.
// ----------------------------------------------------------------------------
//  Decision Objects, semantische units en chunk-presentie zijn geen zoekprovider,
//  maar hun inhoud kan wel modelcontext of een deterministisch oordeel sturen.
//  Daarom delen zij dezelfde harde eigenschappen: serverscope, opaque identiteit,
//  versie/citatie, een werkelijk gerenderd budget en inhoudsvrije audit.
// ============================================================================
import type { Bronsoort, RetrievalContext, Versiebewijs } from "./contract";

export type EvidenceSoort = "besluitregistratie" | "semantische_unit";
export type EvidenceFout = "buiten_scope" | "providerfout" | "onvolledig" | "afgekapt";

export interface EvidenceAudit {
  correlation_id: string;
  soort: EvidenceSoort | "chunk_presentie";
  gevraagd: number;
  toegelaten: number;
  gerenderde_tekens: number;
  limiet: number;
  afgekapt: boolean;
  geneutraliseerd?: number;
  pii_gedetecteerd?: boolean;
  pii_soorten?: string[];
  versies?: { sterk: number; gedegradeerd: number };
  fout?: EvidenceFout;
}

/**
 * `waarde` bevat uitsluitend domeinvelden die de server nodig heeft. Opslag-id's
 * blijven in de adaptermodule en mogen niet in dit contract worden opgenomen.
 */
export interface EvidenceItem<T> {
  soort: EvidenceSoort;
  ref: string;
  documentIdentiteit: string;
  passageIdentiteit: string;
  citationId: string;
  bronsoort: Bronsoort;
  titel: string;
  versie: Versiebewijs;
  status: {
    documentstatus?: string | null;
    bronstatus?: string | null;
    geldigTot?: string | null;
    actueel: boolean;
  };
  locator: { pagina?: number | null; paragraaf?: string | null };
  /** Exact de tekst die als evidence naar model of deterministische kern mag. */
  passage: string;
  /** Omvang van het volledige downstreamblok (labels en scheidingen inbegrepen). */
  gerenderdeTekens?: number;
  waarde: T;
}

export type EvidenceUitkomst<T> =
  | { status: "compleet"; items: EvidenceItem<T>[]; audit: EvidenceAudit }
  | { status: "geweigerd"; items: []; audit: EvidenceAudit };

export interface EvidenceOpdracht {
  context: RetrievalContext;
  maxItems: number;
  maxGerenderdeTekens: number;
}

/** Typed uitkomst van een contentvrije chunk-presentiecheck. */
export type PresentieUitkomst =
  | {
      status: "compleet";
      documentIdentiteiten: ReadonlySet<string>;
      audit: EvidenceAudit;
    }
  | { status: "geweigerd"; documentIdentiteiten: ReadonlySet<string>; audit: EvidenceAudit };

export interface ModelcontextAudit {
  correlation_id: string;
  soort: string;
  pii: "geen" | "persoonsgebonden" | "bijzonder";
  gerenderde_tekens: number;
  limiet: number;
  afgekapt: boolean;
  geneutraliseerd?: number;
  fout?: "buiten_scope" | "providerfout" | "afgekapt";
}

export interface ModelcontextBlok {
  tekst: string;
  audit: ModelcontextAudit;
}
