// Scope-als-data (P2, #167). Per requirement-type: de brontabel waarop het
// gebonden feit met `requirement_sleutel` staat, en de dossier-lokale scope-kolom
// waarop vervulling wordt geteld — `vervuld = count(gebonden feiten met de sleutel)
// >= min_aantal`.
//
// Eén bron van waarheid voor de indexmigraties, `buildEvidenceLijst`, de
// koppelroute én de generieke sanity-test. Zo is er geen tweede plek waar iemand
// `procedure_id` intikt waar `decision_id` hoort.
//
// Waarom dossier-lokaal en niet uniform procedure-scoped: procedure↔decision is
// niet gegarandeerd 1:1 (partiële unique op één *primary* decision per procedure;
// niet-primary is een datamodel-toleratie). Een besluitgebonden feit (risico,
// aanname) hoort bij één Decision Object; een procesgebonden feit (bewijs, besluit,
// vaststelling) bij de procedure en wordt gedeeld tussen besluiten op diezelfde
// procedure. In het 1:1-geval (de MVP-norm — niet-primary decisions worden nergens
// aangemaakt) vallen beide samen. Zie besluit 0189.

import type { RequirementType } from "./decision-view";

export type BronScope = "decision" | "procedure";

export interface BronDefinitie {
  /** Brontabel met de gebonden feiten (draagt `requirement_sleutel`). */
  brontabel: string;
  /** FK-kolom op de brontabel die het dossier lokaal aanwijst — de scope waarop
   *  geïndexeerd en geteld wordt. `stap_id` voor `procedure_bewijs` (de sleutel
   *  pint de stap; staps zijn uniek per procedure, dus dat telt procesbreed). */
  scopeKolom: "decision_id" | "procedure_id" | "stap_id";
  /** Hoort het feit bij één besluit of bij de procedure (gedeeld)? */
  scope: BronScope;
}

/**
 * `Record<RequirementType, …>` dwingt af dat elk type een bron declareert; een
 * NIEUW type zonder entry faalt de typecheck (en de generieke sanity-test).
 * `field` is de gemotiveerde uitzondering (geen gebonden feit): `null`.
 */
export const REQUIREMENT_BRON: Record<RequirementType, BronDefinitie | null> = {
  // ── Procesgebonden (procedure-scoped) — gedeeld tussen besluiten op de procedure.
  document: { brontabel: "procedure_bewijs", scopeKolom: "stap_id", scope: "procedure" },
  external_submission: { brontabel: "procedure_bewijs", scopeKolom: "stap_id", scope: "procedure" },
  consultation: { brontabel: "procedure_bewijs", scopeKolom: "stap_id", scope: "procedure" },
  approval: { brontabel: "procedure_besluiten", scopeKolom: "procedure_id", scope: "procedure" },
  mandate_check: { brontabel: "procedure_vaststelling", scopeKolom: "procedure_id", scope: "procedure" },
  dissent_review: { brontabel: "procedure_vaststelling", scopeKolom: "procedure_id", scope: "procedure" },
  // ── Besluitgebonden (decision-scoped) — horen bij één Decision Object.
  ai_validation: { brontabel: "decision_ai_interactions", scopeKolom: "decision_id", scope: "decision" },
  assumption: { brontabel: "decision_assumptions", scopeKolom: "decision_id", scope: "decision" },
  risk: { brontabel: "decision_risks", scopeKolom: "decision_id", scope: "decision" },
  kpi: { brontabel: "decision_conditions", scopeKolom: "decision_id", scope: "decision" },
  evaluation: { brontabel: "decision_evaluations", scopeKolom: "decision_id", scope: "decision" },
  // ── Uitzondering: veld (veld_pad → besluitvraag/scope) of het governance-event
  //    classificatie_bevestigd. Geen gebonden feit → geen brontabel.
  field: null,
};

/** Alle requirement-typen (voor iteratie in de generieke sanity-test). */
export const ALLE_REQUIREMENT_TYPES = Object.keys(
  REQUIREMENT_BRON
) as RequirementType[];
