// Decision Dossier View — frontend contract voor de samengestelde view
// op één Decision Object. Spiegelt de output van de Postgres-functie
// `fn_build_decision_dossier(decision_id)` aangevuld met velden die de
// API-route zelf berekent (readiness, evidence, snapshots-meta).
//
// Bron: `PROCEDURE-MVP1-ONTWERP.md` sectie 7.1 (rev. 2.1).
//
// Conventies:
//   • Alle datum/tijd-velden zijn ISO-strings (JSON-serialisatie van timestamptz/date).
//   • Velden die in de DB nullable zijn, krijgen hier `string | null` of `?`.
//   • Enums worden als string-literals getypeerd zodat de UI exhaustive
//     match kan doen zonder runtime-checks.

// ── Status-modellen ───────────────────────────────────────────────────

export type DecisionStatus =
  | "concept"
  | "in_onderbouwing"
  | "in_validatie"
  | "in_review"
  | "geagendeerd"
  | "in_bespreking"
  | "besloten"
  | "voorwaardelijk_besloten"
  | "afgewezen"
  | "aangehouden"
  | "geescaleerd"
  | "teruggezet"
  | "in_uitvoering"
  | "in_evaluatie"
  | "afgesloten"
  | "heropend"
  | "geannuleerd";

export type ProcedureStatus = "in_uitvoering" | "wacht_op_besluit" | "afgerond";

export type StapStatus = "open" | "actief" | "afgerond";

export type Vertrouwelijkheid =
  | "publiek"
  | "intern"
  | "vertrouwelijk"
  | "strikt_vertrouwelijk";

export type Complexiteit = "routine" | "complicated" | "complex";

export type Risiconiveau = "laag" | "middel" | "hoog";

export type AIRisicoklasse = Risiconiveau;

// ── Sub-objecten ──────────────────────────────────────────────────────

export interface DecisionObject {
  id: string;
  procedure_id: string;
  fonds_id: string;
  besluit_code: string;
  titel: string;
  besluitvraag: string;
  aanleiding: string | null;
  scope: string | null;
  governance_orgaan: string | null;
  vertrouwelijkheid: Vertrouwelijkheid;

  // Classificatie — zes onafhankelijke dimensies (sectie 4.1)
  complexiteit: Complexiteit;
  risiconiveau: Risiconiveau;
  mandaatgevoelig: boolean;
  toezichtgevoelig: boolean;
  beleidsafwijking: boolean;
  ai_risicoklasse: AIRisicoklasse;

  status: DecisionStatus;
  is_primary_decision: boolean;
  eigenaar_id: string | null;
  eigenaar_naam: string | null;
  template_versie: string | null;
  gewenste_besluitdatum: string | null;
  aangemaakt_op: string;
  laatst_gewijzigd: string;
}

export interface ProcedureSummary {
  id: string;
  fonds_id: string;
  template_code: string;
  titel: string;
  beschrijving: string | null;
  status: ProcedureStatus;
  gestart_op: string;
  gestart_door: string | null;
  deadline: string | null;
  afgerond_op: string | null;
  decision_id: string | null;
}

export interface ProcedureStep {
  id: string;
  procedure_id: string;
  volgorde: number;
  naam: string;
  beschrijving: string | null;
  vereist_besluit: boolean;
  geschatte_dagen: number | null;
  status: StapStatus;
}

// ── Readiness ─────────────────────────────────────────────────────────

export type ReadinessTarget =
  | "onderbouwing_compleet"
  | "reviewrijp"
  | "bespreekrijp"
  | "besluitrijp"
  | "verantwoordingsrijp"
  | "evaluatierijp";

export type RequirementType =
  | "document"
  | "field"
  | "assumption"
  | "risk"
  | "ai_validation"
  | "approval"
  | "mandate_check"
  | "kpi"
  | "evaluation"
  | "dissent_review";

export interface ReadinessOntbrekend {
  requirement_type: RequirementType;
  stap_volgorde: number;
  label: string;
  documenttype: string | null;
  blokkerend: boolean;
}

export interface ReadinessResult {
  decision_id: string;
  target: ReadinessTarget;
  voldoet: boolean;
  blokkerend: boolean;
  kan_overrulen: string[];
  ontbrekend: ReadinessOntbrekend[];
}

