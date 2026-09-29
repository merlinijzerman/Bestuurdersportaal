// ============================================================================

import type { BronVerwijzing } from "./rag";
import type { Bronsoort, Versiebewijs } from "./retrieval/contract";
import type { Toelatingssamenvatting } from "./retrieval/toelatingspoort";
import type { EvidenceAudit } from "./retrieval/evidence-contract";
//  core/lib/vergelijk-types.ts — gedeelde types voor de vergelijkmodus (T5).
// ----------------------------------------------------------------------------
//  Dependency-vrij en client-veilig: zowel de service (server) als de resultaat-
//  component (client) importeren hieruit, zonder server-only code mee te trekken.
//  De Finding-vorm volgt exact het technisch contract uit de T5-werkopdracht.
//
//  GRENS (T5): deze structuur draagt UITSLUITEND ruwe verschillen. Geen bestuurlijke
//  classificatie of materialiteit — dat is T9 en hoort hier niet.
// ============================================================================

export type VergelijkMode = "symmetrisch"; // 'coverage' = T6 (Fase 2), buiten scope.

export type VerschilTypeRuw = "gelijk" | "verschilt" | "alleen_bron" | "alleen_doel";

export type VergelijkMethode = "deterministisch" | "llm";

export type ConceptType = "percentage" | "date" | "amount" | "policy_choice";

// Herkomst van een dimensie — nodig voor de compliance-eis "toon welke dimensies
// zijn vergeleken" en om te laten zien wat de bestuurder heeft aangevuld.
export type DimensieHerkomst = "catalogus" | "llm" | "aangevuld";

export interface Dimensie {
  key: string; // 'solidariteitsreserve.bovengrens' of een LLM-afgeleide sleutel
  label: string;
  /** Server-afgeleide retrievalquery; de zichtbare/stabiele sleutel blijft schoon. */
  zoekvraag?: string;
  concept_id?: string | null; // gezet bij een catalogus-concept
  concept_key?: string | null;
  type?: ConceptType | null; // alleen bij catalogus-concepten
  herkomst: DimensieHerkomst;
}

export interface FindingZijde {
  value: string | null; // weergavewaarde; null als deze zijde het concept niet heeft
  value_normalized?: string | null; // genormaliseerd (deterministisch pad); anders weggelaten
  evidence: string | null; // verbatim bronpassage (evidence-link)
  page: number | null;
  document_id: string;
  /** Providerneutrale passage-ref waarmee het bewijs aan `bronnen` bindt. */
  passage_ref?: string | null;
}

export interface Finding {
  finding_key: string; // stabiel; via mintFindingKey (koppelt T10)
  dimensie: string;
  concept_id?: string | null;
  bron: FindingZijde;
  doel: FindingZijde;
  verschil_type_ruw: VerschilTypeRuw;
  method: VergelijkMethode;
}

/**
 * Eén centraal gevormde bronverwijzing uit de retrievalorkestratie. Status en
 * versie staan er expliciet naast: een vergelijking mag niet alleen de tekst
 * bewaren en daarmee de toelatings-/actualiteitscontext verliezen.
 */
export interface VergelijkBron {
  citation_id: number;
  passage_ref: string;
  bronsoort: Bronsoort;
  verwijzing: BronVerwijzing;
  versie: Versiebewijs;
  status: {
    documentstatus?: string | null;
    bronstatus?: string | null;
    geldigTot?: string | null;
    actueel: boolean;
  };
}

export interface VergelijkRetrievalPoging {
  document_id: string;
  dimensie: string;
  methode: string;
  opgehaald: number;
  geselecteerd: number;
  fout?: string;
  toelating?: Toelatingssamenvatting;
}

/** Inhoudsvrij, duurzaam spoor; de volledige fragmenten staan alleen in `bronnen`. */
export interface VergelijkRetrievalMeta {
  correlation_id: string;
  pogingen: VergelijkRetrievalPoging[];
  toelating?: Toelatingssamenvatting;
  /** #368 — inhoudsvrij spoor van deterministische semantic-unit-evidence. */
  evidence?: EvidenceAudit[];
}

// ── V-1 (wetsgeschiedenis A-light) — juridische rol per zijde ───────────────
// Server-afgeleid uit de documentmetadata (nooit uit documenttekst of model-
// uitvoer). Alleen aanwezig als minstens één zijde juridisch is of haar rol niet
// kon worden vastgesteld; twee niet-juridische documenten houden exact het
// bestaande, symmetrische resultaat.

/**
 * - `geldend_recht`             — wetgeving, gepubliceerd en niet verlopen;
 * - `wetgeving_niet_geldend`    — wetgeving die vervangen/ingetrokken/verlopen is
 *                                 (expliciet gekozen historische versie);
 * - `wetgeving_status_onbekend` — wetgeving zonder vaststelbare geldigheid;
 * - `wetsgeschiedenis`          — toelichting, nooit zelfstandig bindend;
 * - `niet_juridisch`            — geen wetgeving of wetsgeschiedenis;
 * - `onbekend`                  — metadata niet leesbaar: geen normstatus.
 */
export type VergelijkJuridischeRol =
  | "geldend_recht"
  | "wetgeving_niet_geldend"
  | "wetgeving_status_onbekend"
  | "wetsgeschiedenis"
  | "niet_juridisch"
  | "onbekend";

export type VergelijkJuridischeVerhouding =
  | "norm_tegenover_toelichting"
  | "norm_tegenover_norm"
  | "toelichting_tegenover_toelichting"
  | "juridisch_tegenover_overig"
  | "onbepaald";

export interface VergelijkZijdeRol {
  rol: VergelijkJuridischeRol;
  /** true = actuele norm; false = uitdrukkelijk géén norm; null = niet vastgesteld. */
  norm_dragend: boolean | null;
  /** Zichtbare, servergeschreven kop (hergebruikt de R-1-labels). */
  label: string;
  titel: string | null;
  documenttype: string | null;
  wetsgeschiedenis_subtype: string | null;
  dossiernummer: string | null;
  normgewicht: string | null;
  wettelijk_regime: string | null;
  documentdatum: string | null;
}

export interface VergelijkJuridischeDuiding {
  verhouding: VergelijkJuridischeVerhouding;
  bron: VergelijkZijdeRol;
  doel: VergelijkZijdeRol;
  /** Servergeschreven duiding die vóór de bevindingen wordt getoond. */
  toelichting: string;
}

export interface VergelijkResultaat {
  comparison_run_id: string | null; // null wanneer (nog) niet gepersisteerd
  mode: VergelijkMode;
  bron_document_id: string;
  doel_document_id: string;
  // Welke dimensies zijn feitelijk vergeleken — toont de reikwijdte (compliance:
  // géén gelijkheids-/volledigheidsclaim buiten deze assen).
  dimensies: Dimensie[];
  findings: Finding[];
  /** Additieve #369-uitbreiding; centraal gevormd, providerneutraal en citeerbaar. */
  bronnen?: VergelijkBron[];
  /** Correlation + inhoudsvrije toelatings-/uitvoeringstelemetrie. */
  retrieval_meta?: VergelijkRetrievalMeta;
  /** V-1 — additief; ontbreekt bij twee niet-juridische documenten. */
  juridische_duiding?: VergelijkJuridischeDuiding;
}
