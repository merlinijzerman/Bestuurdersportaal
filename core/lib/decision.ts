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
  type ActionItem,
  type AIInteraction,
  type AIValidatieDomein,
  type Assumption,
  type AuditSnapshotMeta,
  type BesluitItem,
  type BewijsItem,
  type DecisionCondition,
  type DecisionDossierView,
  type DecisionObject,
  type DissentItem,
  type Evaluation,
  type EvidenceItem,
  type GebondenFeitRef,
  type GovernanceEvent,
  type ProcedureStep,
  type ProcedureSummary,
  type RequirementType,
  type RiskItem,
  type Scenario,
  type StemverslagSummary,
  mapLegacyStatus,
} from "./decision-view";
import { requirementSleutel } from "./requirement-sleutel";
import { vervuldViaBinding } from "./vervulling";

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
      "id, fonds_id, template_code, template_versie, titel, beschrijving, status, gestart_door, deadline, decision_id"
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

  // 3. Nieuwe Decision Object aanmaken met legacy-mapping. mapLegacyStatus
  // accepteert zowel de oude 3-statuswaarden als de 8 dossierstatussen.
  const legacyStatus = procedure.status ?? "lopend";
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
      // P1b (#166): de VERSIE waarop het dossier is gepind — niet langer de code
      // (dat was de bug). De backfill in de P1b-migratie herstelt bestaande rijen.
      template_versie: procedure.template_versie ?? null,
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

  // Issue 3 uit de review: expliciet error-checken op de governance-event
  // insert. Zonder log-rij is de auto-upgrade niet traceerbaar — dat is
  // voor een audit-systeem onacceptabel, dus we gooien een error door.
  const { error: eventFout } = await supabase.from("governance_events").insert({
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
  if (eventFout) {
    console.error(
      "Auto-upgrade: governance_event 'decision_object_auto_created' niet geschreven:",
      eventFout
    );
    throw new Error(
      `Auto-upgrade-event niet gelogd: ${eventFout.message}. Decision Object ${nieuw.id} bestaat wel maar mist audit-rij.`
    );
  }

  return { decision_id: nieuw.id, auto_upgraded: true };
}

// ── Dossier laden ─────────────────────────────────────────────────────

/**
 * Bouw de volledige `DecisionDossierView` voor een Decision Object.
 * Dit is een aanvulling op `fn_build_decision_dossier(decision_id)`:
 * we voegen `currentStep`, `steps`, `evidence` en `snapshots`-meta toe
 * (readiness is ontmanteld, 0187), en filteren dissent op rol als laatste
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
      "id, fonds_id, template_code, template_versie, titel, beschrijving, status, gestart_op, gestart_door, deadline, afgerond_op, decision_id"
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
  // D6: 'heropend' telt als actief. Bij meerdere parallel-actieve stappen is
  // dit de eerste; de volledige weergave van alle actieve stappen is WO-2.
  const currentStep =
    steps.find((s) => s.status === "actief" || s.status === "heropend") ?? null;

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

  // 5. Readiness is ontmanteld (0187): geen fn_decision_readiness_overview meer.
  //    De besluitmoment-telling (open per zwaarte) komt uit de evidence hieronder.

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

  // 8. Bewijsstukken voor alle stappen ophalen — eerste-orde data
  // voor het auditdossier. Sortering: stap_volgorde-volgorde
  // (afgeleid via map) en daarbinnen toegevoegd_op aflopend zodat
  // het meest recente bovenaan staat.
  const stapIds = steps.map((s) => s.id);
  let bewijs: BewijsItem[] = [];
  if (stapIds.length > 0) {
    const { data: bewijsRows } = await supabase
      .from("procedure_bewijs")
      .select(
        "id, stap_id, document_id, titel, beschrijving, documenttype, requirement_sleutel, toegevoegd_op, toegevoegd_door_naam"
      )
      .in("stap_id", stapIds)
      .order("toegevoegd_op", { ascending: false });
    const stapVolgorde = new Map<string, number>();
    for (const s of steps) stapVolgorde.set(s.id, s.volgorde);
    bewijs = ((bewijsRows ?? []) as BewijsItem[]).slice().sort((a, b) => {
      const va = stapVolgorde.get(a.stap_id) ?? 0;
      const vb = stapVolgorde.get(b.stap_id) ?? 0;
      if (va !== vb) return va - vb;
      // Nieuwste eerst binnen dezelfde stap; bij een gelijke timestamp (twee
      // stukken in dezelfde transactie) beslist het id, zodat de volgorde in
      // het auditdossier en de export reproduceerbaar is.
      return (
        (b.toegevoegd_op ?? "").localeCompare(a.toegevoegd_op ?? "") ||
        a.id.localeCompare(b.id)
      );
    });
  }

  // 9. Vastgelegde besluiten ophalen — kern van het auditdossier.
  // Filteren op procedure_id (1:1 procedure↔decision in MVP-1) +
  // backward compat met oudere besluiten die nog geen decision_id
  // hebben. Sortering: nieuwste-eerst.
  const { data: besluitenRows } = await supabase
    .from("procedure_besluiten")
    .select(
      "id, procedure_id, stap_id, decision_id, formulering, motivering, datum, vastgelegd_door_naam, verworpen_alternatieven, vergadering_id, agendapunt_id, uitkomst, requirement_sleutel"
    )
    .eq("procedure_id", procedure.id)
    .order("datum", { ascending: false });
  const besluiten = (besluitenRows ?? []) as BesluitItem[];

  // 10. Stemverslagen — gesloten/ingetrokken stemmingen gekoppeld aan dit
  // besluit. Open stemmingen horen niet in het auditdossier (§7.6); ze
  // hebben geen vastliggende uitslag.
  const { data: stemmingenRows } = await supabase
    .from("stemmingen")
    .select(
      "id, vraag, status, alternatieven, uitslag, ingetrokken_reden, geopend_op, gesloten_op"
    )
    .eq("decision_id", decisionId)
    .in("status", ["gesloten", "ingetrokken"])
    .order("geopend_op", { ascending: false });
  const stemverslagen = (stemmingenRows ?? []) as StemverslagSummary[];

  return {
    decision,
    procedure,
    currentStep,
    steps,
    evidence,
    stemverslagen,
    bewijs,
    besluiten,
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
  // Phase 1C-uitbreiding: vervangt label-regex (zie review-issues 4 + 5)
  vereist_validatie_domein: AIValidatieDomein | null;
  min_aantal: number;
  // OB-E10: toelichting bij het bewijsstuk (uit de definitie/standaardset).
  toelichting: string | null;
  // P3/PR-D (#168, §7): besluitmoment-binding; leeg = alleen de eigen stap.
  besluitmoment_stap: number | null;
}

// WO-3-vervolg: requirement + herkomst (template vs. instantie) voor de
// evidence-laag, zodat de UI weet welk verwijderpad geldt.
type MergedRequirement = ProcedureRequirementRow & {
  bron: "template" | "instance";
  instance_id: string | null;
};

interface ProcedureBewijsRow {
  id: string;
  stap_id: string;
  document_id: string | null;
  titel: string | null;
  beschrijving: string | null;
  // 1D-4: tag die overeenkomt met procedure_requirements.documenttype.
  // Sinds de bewijsbinding (2026-08-18) nog uitsluitend een suggestie bij het
  // opvoeren — hij vinkt zelf geen vereiste meer af.
  documenttype: string | null;
  // Bewijsbinding: de vereiste die dit stuk vervult, als sleutel
  // `stap_volgorde|requirement_type|coalesce(documenttype, label)`.
  // Null = (nog) niet gebonden; zo'n stuk vervult niets.
  requirement_sleutel: string | null;
  toegevoegd_op: string | null;
}

/**
 * Beoordeelt of een document-achtige vereiste (`document`,
 * `external_submission`, `consultation`) vervuld is, en zo ja door welk
 * bewijsstuk.
 *
 * Eén gelijkheidstest op de expliciete binding — geen wildcard, geen
 * documenttype-gok, geen titel-substring. Daardoor geldt per constructie:
 * een bewijsstuk draagt precies één sleutel en kan dus hoogstens één
 * vereiste vervullen. Spiegelt de document-tak van (historisch) de gedropte
 * `fn_decision_readiness_check` (migratie 2026_08_18_bewijs_requirement_binding).
 *
 * `bewijzen` wordt verondersteld deterministisch gesorteerd te zijn
 * (toegevoegd_op, dan id); bij meerdere gebonden stukken is de eerste de bron.
 *
 * Geëxporteerd zodat de sanity-check hem zonder Supabase-client kan toetsen.
 */
export function vervultDocumentRequirement(
  req: Pick<
    MergedRequirement,
    "stap_volgorde" | "requirement_type" | "documenttype" | "label"
  >,
  bewijzen: Pick<ProcedureBewijsRow, "id" | "titel" | "requirement_sleutel">[],
  aantalVereistenMetSleutel = 1
): { id: string; titel: string | null } | null {
  // De sleutel is inhoudelijk en kan per ongeluk zowel als template- als
  // instantievereiste voorkomen. Dan zou één bewijsstuk twee regels
  // vervullen. Behandel zo'n configuratiefout daarom als onvervuld.
  if (aantalVereistenMetSleutel !== 1) return null;

  const sleutel = requirementSleutel(
    req.stap_volgorde,
    req.requirement_type,
    req.documenttype,
    req.label
  );
  const match = bewijzen.find((b) => b.requirement_sleutel === sleutel);
  return match ? { id: match.id, titel: match.titel } : null;
}

async function buildEvidenceLijst(
  supabase: Sb,
  ctx: BuildEvidenceContext
): Promise<EvidenceItem[]> {
  // Alle requirements voor deze template. P1b (#166): versie-gefilterd op de
  // versie waarop dit dossier is gepind (procedures.template_versie). Fallback
  // naar code-only als de versie (kortstondig, deploy-venster) null is.
  // Behavioraal een no-op zolang er één versie per code bestaat — puur toekomst-
  // vast: een dossier op v1 leest v1, ook nadat een v2 is geseed. Readiness in
  // de DB blijft bewust ongewijzigd (dat is #168).
  let reqQuery = supabase
    .from("procedure_requirements")
    .select("*")
    .eq("template_code", ctx.procedure.template_code);
  if (ctx.procedure.template_versie) {
    reqQuery = reqQuery.eq("template_versie", ctx.procedure.template_versie);
  }
  // Fail-closed: een lees-fout op de vereisten mag NIET stil een lege set opleveren.
  // De besluitmoment-telling/§4.4-signalering (PR-D) leunt hierop — lege evidence
  // zou een besluit met openstaande vereisten stil zonder motivering/vastlegging
  // laten passeren. Daarom hier throwen i.p.v. `?? []`.
  const { data: reqRows, error: reqFout } = await reqQuery;
  if (reqFout) {
    throw new Error(`Vereisten ophalen mislukt: ${reqFout.message}`);
  }

  // WO-3-vervolg: per-proces uitsluitingen (overlay). Deze markeren een
  // TEMPLATE-vereiste als niet van toepassing voor DIT decision — de generieke
  // set blijft onaangeroerd. Match op (stap_volgorde, requirement_type, label),
  // spiegelt het NOT EXISTS in fn_decision_readiness_check.
  const { data: uitslRows } = await supabase
    .from("procedure_requirement_uitsluiting")
    .select("stap_volgorde, requirement_type, match_sleutel")
    .eq("decision_id", ctx.decisionId)
    .eq("actief", true);
  const uitgesloten = new Set(
    ((uitslRows ?? []) as Array<{
      stap_volgorde: number;
      requirement_type: string;
      match_sleutel: string;
    }>).map(
      (u) => `${u.stap_volgorde}|${u.requirement_type}|${u.match_sleutel}`
    )
  );
  // Identiteit = coalesce(documenttype, label) — spiegelt de unieke index van
  // procedure_requirements en het NOT EXISTS in fn_decision_readiness_check.
  // Zelfde sleutel als de bewijsbinding; één definitie in requirement-sleutel.ts.
  const requirements: MergedRequirement[] = ((reqRows ?? []) as ProcedureRequirementRow[])
    .filter(
      (r) =>
        !uitgesloten.has(
          requirementSleutel(
            r.stap_volgorde,
            r.requirement_type,
            r.documenttype,
            r.label
          )
        )
    )
    .map((r) => ({ ...r, bron: "template" as const, instance_id: null }));

  // D7: unie met ACTIEVE instantie-requirements (decision-scoped). Template-
  // en instantie-rijen zijn disjuncte records → geen dubbeltelling. Spiegelt
  // de UNION in fn_decision_readiness_check.
  const { data: instRows, error: instFout } = await supabase
    .from("procedure_requirement_instance")
    .select(
      "id, stap_volgorde, requirement_type, label, documenttype, veld_pad, verplicht, blokkerend, min_aantal, vereist_validatie_domein, besluitmoment_stap"
    )
    .eq("decision_id", ctx.decisionId)
    .eq("actief", true);
  if (instFout) {
    // Fail-closed, zie de template-arm hierboven.
    throw new Error(`Instantie-vereisten ophalen mislukt: ${instFout.message}`);
  }
  const instanceRequirements: MergedRequirement[] = (
    (instRows ?? []) as Array<{
      id: string;
      stap_volgorde: number;
      requirement_type: RequirementType;
      label: string;
      documenttype: string | null;
      veld_pad: string | null;
      verplicht: boolean | null;
      blokkerend: boolean | null;
      min_aantal: number | null;
      vereist_validatie_domein: AIValidatieDomein | null;
      besluitmoment_stap: number | null;
    }>
  ).map((r) => ({
    id: r.id,
    template_code: "",
    stap_volgorde: r.stap_volgorde,
    requirement_type: r.requirement_type,
    label: r.label,
    documenttype: r.documenttype,
    veld_pad: r.veld_pad,
    verplicht: r.verplicht ?? true,
    blokkerend: r.blokkerend ?? false,
    triggert_bij_complexiteit: null,
    triggert_bij_risiconiveau: null,
    triggert_bij_mandaatgevoelig: null,
    triggert_bij_toezichtgevoelig: null,
    vereist_validatie_domein: r.vereist_validatie_domein,
    min_aantal: r.min_aantal ?? 1,
    // Instantie-requirements dragen (nog) geen toelichting.
    toelichting: null,
    besluitmoment_stap: r.besluitmoment_stap ?? null,
    bron: "instance" as const,
    instance_id: r.id,
  }));

  const alleRequirements: MergedRequirement[] = [
    ...requirements,
    ...instanceRequirements,
  ];

  const isRequirementActief = (req: MergedRequirement) =>
    (!req.triggert_bij_complexiteit ||
      req.triggert_bij_complexiteit.includes(ctx.decision.complexiteit)) &&
    (!req.triggert_bij_risiconiveau ||
      req.triggert_bij_risiconiveau.includes(ctx.decision.risiconiveau)) &&
    (req.triggert_bij_mandaatgevoelig === null ||
      ctx.decision.mandaatgevoelig === req.triggert_bij_mandaatgevoelig) &&
    (req.triggert_bij_toezichtgevoelig === null ||
      ctx.decision.toezichtgevoelig === req.triggert_bij_toezichtgevoelig);

  // ── D10 (besluit 0189): vervulling = een POSITIEF, GEBONDEN feit. Per brontabel
  //    de gebonden feiten (requirement_sleutel) ophalen op de dossier-lokale scope
  //    en per sleutel tellen; `vervuld = aantal >= min_aantal`. Eén gelijkheidstest
  //    op de sleutel vervangt alle per-type matchlogica. `field` blijft de
  //    gemotiveerde uitzondering (veld op het besluit / governance-event).
  type GebondenFeit = {
    bron_type: EvidenceItem["bron_type"];
    id: string;
    titel: string | null;
    datum: string | null;
    actor: string | null; // opgeloste naam; voor uuid-kolommen na de batch gevuld
    actorId: string | null; // uuid dat nog naar een naam geresolveerd wordt
    sorteer: string;
  };
  const feitenPerSleutel = new Map<string, GebondenFeit[]>();
  const voegFeitToe = (sleutel: string | null, feit: GebondenFeit) => {
    if (!sleutel) return;
    const lijst = feitenPerSleutel.get(sleutel) ?? [];
    lijst.push(feit);
    feitenPerSleutel.set(sleutel, lijst);
  };

  // Per brontabel: welke kolom de titel/datum/actor draagt. actorSoort 'id' = uuid
  // → via profielen naar een naam. Gedeeld met de kandidatenroute (#192).
  type BronConfig = {
    bron_type: EvidenceItem["bron_type"];
    titelKolom: string;
    datumKolom: string;
    actorKolom: string;
    actorSoort: "naam" | "id";
  };

  // procedure_bewijs is stap-scoped; stappen zijn uniek per procedure.
  const stapIds = ctx.steps.map((s) => s.id);
  if (stapIds.length > 0) {
    const { data } = await supabase
      .from("procedure_bewijs")
      .select("id, titel, requirement_sleutel, toegevoegd_op, toegevoegd_door_naam")
      .in("stap_id", stapIds)
      .not("requirement_sleutel", "is", null);
    for (const r of (data ?? []) as Array<{
      id: string;
      titel: string | null;
      requirement_sleutel: string | null;
      toegevoegd_op: string | null;
      toegevoegd_door_naam: string | null;
    }>) {
      voegFeitToe(r.requirement_sleutel, {
        bron_type: "procedure_bewijs",
        id: r.id,
        titel: r.titel,
        datum: r.toegevoegd_op,
        actor: r.toegevoegd_door_naam,
        actorId: null,
        sorteer: `${r.toegevoegd_op ?? ""}|${r.id}`,
      });
    }
  }

  const decisionBronnen: BronConfig[] = [
    { bron_type: "risk", titelKolom: "beschrijving", datumKolom: "aangemaakt_op", actorKolom: "eigenaar_naam", actorSoort: "naam" },
    { bron_type: "assumption", titelKolom: "tekst", datumKolom: "aangemaakt_op", actorKolom: "gewijzigd_door", actorSoort: "id" },
    { bron_type: "condition", titelKolom: "kpi", datumKolom: "aangemaakt_op", actorKolom: "eigenaar_naam", actorSoort: "naam" },
    { bron_type: "evaluation", titelKolom: "geplande_datum", datumKolom: "aangemaakt_op", actorKolom: "uitgevoerd_door", actorSoort: "id" },
    { bron_type: "ai_output", titelKolom: "gebruik_context", datumKolom: "gevalideerd_op", actorKolom: "gevalideerd_door", actorSoort: "id" },
  ];
  const decisionTabel: Record<string, string> = {
    risk: "decision_risks", assumption: "decision_assumptions", condition: "decision_conditions",
    evaluation: "decision_evaluations", ai_output: "decision_ai_interactions",
  };
  const procedureBronnen: BronConfig[] = [
    { bron_type: "procedure_besluit", titelKolom: "formulering", datumKolom: "datum", actorKolom: "vastgelegd_door_naam", actorSoort: "naam" },
    { bron_type: "procedure_vaststelling", titelKolom: "uitkomst", datumKolom: "vastgelegd_op", actorKolom: "actor", actorSoort: "id" },
  ];
  const procedureTabel: Record<string, string> = {
    procedure_besluit: "procedure_besluiten", procedure_vaststelling: "procedure_vaststelling",
  };
  const laadGebondenBron = async (
    tabel: string, cfg: BronConfig,
    scopeKolom: "decision_id" | "procedure_id", scopeWaarde: string
  ) => {
    const { data } = await supabase
      .from(tabel)
      .select(`id, requirement_sleutel, ${cfg.titelKolom}, ${cfg.datumKolom}, ${cfg.actorKolom}`)
      .eq(scopeKolom, scopeWaarde)
      .not("requirement_sleutel", "is", null);
    for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const titelWaarde = r[cfg.titelKolom];
      const datumWaarde = r[cfg.datumKolom];
      const actorWaarde = r[cfg.actorKolom];
      voegFeitToe(r.requirement_sleutel as string | null, {
        bron_type: cfg.bron_type,
        id: r.id as string,
        titel: titelWaarde == null ? null : String(titelWaarde),
        datum: datumWaarde == null ? null : String(datumWaarde),
        actor: cfg.actorSoort === "naam" && typeof actorWaarde === "string" ? actorWaarde : null,
        actorId: cfg.actorSoort === "id" && typeof actorWaarde === "string" ? actorWaarde : null,
        sorteer: `${datumWaarde == null ? "" : String(datumWaarde)}|${r.id as string}`,
      });
    }
  };
  for (const b of decisionBronnen) {
    await laadGebondenBron(decisionTabel[b.bron_type as string], b, "decision_id", ctx.decisionId);
  }
  for (const b of procedureBronnen) {
    await laadGebondenBron(procedureTabel[b.bron_type as string], b, "procedure_id", ctx.procedure.id);
  }

  // Actor-namen resolven voor de uuid-kolommen (één batch via profielen).
  const teResolven = new Set<string>();
  for (const lijst of feitenPerSleutel.values())
    for (const f of lijst) if (f.actorId) teResolven.add(f.actorId);
  if (teResolven.size > 0) {
    // vw_fondsleden i.p.v. profielen (own-row-only): fonds-veilige naamresolutie
    // van fondsgenoten. Zie de RLS-review bij #192.
    const { data: leden } = await supabase
      .from("vw_fondsleden").select("id, naam").in("id", Array.from(teResolven));
    const naamPerId = new Map<string, string>();
    for (const p of (leden ?? []) as Array<{ id: string; naam: string | null }>)
      if (p.naam) naamPerId.set(p.id, p.naam);
    for (const lijst of feitenPerSleutel.values())
      for (const f of lijst) if (f.actorId && !f.actor) f.actor = naamPerId.get(f.actorId) ?? null;
  }

  // Determinisme: PostgREST garandeert geen returnvolgorde. Sorteer per sleutel
  // zodat het getoonde herkomst-spoor stabiel is over aanroepen.
  for (const lijst of feitenPerSleutel.values()) {
    lijst.sort((a, b) => a.sorteer.localeCompare(b.sorteer));
  }

  // dissent_open: openstaande formele dissent voor de harde guard (#192). Alleen
  // opvragen als er een actieve dissent_review-vereiste is — anders een nutteloze
  // query per dossier.
  let dissentOpen = 0;
  if (
    alleRequirements.some(
      (r) => r.requirement_type === "dissent_review" && isRequirementActief(r)
    )
  ) {
    const { count } = await supabase
      .from("decision_dissent")
      .select("id", { count: "exact", head: true })
      .eq("decision_id", ctx.decisionId)
      .in("zichtbaarheid", ["formele_dissent", "minderheidsnotitie"])
      .eq("formeel_vastgesteld", false);
    dissentOpen = count ?? 0;
  }

  // Fail-closed bij een dubbel-gedefinieerde sleutel (config-drift: dezelfde
  // (stap|type|identiteit) bestaat als template- én actieve instantievereiste).
  // fn_decision_readiness_check blokkeert dat in SQL; de evidence-view moet dat
  // spiegelen, anders vinkt één gebonden feit beide vereisten af (UI groen, gate
  // rood). resolveVereisteSleutel weigert zulke bindingen bij het AANMAKEN, maar
  // legacy/directe bindingen omzeilen dat — daarom hier ook geteld en geweerd.
  const sleutelRequirementAantal = new Map<string, number>();
  for (const req of alleRequirements) {
    if (req.requirement_type === "field" || !isRequirementActief(req)) continue;
    const s = requirementSleutel(
      req.stap_volgorde,
      req.requirement_type,
      req.documenttype,
      req.label
    );
    sleutelRequirementAantal.set(s, (sleutelRequirementAantal.get(s) ?? 0) + 1);
  }

  const evidence: EvidenceItem[] = [];

  for (const req of alleRequirements) {
    // Conditionele activatie: dezelfde semantiek als fn_decision_readiness_check
    // (AND tussen velden, OR binnen array). Instantie-requirements → altijd actief.
    if (!isRequirementActief(req)) continue;

    let vervuld = false;
    let bron: EvidenceItem["bron_type"] = null;
    let bronId: string | null = null;
    let bronTitel: string | null = null;
    let gebondenFeiten: GebondenFeitRef[] = [];

    if (req.requirement_type === "field") {
      // Gemotiveerde uitzondering (0189): geen gebonden feit, maar een veld op het
      // Decision Object of het governance-event classificatie_bevestigd.
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
    } else {
      // Alle overige typen: puur tellen op de gebonden sleutel (D10). Geen enkele
      // afleiding, status of afwezigheid telt nog mee — alleen het gebonden feit.
      const sleutel = requirementSleutel(
        req.stap_volgorde,
        req.requirement_type,
        req.documenttype,
        req.label
      );
      if ((sleutelRequirementAantal.get(sleutel) ?? 0) > 1) {
        // Ambigu gedefinieerd → fail-closed, gelijk aan de SQL-readiness-gate.
        vervuld = false;
        bronTitel = "Dubbel gedefinieerde vereiste — los de configuratie op";
      } else {
        const feiten = feitenPerSleutel.get(sleutel) ?? [];
        vervuld = vervuldViaBinding(
          req.requirement_type,
          feiten.length,
          req.min_aantal
        );
        // Het volledige herkomst-spoor — ook bij een deels-vervulde vereiste, zodat
        // de UI de reeds gekoppelde feiten toont met datum en persoon (#192).
        gebondenFeiten = feiten.map((f) => ({
          id: f.id,
          bron_type: f.bron_type,
          titel: f.titel,
          datum: f.datum,
          actor: f.actor,
        }));
        if (feiten.length > 0) {
          const eerste = feiten[0];
          bron = eerste.bron_type;
          bronId = eerste.id;
          bronTitel =
            feiten.length === 1
              ? eerste.titel
              : `${feiten.length} gebonden feiten`;
        }
      }
    }

    evidence.push({
      requirement_type: req.requirement_type,
      stap_volgorde: req.stap_volgorde,
      label: req.label,
      toelichting: req.toelichting,
      documenttype: req.documenttype,
      verplicht: req.verplicht,
      blokkerend: req.blokkerend,
      vervuld,
      bron_type: bron,
      bron_id: bronId,
      bron_titel: bronTitel,
      gebonden_feiten: gebondenFeiten,
      min_aantal: req.min_aantal ?? 1,
      dissent_open: req.requirement_type === "dissent_review" ? dissentOpen : 0,
      bron: req.bron,
      instance_id: req.instance_id,
      besluitmoment_stap: req.besluitmoment_stap ?? null,
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

// `ActionItem` wordt gere-exporteerd zodat consumers van dit bestand
// één import-pad hebben (issue 1 van de review).
export type { ActionItem };
