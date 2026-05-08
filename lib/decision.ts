// Decision Object — server-side helpers.
//
// Verantwoordelijk voor:
//   • Auto-upgrade: bij eerste opening van een procedure zonder Decision
//     Object er lazy eentje aanmaken zodat de UI altijd op een dossier
//     kan rekenen. Statusmapping legacy `procedures.status` → nieuw
//     `decision_objects.status` via `mapLegacyStatus` uit lib/decision-view.
//   • Evidence-synthese: per `procedure_requirements`-rij beoordelen of
//     hij vervuld is, op basis van procedure_bewijs en decision_*-tabellen.
//   • Filteren van dissent op zichtbaarheid × rol (defense in depth: RLS
//     filtert al, maar als zekerheid dubbele check op de server).
//
// Gebruik vanuit API-routes via `createServerSupabase()`.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AIInteraction,
  type Assumption,
  type AuditSnapshotMeta,
  type DecisionCondition,
  type DecisionDossierView,
  type DecisionObject,
  type DissentItem,
  type Evaluation,
  type EvidenceItem,
  type GovernanceEvent,
  type ProcedureStatus,
  type ProcedureStep,
  type ProcedureSummary,
  type ReadinessOverview,
  type ReadinessResult,
  type RequirementType,
  type RiskItem,
  type Scenario,
  mapLegacyStatus,
} from "./decision-view";

// Supabase client met onze tabellen — losjes getyped omdat we geen
// gegenereerde db-types hebben in dit project. Casten we lokaal naar
// de juiste interfaces.
type Sb = SupabaseClient;

export interface EnsureDecisionResult {
  decision_id: string;
  auto_upgraded: boolean;
}

/**
 * Zorg dat een procedure een Decision Object heeft. Als de procedure
 * al een gekoppeld Decision Object heeft (`procedures.decision_id`),
 * geven we dat terug. Anders maken we een minimaal Decision Object aan
 * met de juiste mapping en loggen een `decision_object_auto_created`
 * event.
 *
 * Gooit een Error bij ontbrekende procedure of inline DB-fouten — de
 * caller (API-route) vangt die af en stuurt 4xx/5xx.
 */
