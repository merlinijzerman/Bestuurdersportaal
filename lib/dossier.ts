// Dossier (procesinstantie) — frontend/server contract voor Increment B.
//
// Een `procedures`-rij is een procesinstantie; de UI noemt dit "dossier".
// De effectieve dossierstatus + sublabel wordt in de DB afgeleid via
// `vw_dossier_status` (mapping uit het primaire Decision Object, TO §3.2).
// Deze module spiegelt die mapping in pure TS zodat ze los van de DB
// getest kan worden (lib/dossier.sanity.ts), en levert de labels/types
// voor de dossier-UI.
//
// Bron: FO v1.2 §5 (Module 3), TO v1.2 §3.2 (O2 besloten), decisions/0006.

import type { DecisionStatus } from "./decision-view";

// ── Statusmodellen ────────────────────────────────────────────────────

/** De 8 dossierstatussen (FO §5). `gepland`/`gearchiveerd` komen alleen
 *  uit de handmatige fallback (procedures.status), nooit uit een DO. */
export type DossierStatus =
  | "gepland"
  | "lopend"
  | "ter_besluitvorming"
  | "besloten"
  | "in_implementatie"
  | "afgerond"
  | "heropend"
  | "gearchiveerd";

export const DOSSIER_STATUSSEN: DossierStatus[] = [
  "gepland",
  "lopend",
  "ter_besluitvorming",
  "besloten",
  "in_implementatie",
  "afgerond",
  "heropend",
  "gearchiveerd",
];

export const DOSSIER_STATUS_LABEL: Record<DossierStatus, string> = {
  gepland: "Gepland",
  lopend: "Lopend",
  ter_besluitvorming: "Ter besluitvorming",
  besloten: "Besloten",
  in_implementatie: "In implementatie",
  afgerond: "Afgerond",
  heropend: "Heropend",
  gearchiveerd: "Gearchiveerd",
};

export const PERIODE_TYPES = [
  "jaar",
  "kwartaal",
  "maand",
  "projectperiode",
  "ad_hoc",
  "doorlopend",
  "versiegedreven",
] as const;
export type PeriodeType = (typeof PERIODE_TYPES)[number];

export const PERIODE_TYPE_LABEL: Record<PeriodeType, string> = {
  jaar: "Jaar",
  kwartaal: "Kwartaal",
  maand: "Maand",
  projectperiode: "Projectperiode",
  ad_hoc: "Ad hoc",
  doorlopend: "Doorlopend",
  versiegedreven: "Versiegedreven",
};

/** Rij uit `vw_dossier_status`. */
export interface DossierStatusView {
  procedure_id: string;
  fonds_id: string;
  decision_id: string | null;
  decision_status: DecisionStatus | null;
  afgeleid_van_decision: boolean;
  dossierstatus: DossierStatus | null;
  sublabel: string | null;
}

// ── 17→8 mapping (spiegelt fn_dossierstatus_van_decision in de DB) ─────

interface DossierAfleiding {
  dossierstatus: DossierStatus | null;
  sublabel: string | null;
}

/** Leidt dossierstatus + sublabel af uit een Decision Object-status.
 *  Pure functie — geen DB. Moet 1-op-1 gelijk zijn aan de SQL-functie
 *  `public.fn_dossierstatus_van_decision`. Bron: TO §3.2. */
export function dossierstatusVanDecision(
  status: DecisionStatus | string
): DossierAfleiding {
  let dossierstatus: DossierStatus | null;
  switch (status) {
    case "concept":
    case "in_onderbouwing":
    case "in_validatie":
    case "in_review":
    case "teruggezet":
    case "geescaleerd":
    case "aangehouden":
      dossierstatus = "lopend";
      break;
    case "geagendeerd":
    case "in_bespreking":
      dossierstatus = "ter_besluitvorming";
      break;
    case "besloten":
    case "voorwaardelijk_besloten":
      dossierstatus = "besloten";
      break;
    case "in_uitvoering":
    case "in_evaluatie":
      dossierstatus = "in_implementatie";
      break;
    case "afgesloten":
    case "afgewezen":
    case "geannuleerd":
      dossierstatus = "afgerond";
      break;
    case "heropend":
      dossierstatus = "heropend";
      break;
    default:
      dossierstatus = null;
  }

  let sublabel: string | null;
  switch (status) {
    case "voorwaardelijk_besloten":
      sublabel = "voorwaardelijk";
      break;
    case "teruggezet":
      sublabel = "teruggezet";
      break;
    case "geescaleerd":
      sublabel = "geëscaleerd";
      break;
    case "aangehouden":
      sublabel = "aangehouden";
      break;
    case "in_evaluatie":
      sublabel = "in evaluatie";
      break;
    case "afgewezen":
      sublabel = "afgewezen";
      break;
    case "geannuleerd":
      sublabel = "geannuleerd";
      break;
    default:
      sublabel = null;
  }

  return { dossierstatus, sublabel };
}

// ── Tijdlijnfases (FO §5) ──────────────────────────────────────────────

/** De zes generieke dossierfases in vaste volgorde. */
export const TIJDLIJNFASES = [
  "orientatie",
  "analyse",
  "advies",
  "besluitvorming",
  "implementatie",
  "evaluatie",
] as const;
export type Tijdlijnfase = (typeof TIJDLIJNFASES)[number];

export const TIJDLIJNFASE_LABEL: Record<Tijdlijnfase, string> = {
  orientatie: "Oriëntatie",
  analyse: "Analyse",
  advies: "Advies",
  besluitvorming: "Besluitvorming",
  implementatie: "Implementatie",
  evaluatie: "Evaluatie",
};

/** Plaatst een procedurestap op een van de zes tijdlijnfases.
 *
 *  In B is er nog geen per-stap fase-veld (dat is procescatalogus-werk in
 *  een latere increment). We leiden de fase deterministisch af uit de
 *  ordinale positie van de stap binnen het totaal, zodat een dossier met
 *  het standaard 6-staps beleidswijziging-model exact 1-op-1 op de zes
 *  fases valt. Bij afwijkende staptellen worden de stappen evenredig over
 *  de zes fases verdeeld. `volgorde` is 1-based. */
export function tijdlijnfaseVanStap(
  volgorde: number,
  totaalStappen: number
): Tijdlijnfase {
  if (totaalStappen <= 1) return TIJDLIJNFASES[0];
  const idx = Math.round(
    ((volgorde - 1) / (totaalStappen - 1)) * (TIJDLIJNFASES.length - 1)
  );
  const begrensd = Math.min(
    TIJDLIJNFASES.length - 1,
    Math.max(0, idx)
  );
  return TIJDLIJNFASES[begrensd];
}

/** Kleurklassen per dossierstatus (consistent met DossierStatusStrip). */
export function dossierStatusKleur(status: DossierStatus | null): string {
  switch (status) {
    case "besloten":
    case "in_implementatie":
    case "afgerond":
      return "bg-ok-tint text-ok-ink border-ok/30";
    case "ter_besluitvorming":
      return "bg-warn-tint text-warn-ink border-warn/30";
    case "heropend":
      return "bg-phase-tint text-phase-ink border-phase/30";
    case "gearchiveerd":
      return "bg-app-bg text-muted border-line";
    case "gepland":
      return "bg-app-bg text-ink border-line";
    default:
      return "bg-accent-tint text-accent-ink border-accent/30";
  }
}