export interface ReadinessOverview {
  onderbouwing_compleet: ReadinessResult;
  reviewrijp: ReadinessResult;
  bespreekrijp: ReadinessResult;
  besluitrijp: ReadinessResult;
  verantwoordingsrijp: ReadinessResult;
  evaluatierijp: ReadinessResult;
}

// ── Evidence (samengesteld uit bewijs + requirements) ─────────────────

export interface EvidenceItem {
  requirement_type: RequirementType;
  stap_volgorde: number;
  label: string;
  documenttype: string | null;
  verplicht: boolean;
  blokkerend: boolean;
  vervuld: boolean;
  // Ondersteunende verwijzing — voor 'document' is dit het bewijsstuk,
  // voor andere types is het de eerste matchende kindrij (bijv. een
  // gevalideerde aanname of een AI-output).
  bron_type: "procedure_bewijs" | "ai_output" | "assumption" | "risk" | "condition" | "evaluation" | "governance_event" | null;
  bron_id: string | null;
  bron_titel: string | null;
}

// ── Decision-children ─────────────────────────────────────────────────

export type AssumptionType =
  | "macro"
  | "beleggingsinhoudelijk"
  | "risico"
  | "kosten"
  | "governance"
  | "overig";

export type AssumptionStatus =
  | "concept"
  | "gevalideerd"
  | "gewijzigd"
  | "verwijderd";

export interface Assumption {
  id: string;
  decision_id: string;
  tekst: string;
  type: AssumptionType;
  bron_document_id: string | null;
  ai_gedetecteerd: boolean;
  status: AssumptionStatus;
  onzekerheid: Risiconiveau | null;
  evaluatiecriterium: string | null;
  aangemaakt_op: string;
  gewijzigd_door: string | null;
}

export type RiskCategorie =
  | "financieel"
  | "operationeel"
  | "juridisch"
  | "reputatie"
  | "liquiditeit"
  | "compliance"
  | "overig";

export type RiskStatus = "open" | "gemitigeerd" | "geaccepteerd";

export interface RiskItem {
  id: string;
  decision_id: string;
  risicomatrix_id: string | null;
  categorie: RiskCategorie | null;
  beschrijving: string;
  impact: number | null;
  kans: number | null;
  eigenaar_naam: string | null;
  mitigatie: string | null;
  residual_risk: string | null;
  status: RiskStatus;
  aangemaakt_op: string;
}

// Scenario's zijn voorbereid op MVP-2 maar leeg in MVP-1.
export interface Scenario {
  id: string;
  decision_id: string;
  naam: string;
  beschrijving: string | null;
}

export type DissentZichtbaarheid =
  | "prive"
  | "gedeelde_zorg"
  | "formele_dissent"
  | "minderheidsnotitie";

export interface DissentItem {
  id: string;
  decision_id: string;
  bestuurder_id: string | null;
  bestuurder_naam: string;
  zichtbaarheid: DissentZichtbaarheid;
  formeel_vastgesteld: boolean;
  standpunt: string;
  argument: string | null;
  gekoppeld_risico_id: string | null;
  gekoppeld_aanname_id: string | null;
  gekoppeld_voorwaarde_id: string | null;
  aangemaakt_op: string;
}

export type ConditionStatus =
  | "open"
  | "op_schema"
  | "afwijking"
  | "vervuld"
  | "overschreden";

export interface DecisionCondition {
  id: string;
  decision_id: string;
  voorwaarde: string;
  eigenaar_naam: string | null;
  kpi: string | null;
  drempelwaarde: string | null;
  monitorfrequentie: string | null;
  deadline: string | null;
  heroverwegingstrigger: string | null;
  status: ConditionStatus;
  aangemaakt_op: string;
}

export type ActionStatus =
  | "open"
  | "in_behandeling"
  | "afgerond"
  | "vervallen"
  | "escalatie";

export interface ActionItem {
  id: string;
  decision_id: string;
  voorwaarde_id: string | null;
  actie: string;
  eigenaar_naam: string | null;
  deadline: string | null;
  status: ActionStatus;
  afhankelijk_van: string | null;
  aangemaakt_op: string;
}

export interface Evaluation {
  id: string;
  decision_id: string;
  geplande_datum: string;
  uitgevoerd_op: string | null;
  verwachte_effecten: string | null;
  realisatie: string | null;
  afwijkingsanalyse: string | null;
  conclusie: string | null;
  lessons_learned: string | null;
  uitgevoerd_door: string | null;
  aangemaakt_op: string;
}