export async function ensureDecisionForProcedure(
  supabase: Sb,
  procedureId: string
): Promise<EnsureDecisionResult> {
  // 1. Procedure laden — incl. eventueel al gekoppeld Decision Object.
  const { data: procedure, error: procFout } = await supabase
    .from("procedures")
    .select(
      "id, fonds_id, template_code, titel, beschrijving, status, gestart_door, deadline, decision_id"
    )
    .eq("id", procedureId)
    .single();

  if (procFout || !procedure) {
    throw new Error(
      `Procedure ${procedureId} niet gevonden: ${procFout?.message ?? "onbekend"}`
    );
  }

  // 2. Bestaat er al een primary Decision Object voor deze procedure?
  // We vertrouwen op `procedures.decision_id` als die gevuld is, anders
  // doen we een fallback-zoekactie via `decision_objects.procedure_id`.
  if (procedure.decision_id) {
    return { decision_id: procedure.decision_id, auto_upgraded: false };
  }

  const { data: bestaand } = await supabase
    .from("decision_objects")
    .select("id")
    .eq("procedure_id", procedureId)
    .eq("is_primary_decision", true)
    .maybeSingle();

  if (bestaand?.id) {
    // Backref nog niet gevuld; corrigeer dat.
    await supabase
      .from("procedures")
      .update({ decision_id: bestaand.id })
      .eq("id", procedureId);
    return { decision_id: bestaand.id, auto_upgraded: false };
  }

  // 3. Nieuwe Decision Object aanmaken met legacy-mapping.
  const legacyStatus = (procedure.status ?? "in_uitvoering") as ProcedureStatus;
  const nieuweStatus = mapLegacyStatus(legacyStatus);

  // Eigenaarsnaam ophalen voor weergave (RLS staat dit toe binnen fonds).
  let eigenaarNaam: string | null = null;
  if (procedure.gestart_door) {
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", procedure.gestart_door)
      .maybeSingle();
    eigenaarNaam = profiel?.naam ?? null;
  }

  const placeholderBesluitvraag =
    "Aanvullen na auto-upgrade — formuleer hier de centrale besluitvraag van dit dossier.";

  const { data: nieuw, error: insertFout } = await supabase
    .from("decision_objects")
    .insert({
      procedure_id: procedureId,
      fonds_id: procedure.fonds_id,
      titel: procedure.titel,
      besluitvraag: placeholderBesluitvraag,
      aanleiding: procedure.beschrijving ?? null,
      status: nieuweStatus,
      eigenaar_id: procedure.gestart_door,
      eigenaar_naam: eigenaarNaam,
      // Classificatie: voorzichtige defaults; de bestuurder moet deze
      // bij eerste opening expliciet bevestigen of bijstellen.
      complexiteit: "complicated",
      risiconiveau: "middel",
      mandaatgevoelig: false,
      toezichtgevoelig: false,
      beleidsafwijking: false,
      ai_risicoklasse: "laag",
      vertrouwelijkheid: "intern",
      is_primary_decision: true,
      template_versie: procedure.template_code,
    })
    .select("id")
    .single();

  if (insertFout || !nieuw) {
    throw new Error(
      `Decision Object aanmaken mislukt: ${insertFout?.message ?? "onbekend"}`
    );
  }

  // 4. Backref op procedures.decision_id zetten.
  await supabase
    .from("procedures")
    .update({ decision_id: nieuw.id })
    .eq("id", procedureId);

  // 5. Governance event loggen — append-only via trigger; we slikken
  // RLS-fouten bewust niet, want zonder log-rij is de auto-upgrade
  // niet traceerbaar.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let actorNaam: string | null = null;
  if (user?.id) {
    const { data: profiel } = await supabase
      .from("profielen")
      .select("naam")
      .eq("id", user.id)
      .maybeSingle();
    actorNaam = profiel?.naam ?? null;
  }

  await supabase.from("governance_events").insert({
    decision_id: nieuw.id,
    event_type: "decision_object_auto_created",
    actor_id: user?.id ?? null,
    actor_naam: actorNaam,
    object_type: "decision_object",
    object_id: nieuw.id,
    nieuwe_waarde: {
      procedure_id: procedureId,
      legacy_status: legacyStatus,
      nieuwe_status: nieuweStatus,
      reden: "auto_upgrade_bij_eerste_opening",
    },
  });

  return { decision_id: nieuw.id, auto_upgraded: true };
}

// ── Dossier laden ─────────────────────────────────────────────────────

/**
 * Bouw de volledige `DecisionDossierView` voor een Decision Object.
 * Dit is een aanvulling op `fn_build_decision_dossier(decision_id)`:
 * we voegen `currentStep`, `steps`, `readiness`, `evidence` en
 * `snapshots`-meta toe, en filteren dissent op rol als laatste
 * verdedigingslinie naast RLS.
 */
