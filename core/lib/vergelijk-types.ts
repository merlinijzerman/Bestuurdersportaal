// ============================================================================
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

export interface VergelijkResultaat {
  comparison_run_id: string | null; // null wanneer (nog) niet gepersisteerd
  mode: VergelijkMode;
  bron_document_id: string;
  doel_document_id: string;
  // Welke dimensies zijn feitelijk vergeleken — toont de reikwijdte (compliance:
  // géén gelijkheids-/volledigheidsclaim buiten deze assen).
  dimensies: Dimensie[];
  findings: Finding[];
}
