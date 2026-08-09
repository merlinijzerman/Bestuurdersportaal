// ============================================================================
// T6 — Afschrift (auditdossier-bundel): gedeelde invoer- en outputtypen.
// ----------------------------------------------------------------------------
// De bundel wordt procesbreed gebouwd: één proces, mogelijk meerdere Decision
// Objects. De deterministische libs (feitenkaart, tijdlijn, manifest, docx,
// bundel) consumeren UITSLUITEND deze getypeerde invoer — nooit los Supabase.
// Zo zijn ze puur en zonder DB sanity-testbaar (fixtures = deze typen).
//
// LAAGSCHEIDING (T6-ontwerp): dit bestand hoort bij laag B (afgeleid, code,
// deterministisch). De feitenkaart is de enige brug naar laag C (AI, fase 2):
// het model mag geen feit gebruiken dat niet in de feitenkaart staat.
// ============================================================================

import type {
  DecisionDossierView,
  DecisionStatus,
  Vertrouwelijkheid,
} from "./decision-view";

export type AfschriftVersie = "actueel" | "besluitmoment";

/** Eén regel uit `procedure_log` (procesniveau-auditspoor). */
export interface ProcedureLogEntry {
  id: string;
  procedure_id: string;
  event_type: string;
  actor_naam: string | null;
  payload: Record<string, unknown>;
  tijdstip: string; // ISO
}

/**
 * Contextgegevens die de route/worker vaststelt (niet af te leiden uit de
 * dossierview zelf). Bewust alle deterministisch: `aangemaaktOp` is het
 * generatietijdstip en dient óók als eind-anker voor doorlooptijd wanneer het
 * proces nog loopt (zo blijft de feitenkaart reproduceerbaar).
 */
export interface AfschriftContext {
  afschriftId: string;
  /** Herkenbare procescode voor bestandsnaam/manifest (bv. primair besluit_code
      of een afgeleide korte code). */
  procescode: string;
  versie: AfschriftVersie;
  aanleiding: string | null;
  aangemaaktOp: string; // ISO — generatietijdstip
  aangemaaktDoorNaam: string | null;
  /** Rol van de aanvrager — de gezichtshoek van de bundel (ADR-3/ADR-5). */
  gebouwdOnderRol: string | null;
  /** Versie van de bundelgenerator, voor het manifest. */
  generatorVersie: string;
}

/**
 * De volledige procesbrede invoer voor de bundelbouw. `decisions` bevat één
 * view per Decision Object van dit proces. De procesbrede collecties (bewijs,
 * besluiten, steps, procedure) zijn identiek in elke view van hetzelfde proces
 * en worden door de libs ééns ontdubbeld (uit `decisions[0]`).
 */
export interface AfschriftBron {
  context: AfschriftContext;
  decisions: DecisionDossierView[];
  procedureLog: ProcedureLogEntry[];
}

// ── Feitenkaart (C7) ────────────────────────────────────────────────────────

/** Telling + verdeling over statussen (alleen voorkomende statussen). */
export interface Telling {
  totaal: number;
  perStatus: Record<string, number>;
}

export interface DissentTelling {
  totaal: number;
  formeel: number;
  perZichtbaarheid: Record<string, number>;
}

export interface BewijsTelling {
  totaal: number;
  metDocument: number;
  zonderDocument: number;
}

/** Per Decision Object: karakter + aantallen (voedt leeswijzer §3/§4). */
export interface BesluitFeiten {
  besluitCode: string;
  titel: string;
  status: DecisionStatus;
  statusLabel: string;
  vertrouwelijkheid: Vertrouwelijkheid;
  aannames: Telling;
  risicos: Telling;
  voorwaarden: Telling;
  acties: Telling;
  dissent: DissentTelling;
  vastgelegdeBesluiten: { totaal: number; laatsteDatum: string | null };
  /** Datum eerste/laatste vastlegging binnen dit besluit (ISO of null). */
  eersteVastlegging: string | null;
  laatsteVastlegging: string | null;
}

export interface Feitenkaart {
  procescode: string;
  procedureTitel: string;
  versie: AfschriftVersie;
  aanleiding: string | null;
  aangemaaktOp: string;
  aantalBesluiten: number;
  hoogsteVertrouwelijkheid: Vertrouwelijkheid;
  /** Doorlooptijd in hele dagen: gestart_op → afgerond_op ?? aangemaaktOp. */
  doorlooptijdDagen: number | null;
  onderbouwingsfase: { start: string | null; eind: string | null };
  besluiten: BesluitFeiten[];
  bewijs: BewijsTelling;
  /** Sommen over alle besluiten (voor de leeswijzer-samenvatting §3). */
  totalen: {
    aannames: number;
    aannamesGevalideerd: number;
    risicos: number;
    risicosGeaccepteerd: number;
    voorwaarden: number;
    voorwaardenOpen: number;
    acties: number;
    dissent: number;
    dissentFormeel: number;
  };
  /** Benoemde afwijkingen (overrulings, heropeningen, blokkerende ontbrekende
      requirements, ontbrekende bijlagen) — beschrijvend, niet oordelend. */
  afwijkingen: string[];
}

/** Ordinale rangschikking van vertrouwelijkheid (laag → hoog). */
export const VERTROUWELIJKHEID_RANG: Record<Vertrouwelijkheid, number> = {
  publiek: 0,
  intern: 1,
  vertrouwelijk: 2,
  strikt_vertrouwelijk: 3,
};

export const VERTROUWELIJKHEID_LABEL: Record<Vertrouwelijkheid, string> = {
  publiek: "Publiek",
  intern: "Intern",
  vertrouwelijk: "Vertrouwelijk",
  strikt_vertrouwelijk: "Strikt vertrouwelijk",
};