export type AIType =
  | "samenvatting"
  | "aannamedetectie"
  | "scenario"
  | "kritische_vraag"
  | "vergelijking";

export type AIValidatieStatus =
  | "concept"
  | "gevalideerd"
  | "aangepast"
  | "afgekeurd"
  | "gearchiveerd";

export type AIValidatieDomein =
  | "algemeen"
  | "risk"
  | "compliance"
  | "beleggingen"
  | "governance";

export interface AIBron {
  document_id?: string;
  titel?: string;
  paragraaf?: string | null;
  fragment?: string | null;
}

/**
 * Type-guard voor één bron-element. Gebruikt door
 * `validateAIBronnenPayload()` en bedoeld als import voor toekomstige
 * insert-routes op `decision_ai_interactions`. De DB-CHECK
 * `chk_bronnen_array` garandeert het type op rij-niveau; deze helper
 * garandeert het element-schema op API-niveau.
 */
export function isAIBron(x: unknown): x is AIBron {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  if (o.document_id !== undefined && typeof o.document_id !== "string") return false;
  if (o.titel !== undefined && typeof o.titel !== "string") return false;
  if (
    o.paragraaf !== undefined &&
    o.paragraaf !== null &&
    typeof o.paragraaf !== "string"
  )
    return false;
  if (
    o.fragment !== undefined &&
    o.fragment !== null &&
    typeof o.fragment !== "string"
  )
    return false;
  return true;
}

/**
 * Valideert dat een onbekende waarde een array van geldige AIBron-elementen
 * is. Retourneert ofwel de waarde als getypeerde `AIBron[]`, of een
 * foutboodschap voor de API-response. Bedoeld voor inzet in een
 * toekomstige `POST /api/decisions/[id]/ai-interactions`-route.
 *
 * @example
 *   const { ok, value, error } = validateAIBronnenPayload(body.bronnen);
 *   if (!ok) return NextResponse.json({ error }, { status: 400 });
 *   await supabase.from("decision_ai_interactions").insert({ ..., bronnen: value });
 */
export function validateAIBronnenPayload(
  input: unknown
): { ok: true; value: AIBron[] } | { ok: false; error: string } {
  if (input === undefined || input === null) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(input)) {
    return { ok: false, error: "Veld 'bronnen' moet een array zijn." };
  }
  for (let i = 0; i < input.length; i++) {
    if (!isAIBron(input[i])) {
      return {
        ok: false,
        error: `Element bronnen[${i}] voldoet niet aan het AIBron-schema (document_id?/titel?/paragraaf?/fragment?, alle strings).`,
      };
    }
  }
  return { ok: true, value: input as AIBron[] };
}

export interface AIInteraction {
  id: string;
  decision_id: string;
  procedure_stap_id: string | null;
  type: AIType;
  prompt: string;
  bronnen: AIBron[];
  model: string;
  modelversie: string | null;
  output: string;
  validatiestatus: AIValidatieStatus;
  gevalideerd_door: string | null;
  gevalideerd_op: string | null;
  aangepaste_output: string | null;
  gebruikt_in_dossier: boolean;
  gebruik_context: string | null;
  verworpen_reden: string | null;
  validatie_domein: AIValidatieDomein;
  aangemaakt_op: string;
  aangemaakt_door: string | null;
}

export interface GovernanceEvent {
  id: string;
  decision_id: string | null;
  event_type: string;
  actor_id: string | null;
  actor_naam: string | null;
  object_type: string | null;
  object_id: string | null;
  oude_waarde: unknown;
  nieuwe_waarde: unknown;
  reden: string | null;
  hash: string;
  tijdstip: string;
}

export interface AuditSnapshotMeta {
  id: string;
  decision_id: string;
  trigger_status: DecisionStatus;
  hash: string;
  aangemaakt_op: string;
}

/**
 * Vastgelegd besluit uit `procedure_besluiten`. Voor het auditdossier
 * is dit het hart: welk besluit is genomen, met welke motivering, op
 * welke datum, en welke alternatieven zijn expliciet verworpen.
 */
export interface BesluitItem {
  id: string;
  procedure_id: string;
  stap_id: string | null;
  decision_id: string | null;
  formulering: string;
  motivering: string | null;
  datum: string;
  vastgelegd_door_naam: string | null;
  /** 1D-3: lijst van expliciet overwogen en verworpen alternatieven. */
  verworpen_alternatieven: string[] | null;
  vergadering_id: string | null;
  agendapunt_id: string | null;
}