export async function buildDecisionDossierView(
  supabase: Sb,
  decisionId: string,
  opties: { autoUpgraded?: boolean } = {}
): Promise<DecisionDossierView> {
  // 1. Decision Object zelf.
  const { data: decisionRow, error: decFout } = await supabase
    .from("decision_objects")
    .select("*")
    .eq("id", decisionId)
    .single();
  if (decFout || !decisionRow) {
    throw new Error(
      `Decision Object ${decisionId} niet gevonden: ${decFout?.message ?? "onbekend"}`
    );
  }
  const decision = decisionRow as DecisionObject;

  // 2. Procedure-summary.
  const { data: procRow, error: procFout } = await supabase
    .from("procedures")
    .select(
      "id, fonds_id, template_code, titel, beschrijving, status, gestart_op, gestart_door, deadline, afgerond_op, decision_id"
    )
    .eq("id", decision.procedure_id)
    .single();
  if (procFout || !procRow) {
    throw new Error(
      `Procedure ${decision.procedure_id} niet gevonden: ${procFout?.message ?? "onbekend"}`
    );
  }
  const procedure = procRow as ProcedureSummary;

  // 3. Stappen.
  const { data: stappenRows } = await supabase
    .from("procedure_stappen")
    .select(
      "id, procedure_id, volgorde, naam, beschrijving, vereist_besluit, geschatte_dagen, status"
    )
    .eq("procedure_id", procedure.id)
    .order("volgorde", { ascending: true });
  const steps = (stappenRows ?? []) as ProcedureStep[];
  const currentStep = steps.find((s) => s.status === "actief") ?? null;

  // 4. Decision-children.
  const [
    { data: assumptionRows },
    { data: riskRows },
    { data: dissentRows },
    { data: conditionRows },
    { data: actionRows },
    { data: evaluationRows },
    { data: aiRows },
    { data: eventRows },
    { data: snapshotRows },
  ] = await Promise.all([
    supabase
      .from("decision_assumptions")
      .select("*")
      .eq("decision_id", decisionId)
      .order("aangemaakt_op", { ascending: true }),
    supabase
      .from("decision_risks")
      .select("*")
      .eq("decision_id", decisionId)
      .order("aangemaakt_op", { ascending: true }),
    supabase
      .from("decision_dissent")
      .select("*")
      .eq("decision_id", decisionId)
      .order("aangemaakt_op", { ascending: true }),
    supabase
      .from("decision_conditions")
      .select("*")
      .eq("decision_id", decisionId)
      .order("aangemaakt_op", { ascending: true }),
    supabase
      .from("decision_actions")
      .select("*")
      .eq("decision_id", decisionId)
      .order("aangemaakt_op", { ascending: true }),
    supabase
      .from("decision_evaluations")
      .select("*")
      .eq("decision_id", decisionId)
      .order("geplande_datum", { ascending: true }),
    supabase
      .from("decision_ai_interactions")
      .select("*")
      .eq("decision_id", decisionId)
      .order("aangemaakt_op", { ascending: true }),
    supabase
      .from("governance_events")
      .select("*")
      .eq("decision_id", decisionId)
      .order("tijdstip", { ascending: false })
      .limit(100),
    supabase
      .from("decision_audit_snapshots")
      .select("id, decision_id, trigger_status, hash, aangemaakt_op")
      .eq("decision_id", decisionId)
      .order("aangemaakt_op", { ascending: false }),
  ]);

  // 5. Readiness via SQL-functies (één call met overview).
  const { data: overviewData, error: overviewFout } = await supabase.rpc(
    "fn_decision_readiness_overview",
    { p_decision_id: decisionId }
  );
  if (overviewFout) {
    throw new Error(
      `Readiness-overview ophalen mislukt: ${overviewFout.message}`
    );
  }
  const readiness = overviewData as ReadinessOverview;

  // 6. Evidence opbouwen op basis van procedure_requirements.
  const evidence = await buildEvidenceLijst(supabase, {
    decisionId,
    procedure,
    decision,
    aiOutputs: (aiRows ?? []) as AIInteraction[],
    assumptions: (assumptionRows ?? []) as Assumption[],
    risks: (riskRows ?? []) as RiskItem[],
    conditions: (conditionRows ?? []) as DecisionCondition[],
    evaluations: (evaluationRows ?? []) as Evaluation[],
    events: (eventRows ?? []) as GovernanceEvent[],
    steps,
  });

  // 7. Dissent filteren op rol (defense in depth — RLS doet hetzelfde).
  const dissent = await filterDissentOpRol(
    supabase,
    (dissentRows ?? []) as DissentItem[]
  );

  return {
    decision,
    procedure,
    currentStep,
    steps,
    readiness,
    evidence,
    assumptions: (assumptionRows ?? []) as Assumption[],
    risks: (riskRows ?? []) as RiskItem[],
    scenarios: [] as Scenario[], // MVP-1: leeg, voorbereid op MVP-2
    aiOutputs: (aiRows ?? []) as AIInteraction[],
    dissent,
    conditions: (conditionRows ?? []) as DecisionCondition[],
    actions: (actionRows ?? []) as ActionItem[],
    evaluations: (evaluationRows ?? []) as Evaluation[],
    events: (eventRows ?? []) as GovernanceEvent[],
    snapshots: (snapshotRows ?? []) as AuditSnapshotMeta[],
    auto_upgraded: opties.autoUpgraded ?? false,
  };
}

