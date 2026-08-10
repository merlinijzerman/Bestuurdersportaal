// ============================================================================
//  core/lib/document-statusprofiel.ts — werkopdracht metadata-vereenvoudiging 1.3
// ----------------------------------------------------------------------------
//  Het STATUSPROFIEL per documenttype: welke statussen een type mag dragen en
//  hoe het `vastgesteld`-token per type wordt gelabeld. Puur (geen I/O), zodat
//  de routes (server-side leidend) én de UI dezelfde regels gebruiken en de
//  sanity-suite ze kan naslaan.
//
//  ONDERLIGGER: DOELMODEL-status-as §5 (statusprofiel) + §2.2 (token vs. label).
//
//  FASE 1 = ADDITIEF. De enige profielregel die nu gedrag stuurt is:
//  `van_kracht` mag ALLEEN voor de normatieve cluster. De helper
//  `toegestaneStatussenVoorType` FILTERT daarom een meegegeven basis-set; hij
//  verzint geen statussen. De enum-krimp naar vijf waarden (met `historisch`)
//  is fase 2 (besluit 0154) — pas dán wordt de basis-set zelf kleiner. Deze
//  module raakt de transitietabel niet.
//
//  TOKEN VS. LABEL: de opgeslagen statuswaarde is een documenttype-neutrale
//  token; het zichtbare label komt per type uit dit profiel. Zo toont de UI
//  "Vastgesteld" bij een besluit en "Definitief" bij een memo/analyse/
//  rapportage — zónder de opgeslagen waarde te hernoemen.
// ============================================================================

import { type Documenttype } from "./document-metadata";
import {
  type DocumentStatus,
  DOCUMENT_STATUS_LABEL,
} from "./document-status-transities";

/**
 * De normatieve cluster: de enige documenttypen die een `van_kracht`-status
 * (geldende norm) mogen dragen (DOELMODEL §5).
 */
export const NORMATIEVE_DOCUMENTTYPEN: Documenttype[] = [
  "beleid",
  "besluit",
  "besluitdocument",
  "besluitregistratie",
];

/**
 * Types waarvoor het `vastgesteld`-token als "Definitief" wordt gelabeld i.p.v.
 * "Vastgesteld" — de informatief/vaststaande cluster (DOELMODEL §2.2/§5). De
 * normatieve cluster en `bestuursvoorstel` (in-besluitvorming) houden
 * "Vastgesteld".
 */
export const DEFINITIEF_LABEL_TYPEN: Documenttype[] = [
  "notulen",
  "advies",
  "memo",
  "analyse",
  "rapportage",
  "bijlage",
  "overig",
];

/**
 * Mag dit documenttype de status `van_kracht` (geldende norm) dragen?
 *
 * Onbekend type (`null`/`undefined` — bv. een vergaderstuk zonder classificatie)
 * geeft `true`: we kunnen niet vaststellen dát het niet-normatief is, en de
 * guardrail "geen schijnzekerheid" verbiedt om op een aanname te blokkeren. In
 * de praktijk vraagt het bibliotheek-/processtroompad altijd een type, dus de
 * `van_kracht`-keuze verschijnt daar alleen mét een gekozen type.
 */
export function magVanKracht(
  documenttype: Documenttype | null | undefined
): boolean {
  if (!documenttype) return true;
  return NORMATIEVE_DOCUMENTTYPEN.includes(documenttype);
}

/**
 * Filtert een meegegeven basis-set statussen tot wat voor dit type is
 * toegestaan. Fase 1: verwijdert alleen `van_kracht` voor niet-normatieve types;
 * al het andere blijft ongemoeid. Geef de basis mee uit de bestaande machinerie
 * (`toegestaneIngestStatussen()` of `toegestaneVervolgstatussen(...)`).
 */
export function toegestaneStatussenVoorType(
  basis: DocumentStatus[],
  documenttype: Documenttype | null | undefined
): DocumentStatus[] {
  if (magVanKracht(documenttype)) return basis;
  return basis.filter((s) => s !== "van_kracht");
}

/**
 * Het per-type zichtbare label van een status. Alleen het `vastgesteld`-token
 * varieert (→ "Definitief" voor de informatief/vaststaande cluster); alle andere
 * statussen houden hun neutrale label. Puur weergave — verandert de opgeslagen
 * waarde niet.
 */
export function statusLabelVoorType(
  status: DocumentStatus,
  documenttype: Documenttype | null | undefined
): string {
  if (
    status === "vastgesteld" &&
    documenttype &&
    DEFINITIEF_LABEL_TYPEN.includes(documenttype)
  ) {
    return "Definitief";
  }
  return DOCUMENT_STATUS_LABEL[status];
}
