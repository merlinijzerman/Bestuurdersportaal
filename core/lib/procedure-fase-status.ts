// ============================================================================
//  Afgeleide fase-status (UI-laag) — WO-2, PROCEDURE-ENGINE-V2-ONTWERP §7.1.
// ----------------------------------------------------------------------------
//  De proceduremodule-engine v2 is parallel-by-default (D6): er is geen
//  sequentiële cursor meer, dus "waar staat een fase / een procedure" wordt
//  AFGELEID uit de onderliggende staat (stap-status + bewijslast), niet uit
//  volgorde. Deze afleiding is bewust UI-laag en puur: geen nieuwe tabellen,
//  geen server-aggregatie (die is OB-E5, een latere optimalisatie).
//
//  Bron van de regels: §7.1 (fase-status, aandachtsvlag, bewijslast-dekking,
//  portfolio-aggregatie). Puur en zonder I/O, dus testbaar onder tsx
//  (procedure-fase-status.sanity.ts) — conform de CLAUDE.md-prioriteit voor
//  sanity-checks op procedurestatussen.
//
//  ⚠ Dit is presentatie-afleiding, GEEN autorisatie. De gating op mutaties
//  (heropenen, vereiste/checklist toevoegen) zit server-side in WO-1.
// ============================================================================

import type { StapStatus } from "./decision-view";

// ── Fase-status ─────────────────────────────────────────────────────────────

export type FaseStatus =
  | "afgerond"
  | "in_behandeling"
  | "nog_niet_begonnen"
  | "vervallen"; // P4 (#169): alle stappen terminaal én ≥1 vervallen — géén vals groen

export const FASE_STATUS_LABEL: Record<FaseStatus, string> = {
  afgerond: "Afgerond",
  in_behandeling: "In behandeling",
  nog_niet_begonnen: "Nog niet begonnen",
  vervallen: "Vervallen",
};

/** 'heropend' telt voor de afleiding als actief (§4.3). */
function isActiefAchtig(status: StapStatus): boolean {
  return status === "actief" || status === "heropend";
}

/**
 * Fase-status per fase F met stappen S_F (§7.1, P4 §4.1):
 *  - Afgerond           — ALLE stappen in S_F zijn 'afgerond' (strikt).
 *  - Vervallen          — alle stappen zijn terminaal ('afgerond'/'vervallen')
 *                         én minstens één is 'vervallen'. NIET afgerond: dat zou
 *                         het "vals groen" zijn dat §6 verbiedt.
 *  - Nog niet begonnen  — er is niets gebeurd: geen 'afgerond', geen 'vervallen',
 *                         geen 'actief'/'heropend' (alleen open/niet_begonnen/geblokkeerd).
 *  - In behandeling     — anders (begonnen maar niet af).
 * Een lege fase telt als nog niet begonnen (defensief; hoort niet voor te komen).
 */
export function faseStatus(stappen: { status: StapStatus }[]): FaseStatus {
  if (stappen.length === 0) return "nog_niet_begonnen";
  const alleTerminaal = stappen.every(
    (s) => s.status === "afgerond" || s.status === "vervallen"
  );
  if (alleTerminaal) {
    return stappen.some((s) => s.status === "vervallen") ? "vervallen" : "afgerond";
  }
  const heeftAfgerond = stappen.some((s) => s.status === "afgerond");
  const heeftVervallen = stappen.some((s) => s.status === "vervallen");
  const heeftActief = stappen.some((s) => isActiefAchtig(s.status));
  if (!heeftAfgerond && !heeftVervallen && !heeftActief) return "nog_niet_begonnen";
  return "in_behandeling";
}

// ── Bewijslast-dekking ──────────────────────────────────────────────────────

export interface DekkingKern {
  verplicht: boolean;
  vervuld: boolean;
}

export interface Dekking {
  /** aantal verplichte vereisten (template-actief + instantie-actief). */
  verplicht: number;
  /** aantal daarvan met status 'volledig' (vervuld). */
  sluitend: number;
  /** sluitend ÷ verplicht als percentage (0–100); 100 als er niets verplicht is. */
  pct: number;
}