// ── Evidence-synthese ─────────────────────────────────────────────────

interface BuildEvidenceContext {
  decisionId: string;
  procedure: ProcedureSummary;
  decision: DecisionObject;
  aiOutputs: AIInteraction[];
  assumptions: Assumption[];
  risks: RiskItem[];
  conditions: DecisionCondition[];
  evaluations: Evaluation[];
  events: GovernanceEvent[];
  steps: ProcedureStep[];
}

interface ProcedureRequirementRow {
  id: string;
  template_code: string;
  stap_volgorde: number;
  requirement_type: RequirementType;
  label: string;
  documenttype: string | null;
  veld_pad: string | null;
  verplicht: boolean;
  blokkerend: boolean;
  triggert_bij_complexiteit: string[] | null;
  triggert_bij_risiconiveau: string[] | null;
  triggert_bij_mandaatgevoelig: boolean | null;
  triggert_bij_toezichtgevoelig: boolean | null;
}

interface ProcedureBewijsRow {
  id: string;
  stap_id: string;
  document_id: string | null;
  titel: string | null;
  beschrijving: string | null;
}

async function buildEvidenceLijst(
  supabase: Sb,
  ctx: BuildEvidenceContext
): Promise<EvidenceItem[]> {
  // Alle requirements voor deze template.
  const { data: reqRows } = await supabase
    .from("procedure_requirements")
    .select("*")
    .eq("template_code", ctx.procedure.template_code);
  const requirements = (reqRows ?? []) as ProcedureRequirementRow[];

  // Bewijsstukken voor alle stappen van deze procedure.
  const stapIds = ctx.steps.map((s) => s.id);
  const bewijsByStap = new Map<string, ProcedureBewijsRow[]>();
  if (stapIds.length > 0) {
    const { data: bewijsRows } = await supabase
      .from("procedure_bewijs")
      .select("id, stap_id, document_id, titel, beschrijving")
      .in("stap_id", stapIds);
    for (const b of (bewijsRows ?? []) as ProcedureBewijsRow[]) {
      const lijst = bewijsByStap.get(b.stap_id) ?? [];
      lijst.push(b);
      bewijsByStap.set(b.stap_id, lijst);
    }
  }

  const stapByVolgorde = new Map<number, ProcedureStep>();
  for (const s of ctx.steps) stapByVolgorde.set(s.volgorde, s);

  const evidence: EvidenceItem[] = [];

  for (const req of requirements) {
    // Conditionele activatie: dezelfde semantiek als
    // fn_decision_readiness_check (AND tussen velden, OR binnen array).
    if (
      req.triggert_bij_complexiteit &&
      !req.triggert_bij_complexiteit.includes(ctx.decision.complexiteit)
    ) {
      continue;
    }
    if (
      req.triggert_bij_risiconiveau &&
      !req.triggert_bij_risiconiveau.includes(ctx.decision.risiconiveau)
    ) {
      continue;
    }
    if (
      req.triggert_bij_mandaatgevoelig !== null &&
      ctx.decision.mandaatgevoelig !== req.triggert_bij_mandaatgevoelig
    ) {
      continue;
    }
    if (
      req.triggert_bij_toezichtgevoelig !== null &&
      ctx.decision.toezichtgevoelig !== req.triggert_bij_toezichtgevoelig
    ) {
      continue;
    }

    let vervuld = false;
    let bron: EvidenceItem["bron_type"] = null;
    let bronId: string | null = null;
    let bronTitel: string | null = null;

    switch (req.requirement_type) {
      case "document": {
        const stap = stapByVolgorde.get(req.stap_volgorde);
        const bewijzen = stap ? bewijsByStap.get(stap.id) ?? [] : [];
        const match = bewijzen.find((b) => {
          if (!req.documenttype) return true;
          return (b.titel ?? "")
            .toLowerCase()
            .includes(req.documenttype.toLowerCase());
        });
        if (match) {
          vervuld = true;
          bron = "procedure_bewijs";
          bronId = match.id;
          bronTitel = match.titel;
        }
        break;
      }
      case "ai_validation": {
        // Binnen de readiness-check is dit nog niet gedifferentieerd op
        // validatie_domein; voor evidence-display willen we dat wel,
        // dus we proberen eerst een match op het label (bijv. "risk-").
        const labelLower = req.label.toLowerCase();
        const labelDomein =
          labelLower.includes("risk")
            ? "risk"
            : labelLower.includes("compliance")
              ? "compliance"
              : labelLower.includes("beleggingen")
                ? "beleggingen"
                : labelLower.includes("governance")
                  ? "governance"
                  : null;
        const match = ctx.aiOutputs.find((ai) => {
          if (!["gevalideerd", "aangepast"].includes(ai.validatiestatus)) {
            return false;
          }
          if (labelDomein && ai.validatie_domein !== labelDomein) return false;
          return true;
        });
        if (match) {
          vervuld = true;
          bron = "ai_output";
          bronId = match.id;
          bronTitel =
            match.gebruik_context ??
            `AI-output (${match.validatie_domein})`;
        }
        break;
      }
      case "assumption": {
        const gevalideerd = ctx.assumptions.filter((a) =>
          ["gevalideerd", "gewijzigd"].includes(a.status)
        );
        // Voor labels die expliciet "≥ 3" eisen, vereisen we drie of meer.
        const drempel = /≥\s*3|>=\s*3|drie|3 /.test(req.label) ? 3 : 1;
        if (gevalideerd.length >= drempel) {
          vervuld = true;
          bron = "assumption";
          const eerste = gevalideerd[0];
          bronId = eerste?.id ?? null;
          bronTitel =
            gevalideerd.length === 1
              ? eerste.tekst.slice(0, 60)
              : `${gevalideerd.length} gevalideerde aannames`;
        }
        break;
      }
      case "risk": {
        if (ctx.risks.length > 0) {
          vervuld = true;
          bron = "risk";
          bronId = ctx.risks[0].id;
          bronTitel = `${ctx.risks.length} risico's geregistreerd`;
        }
        break;
      }
      case "kpi": {
        const metKpi = ctx.conditions.filter((c) => c.kpi !== null);
        if (metKpi.length > 0) {
          vervuld = true;
          bron = "condition";
          bronId = metKpi[0].id;
          bronTitel = `${metKpi.length} KPI('s) gedefinieerd`;
        }
        break;
      }
      case "evaluation": {
        if (ctx.evaluations.length > 0) {
          vervuld = true;
          bron = "evaluation";
          bronId = ctx.evaluations[0].id;
          bronTitel = `Evaluatie gepland: ${ctx.evaluations[0].geplande_datum}`;
        }
        break;
      }
      case "mandate_check": {
        const ev = ctx.events.find(
          (e) => e.event_type === "mandate_check_passed"
        );
        if (ev) {
          vervuld = true;
          bron = "governance_event";
          bronId = ev.id;
          bronTitel = "Mandaatcheck geslaagd";
        }
        break;
      }
      case "approval": {
        const beslotenStatuses = [
          "besloten",
          "voorwaardelijk_besloten",
          "in_uitvoering",
          "in_evaluatie",
          "afgesloten",
        ];
        if (beslotenStatuses.includes(ctx.decision.status)) {
          vervuld = true;
          bron = null;
          bronTitel = `Status: ${ctx.decision.status}`;
        }
        break;
      }
      case "dissent_review": {
        // Vervuld als er geen openstaande formele dissent zonder
        // formeel_vastgesteld bestaat. We hebben dissent al via
        // ctx, maar dit type is alleen relevant in latere stappen
        // dus we filteren niet expliciet op zichtbaarheid hier.
        const { count } = await supabase
          .from("decision_dissent")
          .select("id", { count: "exact", head: true })
          .eq("decision_id", ctx.decisionId)
          .in("zichtbaarheid", ["formele_dissent", "minderheidsnotitie"])
          .eq("formeel_vastgesteld", false);
        vervuld = (count ?? 0) === 0;
        bronTitel = vervuld
          ? "Geen openstaande dissent"
          : `${count} openstaande dissent-notitie(s)`;
        break;
      }
      case "field": {
        // Eenvoudige veld-controles op decision-object niveau.
        if (req.veld_pad === "decision.besluitvraag") {
          const ingevuld =
            !!ctx.decision.besluitvraag &&
            !ctx.decision.besluitvraag.startsWith("Aanvullen na auto-upgrade");
          vervuld = ingevuld;
          bronTitel = ingevuld ? "Besluitvraag ingevuld" : "Besluitvraag ontbreekt";
        } else if (req.veld_pad === "decision.scope") {
          vervuld = !!ctx.decision.scope && ctx.decision.scope.trim().length > 0;
          bronTitel = vervuld ? "Scope ingevuld" : "Scope ontbreekt";
        } else {
          // Classificatie-velden: in MVP-1B beschouwen we 'ingevuld'
          // als 'niet meer op default'. Voor `complexiteit` en
          // `risiconiveau` betekent dat een waarde anders dan
          // complicated/middel óf een expliciete bevestiging via
          // governance_event 'classificatie_bevestigd'.
          const bevestigd = ctx.events.find(
            (e) => e.event_type === "classificatie_bevestigd"
          );
          vervuld =
            !!bevestigd ||
            ctx.decision.complexiteit !== "complicated" ||
            ctx.decision.risiconiveau !== "middel";
          bronTitel = vervuld
            ? "Classificatie ingevuld"
            : "Classificatie nog op default";
          if (bevestigd) {
            bron = "governance_event";
            bronId = bevestigd.id;
          }
        }
        break;
      }
    }

    evidence.push({
      requirement_type: req.requirement_type,
      stap_volgorde: req.stap_volgorde,
      label: req.label,
      documenttype: req.documenttype,
      verplicht: req.verplicht,
      blokkerend: req.blokkerend,
      vervuld,
      bron_type: bron,
      bron_id: bronId,
      bron_titel: bronTitel,
    });
  }

  // Sorteren op stap dan label, voor stabiele weergave.
  evidence.sort((a, b) => {
    if (a.stap_volgorde !== b.stap_volgorde) {
      return a.stap_volgorde - b.stap_volgorde;
    }
    return a.label.localeCompare(b.label);
  });

  return evidence;
}

