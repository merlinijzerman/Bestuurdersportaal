// ============================================================================
//  Procesmodel-templates (Increment A, besluit 0006 B3 + ticket §4.6a/e).
// ----------------------------------------------------------------------------
//  Procesmodellen zijn altijd fonds-specifiek (procesmodellen.fonds_id NOT
//  NULL), dus de "globale templates" kunnen geen DB-rijen met fonds_id NULL
//  zijn. De template-seedlijst leeft daarom hier als code-constante; de
//  import-functie (/api/catalogus/import) kopieert ze naar fonds-specifieke
//  procesmodellen-rijen.
//
//  generiek_procestype = de bestaande code uit lib/proces-templates.ts; het
//  intern stabiele type waarop AI/standaardlogica mag aanhaken, ook als een
//  fonds de naam aanpast (acceptatiecriterium FO §4 module 1, punt 4).
//
//  De suggestiematrix koppelt per generiek_procestype aanbevolen organen op
//  NAAM (matcht de seed-templatenamen in de migratie). Gebruikt door import
//  (default-koppelingen) én als UI-suggestie (FO §4 module 2, punt 3).
//  lib/proces-templates.ts (de operationele stap/checklist-templates) blijft
//  ongewijzigd; uitfaseren is een latere stap.
// ============================================================================

/** Generieke flow-fases (FO §5) — startwaarde voor default_tijdlijnfases. */
export const GENERIEKE_TIJDLIJNFASES = [
  "orientatie",
  "analyse",
  "advies",
  "besluitvorming",
  "implementatie",
  "evaluatie",
] as const;

export interface ProcesmodelTemplate {
  generiek_procestype: string;
  naam: string;
  domein: string;
  frequentie:
    | "jaarlijks"
    | "kwartaal"
    | "maandelijks"
    | "ad_hoc"
    | "projectmatig"
    | "doorlopend";
  verwachte_documenttypen: string[];
  synoniemen: string[];
  default_tijdlijnfases: string[];
}

export const PROCESMODEL_TEMPLATES: ProcesmodelTemplate[] = [
  {
    generiek_procestype: "uitbestedingsreview",
    naam: "Uitbestedingsreview",
    domein: "Uitbesteding",
    frequentie: "jaarlijks",
    verwachte_documenttypen: [
      "KPI-rapportage",
      "SLA-rapportage",
      "DD-vragenlijst",
      "ISAE 3402",
      "reviewverslag",
    ],
    synoniemen: ["uitbesteding", "leverancier", "SLA", "due diligence", "ISAE"],
    default_tijdlijnfases: [...GENERIEKE_TIJDLIJNFASES],
  },
  {
    generiek_procestype: "incident_dnb",
    naam: "Incident-meldplicht DNB",
    domein: "Compliance",
    frequentie: "ad_hoc",
    verwachte_documenttypen: ["incidentmelding", "DNB-bevestiging"],
    synoniemen: ["incident", "DNB", "meldplicht", "calamiteit"],
    default_tijdlijnfases: [...GENERIEKE_TIJDLIJNFASES],
  },
  {
    generiek_procestype: "beleidswijziging_beleggingsbeleid",
    naam: "Beleidswijziging beleggingsbeleid",
    domein: "Beleggingen",
    frequentie: "ad_hoc",
    verwachte_documenttypen: [
      "beleidsvoorstel",
      "risk-validatie",
      "evenwichtigheidstoets",
      "besluitdocument",
    ],
    synoniemen: [
      "beleggingsbeleid",
      "strategisch beleggingsplan",
      "ALM",
      "risicobereidheid",
    ],
    default_tijdlijnfases: [...GENERIEKE_TIJDLIJNFASES],
  },
  {
    generiek_procestype: "beleidswijziging",
    naam: "Beleidswijziging (generiek)",
    domein: "Governance",
    frequentie: "ad_hoc",
    verwachte_documenttypen: [
      "beleidsvoorstel",
      "impactanalyse",
      "besluitdocument",
    ],
    synoniemen: ["beleid", "beleidswijziging", "beleidsbesluit"],
    default_tijdlijnfases: [...GENERIEKE_TIJDLIJNFASES],
  },
];

/** Aanbevolen organen per generiek_procestype, op naam (matcht seed-templates). */
export interface ProcesOrgaanSuggestie {
  gremia: string[];
  expertises: string[];
  focusgebieden: string[];
}

export const PROCES_ORGAAN_SUGGESTIES: Record<string, ProcesOrgaanSuggestie> = {
  uitbestedingsreview: {
    gremia: [
      "Bestuur",
      "Auditcommissie",
      "Risicocommissie",
      "Pensioenuitvoerder",
      "Vermogensbeheerder",
    ],
    expertises: [
      "Uitbesteding & leveranciersmanagement",
      "Risicomanagement",
      "Compliance & juridisch",
    ],
    focusgebieden: [
      "Uitvoeringskwaliteit en uitbesteding",
      "Compliance en wet- en regelgeving",
      "Kosten en doelmatigheid",
    ],
  },
  incident_dnb: {
    gremia: ["Bestuur", "Dagelijks bestuur", "Risicocommissie"],
    expertises: ["Risicomanagement", "Compliance & juridisch"],
    focusgebieden: [
      "Compliance en wet- en regelgeving",
      "Risicobereidheid en -beheersing",
    ],
  },
  beleidswijziging_beleggingsbeleid: {
    gremia: ["Bestuur", "Beleggingsadviescommissie (BAC)", "Risicocommissie"],
    expertises: ["Beleggingen & vermogensbeheer", "Risicomanagement"],
    focusgebieden: [
      "Beleggingsbeleid en rendement",
      "Risicobereidheid en -beheersing",
      "Evenwichtige belangenafweging",
    ],
  },
  beleidswijziging: {
    gremia: ["Bestuur", "Verantwoordingsorgaan (VO)"],
    expertises: ["Governance & bestuur", "Compliance & juridisch"],
    focusgebieden: [
      "Evenwichtige belangenafweging",
      "Compliance en wet- en regelgeving",
    ],
  },
};

export function vindProcesmodelTemplate(
  generiek_procestype: string
): ProcesmodelTemplate | undefined {
  return PROCESMODEL_TEMPLATES.find(
    (t) => t.generiek_procestype === generiek_procestype
  );
}
