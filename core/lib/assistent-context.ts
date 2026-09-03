// ============================================================================
//  Assistent L1 — CONTEXT: waar kijkt de bestuurder naar? (P1a, besluit 0201)
// ----------------------------------------------------------------------------
//  De contextlaag houdt één ding vast: het onderwerp waarover de bestuurder de
//  assistent aanspreekt. Modules leveren alléén dat aan — ze bouwen geen eigen
//  aanroep en kennen de payload niet. Dat is de regel die de divergentie
//  structureel voorkomt (ontwerpdoc "Eén generieke assistent" §4): kan een
//  module iets niet, dan is dat een keuze in deze laag en dus zichtbaar in de
//  contextchip, niet een stilzwijgend verschil in wat er naar de server gaat.
//
//  DRIE VELDEN, GEEN UNION — bewust. Het doelbeeld beschrijft de context als
//  één keuze uit een rij (fondsbreed · document · agendapunt · risico ·
//  procesdossier), maar in de code kunnen ze SAMEN bestaan: een agendapunt
//  draagt zijn stukken als documentscope, en een module-scope sluit een
//  documentscope niet uit. Ze in één discriminated union persen zou dat
//  afdwingen en dus gedrag veranderen. `bepaalContextSoort` leidt de soort dus
//  AF; hij wordt niet opgeslagen.
//
//  ZES SOORTEN, GEEN VIJF. `risicomatrix` (de hele matrix) en `risico` (één rij,
//  na inzoomen met een verdiep-chip) zijn in de code echt verschillend — de chip
//  "← hele risicomatrix" bestaat alleen daardoor. Zie besluit 0151.
//
//  Puur: geen React, geen IO.
// ============================================================================

import type {
  AgendapuntContext,
  DocumentScope,
  ModuleScope,
} from "@/core/lib/assistent-types";
import type { Herkomst } from "@/core/lib/assistent-payload";

/** Waar de bestuurder naar kijkt, afgeleid uit de gezette velden. */
export type AssistentContextSoort =
  | "fondsbreed"
  | "document"
  | "agendapunt"
  | "proces"
  | "risicomatrix"
  | "risico";

/**
 * De waarde die de contextlaag aan de gespreks- en presentatielaag levert.
 *
 * De setters heten `zet…` en niet `set…`: het zijn geen kale React-setters maar
 * de publieke handelingen van deze laag, en ze blijven dat als er straks een
 * paneel naast een module hangt (P1b).
 */
export interface AssistentContextWaarde {
  documentScope: DocumentScope | null;
  zetDocumentScope: (scope: DocumentScope | null) => void;
  agendapuntContext: AgendapuntContext | null;
  zetAgendapuntContext: (context: AgendapuntContext | null) => void;
  moduleScope: ModuleScope | null;
  zetModuleScope: (scope: ModuleScope | null) => void;
  /** De risico's van het fonds, voor de "verdiep dit risico"-chips (RLS-lijst). */
  risicoLijst: { id: string; titel: string }[];
  zetRisicoLijst: (lijst: { id: string; titel: string }[]) => void;
  /** De module-ingang (`?intent=`/`?herkomst=`): een bevestigde bron-intentie. */
  herkomst: Herkomst | null;
  zetHerkomst: (herkomst: Herkomst | null) => void;
  /** Afgeleid, niet opgeslagen. */
  soort: AssistentContextSoort;
}

/**
 * Leidt af waar de bestuurder naar kijkt.
 *
 * Volgorde van specifiek naar breed, en gelijk aan de precedentie die de
 * server hanteert: een agendapunt is de framing óók als er stukken bij horen,
 * en een module-scope wint van een losse documentscope omdat de route de
 * intent-heuristiek dan uitzet.
 */
export function bepaalContextSoort(velden: {
  documentScope: DocumentScope | null;
  agendapuntContext: AgendapuntContext | null;
  moduleScope: ModuleScope | null;
}): AssistentContextSoort {
  if (velden.agendapuntContext) return "agendapunt";
  if (velden.moduleScope) return velden.moduleScope.soort;
  if (velden.documentScope) return "document";
  return "fondsbreed";
}

/** Leest de jsonb-scope uit een gesprek terug naar de UI-vorm (of null). */
export function leesScope(ruw: unknown): DocumentScope | null {
  if (!ruw || typeof ruw !== "object") return null;
  const o = ruw as { document_ids?: unknown; titels?: unknown };
  const ids = Array.isArray(o.document_ids)
    ? o.document_ids.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) return null;
  const titels = Array.isArray(o.titels)
    ? o.titels.filter((x): x is string => typeof x === "string")
    : [];
  const ak = (ruw as { algemene_kennis?: unknown }).algemene_kennis === true;
  return { document_ids: ids, titels, algemene_kennis: ak };
}

/**
 * Leest het (additieve) agendapunt_context-blok uit een opgeslagen gesprek
 * terug, zodat een hervat agendapunt-gesprek de framing behoudt.
 */
export function leesAgendapuntContext(ruw: unknown): AgendapuntContext | null {
  if (!ruw || typeof ruw !== "object") return null;
  const o = (ruw as { agendapunt_context?: unknown }).agendapunt_context;
  if (!o || typeof o !== "object") return null;
  const id = (o as { id?: unknown }).id;
  const titel = (o as { titel?: unknown }).titel;
  if (typeof id !== "string" || id.length === 0) return null;
  return { id, titel: typeof titel === "string" && titel ? titel : "dit agendapunt" };
}