/**
 * Bewijslast-dekking (§7.1): # verplichte vereisten met status volledig ÷
 * # verplichte vereisten. De unie template+instantie zit al in de meegegeven
 * evidence-lijst (buildEvidenceLijst, D7c). Geen verplichte vereisten → 100%
 * (er valt niets te dekken).
 */
export function bewijslastDekking(evidence: DekkingKern[]): Dekking {
  const verplichte = evidence.filter((e) => e.verplicht);
  const sluitend = verplichte.filter((e) => e.vervuld).length;
  const pct =
    verplichte.length === 0
      ? 100
      : Math.round((sluitend / verplichte.length) * 100);
  return { verplicht: verplichte.length, sluitend, pct };
}

// ── Aandachtsvlag ───────────────────────────────────────────────────────────

export type AandachtNiveau = "geen" | "oranje" | "rood";

export interface AandachtStapKern {
  status: StapStatus;
  herbevestiging_nodig: boolean;
}

export interface AandachtEvidenceKern {
  verplicht: boolean;
  blokkerend: boolean;
  vervuld: boolean;
}

/**
 * Aandachtsvlag per fase (§7.1) — orthogonaal signaal, zegt niets over
 * voortgang.
 *
 *  - Rood   — een verplichte BLOKKERENDE vereiste is niet sluitend, TERWIJL de
 *             fase in behandeling is (§7.1 conditioneert rood expliciet op
 *             'in behandeling').
 *  - Oranje — een stap is heropend / herbevestiging_nodig (het rework-signaal,
 *             ongeacht fase-status — een heropening kan juist op een afgeronde
 *             stap slaan), óf een verplichte niet-blokkerende vereiste ontbreekt
 *             terwijl de fase in behandeling is.
 *
 * Het rework-signaal (heropend/herbevestiging) vuurt bewust ook op een afgeronde
 * fase: anders zou een 'herbevestiging nodig'-stap in een afgeronde fase geen
 * stip krijgen terwijl de tellerregel hem wél noemt (inconsistentie). De
 * bewijslast-vlaggen blijven aan 'in behandeling' gebonden — een nog niet
 * begonnen fase heeft nog geen bewijslast en hoort niet op te lichten.
 *
 * Kanttekening (§7.1): de TERMIJN-condities (rood bij overschrijding, oranje
 * bij nadering) leunen op termijnen-als-data (review O2). Tot die er zijn toont
 * de vlag alleen heropend/herbevestiging en ontbrekende bewijslast.
 */
export function faseAandacht(
  status: FaseStatus,
  stappen: AandachtStapKern[],
  evidence: AandachtEvidenceKern[]
): AandachtNiveau {
  const inBehandeling = status === "in_behandeling";

  // Rood alleen zinvol/gedefinieerd terwijl de fase in behandeling is.
  if (inBehandeling) {
    const roodBewijs = evidence.some(
      (e) => e.verplicht && e.blokkerend && !e.vervuld
    );
    if (roodBewijs) return "rood";
  }

  // Rework-signaal: ongeacht fase-status.
  const heropend = stappen.some(
    (s) => s.status === "heropend" || s.herbevestiging_nodig
  );
  if (heropend) return "oranje";

  // Ontbrekende verplichte niet-blokkerende bewijslast: alleen bij een
  // lopende fase (een niet-begonnen fase heeft nog geen bewijslast).
  if (inBehandeling) {
    const oranjeBewijs = evidence.some(
      (e) => e.verplicht && !e.blokkerend && !e.vervuld
    );
    if (oranjeBewijs) return "oranje";
  }

  return "geen";
}

// P1a (#165): de portfolio-aggregatie (ProcesSamenvatting/PortfolioAggregaat/
// aggregeerPortfolio) is verwijderd met de tegels — het overzicht telt de
// filters nu client-side. Git-historie is het archief; #168 (P3) herziet de
// signalen sowieso.