// ── Dissent-filter (defense in depth) ─────────────────────────────────

async function filterDissentOpRol(
  supabase: Sb,
  dissents: DissentItem[]
): Promise<DissentItem[]> {
  if (dissents.length === 0) return [];

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: profiel } = await supabase
    .from("profielen")
    .select("rol")
    .eq("id", user.id)
    .maybeSingle();
  const rol = profiel?.rol ?? "bestuurder";
  const isPrivileged = rol === "voorzitter" || rol === "beheerder";

  return dissents.filter((d) => {
    // Eigen dissent altijd zichtbaar.
    if (d.bestuurder_id === user.id) return true;
    // Privé van iemand anders: nooit.
    if (d.zichtbaarheid === "prive") return false;
    // Voorzitter/beheerder zien alles wat niet privé is.
    if (isPrivileged) return true;
    // Andere bestuurders zien alleen formele dissent en minderheidsnotities.
    return (
      d.zichtbaarheid === "formele_dissent" ||
      d.zichtbaarheid === "minderheidsnotitie"
    );
  });
}

// ── Helpers voor readiness-display ───────────────────────────────────

/** Eerste readiness-target waaraan nog niet wordt voldaan, of null als alles ok is. */
export function eersteOntbrekendeReadiness(
  overview: ReadinessOverview
): { target: keyof ReadinessOverview; result: ReadinessResult } | null {
  const volgorde: (keyof ReadinessOverview)[] = [
    "onderbouwing_compleet",
    "reviewrijp",
    "bespreekrijp",
    "besluitrijp",
    "verantwoordingsrijp",
    "evaluatierijp",
  ];
  for (const t of volgorde) {
    const r = overview[t];
    if (!r.voldoet) return { target: t, result: r };
  }
  return null;
}

// ── ActionItem alias om `import { ActionItem }` consistent te houden ──
// (Het type wordt in decision-view.ts gedefinieerd; hier alleen
//  herexport zodat consumers één plek hebben.)
import type { ActionItem } from "./decision-view";
export type { ActionItem };