/**
 * Bewijsstuk gekoppeld aan een procedure-stap. Komt direct uit
 * `procedure_bewijs`. Voor het auditdossier is dit een eerste-orde-
 * vraag: welke onderbouwing is toegevoegd, door wie, wanneer, en
 * (sinds 1D-4) van welk documenttype.
 */
export interface BewijsItem {
  id: string;
  stap_id: string;
  /** Optionele FK naar `documenten.id`. Als gezet, kan het origineel
      bestand bekeken worden via `/api/documents/[id]/bestand`. */
  document_id: string | null;
  titel: string;
  beschrijving: string | null;
  /** 1D-4: tag die overeenkomt met procedure_requirements.documenttype. */
  documenttype: string | null;
  toegevoegd_op: string;
  toegevoegd_door_naam: string | null;
}

// ── Hoofd-view ─────────────────────────────────────────────────────────

export interface DecisionDossierView {
  decision: DecisionObject;
  procedure: ProcedureSummary;
  currentStep: ProcedureStep | null;
  steps: ProcedureStep[];
  readiness: ReadinessOverview;
  evidence: EvidenceItem[];
  /** Alle bewijsstukken (procedure_bewijs) gekoppeld aan stappen
      van deze procedure, gesorteerd op stap_volgorde dan
      toegevoegd_op. Onderdeel van het auditdossier. */
  bewijs: BewijsItem[];
  /** Vastgelegde besluiten met motivering en verworpen alternatieven. */
  besluiten: BesluitItem[];
  assumptions: Assumption[];
  risks: RiskItem[];
  scenarios: Scenario[];
  aiOutputs: AIInteraction[];
  dissent: DissentItem[];
  conditions: DecisionCondition[];
  actions: ActionItem[];
  evaluations: Evaluation[];
  events: GovernanceEvent[];
  snapshots: AuditSnapshotMeta[];
  // Of dit dossier zojuist via auto-upgrade is aangemaakt — handig
  // voor de UI om een banner te tonen "wij hebben er voor u één
  // gemaakt, vul de velden aan".
  auto_upgraded: boolean;
}

// ── Labels voor weergave ──────────────────────────────────────────────

export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  concept: "Concept",
  in_onderbouwing: "In onderbouwing",
  in_validatie: "In validatie",
  in_review: "In review",
  geagendeerd: "Geagendeerd",
  in_bespreking: "In bespreking",
  besloten: "Besloten",
  voorwaardelijk_besloten: "Voorwaardelijk besloten",
  afgewezen: "Afgewezen",
  aangehouden: "Aangehouden",
  geescaleerd: "Geëscaleerd",
  teruggezet: "Teruggezet",
  in_uitvoering: "In uitvoering",
  in_evaluatie: "In evaluatie",
  afgesloten: "Afgesloten",
  heropend: "Heropend",
  geannuleerd: "Geannuleerd",
};

export const READINESS_LABEL: Record<ReadinessTarget, string> = {
  onderbouwing_compleet: "Onderbouwing compleet",
  reviewrijp: "Reviewrijp",
  bespreekrijp: "Bespreekrijp",
  besluitrijp: "Besluitrijp",
  verantwoordingsrijp: "Verantwoordingsrijp",
  evaluatierijp: "Evaluatierijp",
};

export const READINESS_VOLGORDE: ReadinessTarget[] = [
  "onderbouwing_compleet",
  "reviewrijp",
  "bespreekrijp",
  "besluitrijp",
  "verantwoordingsrijp",
  "evaluatierijp",
];

export const COMPLEXITEIT_LABEL: Record<Complexiteit, string> = {
  routine: "Routine",
  complicated: "Complicated",
  complex: "Complex",
};

export const RISICONIVEAU_LABEL: Record<Risiconiveau, string> = {
  laag: "Laag",
  middel: "Middel",
  hoog: "Hoog",
};

export const ASSUMPTION_TYPE_LABEL: Record<AssumptionType, string> = {
  macro: "Macro-economisch",
  beleggingsinhoudelijk: "Beleggingsinhoudelijk",
  risico: "Risico",
  kosten: "Kosten",
  governance: "Governance",
  overig: "Overig",
};

