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

/**
 * De contextchips zoals `/ai` ze vandaag toont — een LIJST, geen enkel label.
 *
 * Dit was eerst één functie die één label gaf, afgeleid via `bepaalContextSoort`.
 * Dat was fout, en op een manier die pas in P1b pijn had gedaan: de
 * module-chip in de weergave heeft géén `!agendapuntContext`-guard, terwijl de
 * documentchip die wél heeft. Bij een module-scope naast een documentscope
 * staan er dus vandaag TWEE chips, en een enkel label had de actieve
 * documentscope stilzwijgend verzwegen — precies de chip die de bestuurder moet
 * vertellen waarop geantwoord wordt.
 *
 * De volgorde is die van de weergave: module, agendapunt, document.
 *
 * OPEN VOOR P1b: dat er twee chips náást elkaar kunnen staan is bestaand gedrag,
 * geen ontwerpkeuze. Het paneel toont één contextchip; beslis daar bewust wat er
 * gebeurt bij een samengestelde context — indikken (en wát dan wegvalt) of beide
 * tonen. Niet impliciet laten.
 *
 * Nog geen consument: P1a verandert geen letter aan het scherm en P1b bouwt de
 * chip toch opnieuw. Deze functie is het contract dat P1b erft.
 */
export function contextChipLabels(velden: {
  documentScope: DocumentScope | null;
  agendapuntContext: AgendapuntContext | null;
  moduleScope: ModuleScope | null;
}): string[] {
  const { documentScope, agendapuntContext, moduleScope } = velden;
  const chips: string[] = [];

  if (moduleScope) {
    chips.push(
      moduleScope.soort === "proces"
        ? `Proces: «${moduleScope.label}»`
        : moduleScope.soort === "risico"
          ? `Risico: «${moduleScope.label}»`
          : "Risicomatrix"
    );
  }

  if (agendapuntContext) {
    const aantal = documentScope?.document_ids.length ?? 0;
    const stukken =
      aantal > 0 ? `${aantal} ${aantal === 1 ? "stuk" : "stukken"}` : "geen stukken";
    chips.push(`Agendapunt: «${agendapuntContext.titel}» · ${stukken}`);
  } else if (documentScope) {
    // De documentchip wijkt: hij verschijnt NIET naast een agendapunt, want dat
    // agendapunt draagt zijn stukken al in zijn eigen chip.
    const extra = documentScope.document_ids.length - 1;
    chips.push(
      `Onderwerp: «${documentScope.titels[0] || "dit document"}»${
        extra > 0 ? ` +${extra}` : ""
      }`
    );
  }

  return chips;
}

/**
 * De ENE contextchip van het paneel: waar kijkt de assistent naar, en wat valt
 * daar qua bronnen onder? (T1, besluit 0204.)
 *
 * Hiermee is het openstaande punt uit `contextChipLabels` beslecht. Dat de
 * weergave op `/ai` bij een samengestelde context TWEE chips kan tonen is
 * bestaand gedrag, geen ontwerpkeuze — maar indikken tot één label mag de
 * tweede scope niet verzwijgen. Een bestuurder die "Proces · «Invaren»" leest
 * terwijl er óók een documentscope actief is, krijgt een antwoord dat hij niet
 * kan plaatsen.
 *
 * De oplossing: het LABEL toont de meest specifieke context (dezelfde
 * precedentie als `bepaalContextSoort` en als de server), en de tweede scope
 * verdwijnt niet maar staat op de regel `bronbereik` eronder. Eén chip, niets
 * verzwegen.
 *
 * `losTeLaten` is false bij fondsbreed: er is dan niets om los te laten, en een
 * kruisje dat niets doet is erger dan geen kruisje.
 */
export interface ContextChip {
  label: string;
  bronbereik: string;
  losTeLaten: boolean;
}

export function contextChip(velden: {
  documentScope: DocumentScope | null;
  agendapuntContext: AgendapuntContext | null;
  moduleScope: ModuleScope | null;
}): ContextChip {
  const { documentScope, agendapuntContext, moduleScope } = velden;
  const aantalStukken = documentScope?.document_ids.length ?? 0;
  const stukken = `${aantalStukken} ${aantalStukken === 1 ? "stuk" : "stukken"}`;

  if (agendapuntContext) {
    return {
      label: `Agendapunt · «${agendapuntContext.titel}»`,
      bronbereik:
        aantalStukken > 0
          ? `${stukken} bij dit agendapunt`
          : "geen gekoppelde stukken — de assistent zoekt fondsbreed",
      losTeLaten: true,
    };
  }

  if (moduleScope) {
    // Een documentscope náást een module-scope is zeldzaam maar mogelijk (een
    // stuk openen zet hem, de module-ingang wist hem niet). Hij hoort dus in
    // het bronbereik, anders verdwijnt hij uit beeld terwijl hij wél meegaat.
    const ernaast = aantalStukken > 0 ? ` · daarnaast ${stukken}` : "";
    if (moduleScope.soort === "proces") {
      return {
        label: `Proces · «${moduleScope.label}»`,
        bronbereik: `het procesdossier en de stukken die eraan hangen${ernaast}`,
        losTeLaten: true,
      };
    }
    if (moduleScope.soort === "risico") {
      return {
        label: `Risico · «${moduleScope.label}»`,
        bronbereik: `dit risico en wat eraan gekoppeld is${ernaast}`,
        losTeLaten: true,
      };
    }
    return {
      label: "Risicomatrix",
      bronbereik: `alle open risico's van het fonds${ernaast}`,
      losTeLaten: true,
    };
  }

  if (documentScope) {
    const extra = documentScope.document_ids.length - 1;
    return {
      label: `Document · «${documentScope.titels[0] || "dit document"}»${
        extra > 0 ? ` +${extra}` : ""
      }`,
      bronbereik:
        documentScope.algemene_kennis === true
          ? `${stukken} plus algemene kennis`
          : `alleen ${stukken}`,
      losTeLaten: true,
    };
  }

  return {
    label: "Fondsbreed",
    bronbereik: "alle vastgestelde stukken van het fonds",
    losTeLaten: false,
  };
}