export const ASSUMPTION_STATUS_LABEL: Record<AssumptionStatus, string> = {
  concept: "Concept",
  gevalideerd: "Gevalideerd",
  gewijzigd: "Gewijzigd",
  verwijderd: "Verwijderd",
};

export const RISK_CATEGORIE_LABEL: Record<RiskCategorie, string> = {
  financieel: "Financieel",
  operationeel: "Operationeel",
  juridisch: "Juridisch",
  reputatie: "Reputatie",
  liquiditeit: "Liquiditeit",
  compliance: "Compliance",
  overig: "Overig",
};

export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  open: "Open",
  gemitigeerd: "Gemitigeerd",
  geaccepteerd: "Geaccepteerd",
};

export const DISSENT_ZICHTBAARHEID_LABEL: Record<DissentZichtbaarheid, string> = {
  prive: "Privé",
  gedeelde_zorg: "Gedeelde zorg",
  formele_dissent: "Formele dissent",
  minderheidsnotitie: "Minderheidsnotitie",
};

/** Korte uitleg per zichtbaarheidsniveau, voor tooltip / hint in de UI. */
export const DISSENT_ZICHTBAARHEID_HINT: Record<DissentZichtbaarheid, string> = {
  prive: "Alleen voor jezelf — niet zichtbaar voor anderen.",
  gedeelde_zorg:
    "Zichtbaar voor voorzitter en beheerder. Nog geen formele vastlegging in het dossier.",
  formele_dissent:
    "Zichtbaar voor alle bestuurders binnen het fonds. Onderdeel van het auditdossier.",
  minderheidsnotitie:
    "Zichtbaar voor alle bestuurders. Bewust gemarkeerd als minderheidsnotitie bij het besluit.",
};

export const CONDITION_STATUS_LABEL: Record<ConditionStatus, string> = {
  open: "Open",
  op_schema: "Op schema",
  afwijking: "Afwijking",
  vervuld: "Vervuld",
  overschreden: "Overschreden",
};

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  open: "Open",
  in_behandeling: "In behandeling",
  afgerond: "Afgerond",
  vervallen: "Vervallen",
  escalatie: "Escalatie",
};

// ── Status-mapping legacy → nieuw (auto-upgrade) ───────────────────────

/**
 * Mappingvan een legacy `procedures.status` naar een geldige
 * `decision_objects.status` voor auto-upgrade. Wordt bewust beperkt
 * tot drie eindbestemmingen omdat we anders ongeldige overgangen via
 * de status-trigger zouden moeten omzeilen — bij een INSERT geldt de
 * trigger niet, dus deze waarden zijn aanmaakbaar zonder workarounds.
 */
export function mapLegacyStatus(legacy: ProcedureStatus): DecisionStatus {
  switch (legacy) {
    case "in_uitvoering":
      return "in_onderbouwing";
    case "wacht_op_besluit":
      return "in_review";
    case "afgerond":
      return "afgesloten";
    default:
      return "in_onderbouwing";
  }
}

/**
 * Omgekeerde mapping: 14-status Decision Object → 3-status legacy
 * `procedures.status`. Wordt aangeroepen na een statusovergang op
 * het Decision Object zodat het procedure-overzicht (/procedures)
 * een consistente status toont.
 *
 * Mapping:
 *   • afgewezen / geannuleerd / afgesloten            → 'afgerond'
 *   • in_review / geagendeerd / in_bespreking         → 'wacht_op_besluit'
 *   • alle overige (concept, in_onderbouwing,
 *     in_validatie, besloten, voorwaardelijk_besloten,
 *     in_uitvoering, in_evaluatie, aangehouden,
 *     geescaleerd, teruggezet, heropend)               → 'in_uitvoering'
 *
 * Voor 'besloten' en 'voorwaardelijk_besloten' kiezen we bewust
 * 'in_uitvoering' (legacy) i.p.v. 'wacht_op_besluit', omdat de
 * legacy-semantiek van 'wacht_op_besluit' is "klaar voor
 * bestuursbespreking", niet "besluit genomen".
 */
export function mapDecisionToProcedureStatus(
  status: DecisionStatus
): ProcedureStatus {
  switch (status) {
    case "afgewezen":
    case "geannuleerd":
    case "afgesloten":
      return "afgerond";
    case "in_review":
    case "geagendeerd":
    case "in_bespreking":
      return "wacht_op_besluit";
    default:
      return "in_uitvoering";
  }
}
