// ============================================================
//  Sanity-tests voor de afschrift-feitenkaart (T6, C7).
//
//  De feitenkaart is de scheidslijn B↔C: in fase 2 is zij de enige modelinput
//  en de toetssteen voor de guardrail. Deze tests borgen dat de tellingen,
//  doorlooptijd, hoogste vertrouwelijkheid en afwijkingsdetectie deterministisch
//  en correct zijn — inclusief het bewijs-zonder-bestand-geval (AC 4/7).
//
//  Geen testframework; standalone met assert. Uitvoeren: npx tsx core/lib/afschrift-feitenkaart.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import type {
  DecisionDossierView,
  DecisionObject,
  ProcedureSummary,
  ReadinessOverview,
  ReadinessResult,
  ReadinessTarget,
  Assumption,
  RiskItem,
  DecisionCondition,
  DissentItem,
  BewijsItem,
  BesluitItem,
  GovernanceEvent,
  Vertrouwelijkheid,
} from "./decision-view";
import { bouwFeitenkaart, dagenTussen, hoogsteVertrouwelijkheid } from "./afschrift-feitenkaart";
import type { AfschriftBron } from "./afschrift-types";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// ── Fixture-fabrieken ───────────────────────────────────────────────────────

function baseDecision(over: Partial<DecisionObject> = {}): DecisionObject {
  return {
    id: "dec-1",
    procedure_id: "proc-1",
    fonds_id: "fonds-1",
    besluit_code: "B-2026-001",
    titel: "Verhoging hedge-ratio",
    besluitvraag: "Verhogen naar 70%?",
    aanleiding: null,
    scope: null,
    governance_orgaan: null,
    vertrouwelijkheid: "intern",
    complexiteit: "complicated",
    risiconiveau: "middel",
    mandaatgevoelig: false,
    toezichtgevoelig: false,
    beleidsafwijking: false,
    ai_risicoklasse: "laag",
    status: "besloten",
    is_primary_decision: true,
    eigenaar_id: null,
    eigenaar_naam: null,
    template_versie: null,
    gewenste_besluitdatum: null,
    aangemaakt_op: "2026-03-03T09:00:00.000Z",
    laatst_gewijzigd: "2026-04-19T09:00:00.000Z",
    ...over,
  };
}

function baseProcedure(over: Partial<ProcedureSummary> = {}): ProcedureSummary {
  return {
    id: "proc-1",
    fonds_id: "fonds-1",
    template_code: "beleggingsbeleid",
    template_versie: null,
    titel: "Wijziging beleggingsbeleid 2026",
    beschrijving: null,
    status: "besloten",
    gestart_op: "2026-03-03T09:00:00.000Z",
    gestart_door: null,
    deadline: null,
    afgerond_op: "2026-04-19T09:00:00.000Z",
    decision_id: "dec-1",
    ...over,
  };
}

function leegReadinessResult(target: ReadinessTarget): ReadinessResult {
  return {
    decision_id: "dec-1",
    target,
    voldoet: true,
    blokkerend: false,
    kan_overrulen: [],
    ontbrekend: [],
  };
}

function baseReadiness(): ReadinessOverview {
  return {
    onderbouwing_compleet: leegReadinessResult("onderbouwing_compleet"),
    reviewrijp: leegReadinessResult("reviewrijp"),
    bespreekrijp: leegReadinessResult("bespreekrijp"),
    besluitrijp: leegReadinessResult("besluitrijp"),
    verantwoordingsrijp: leegReadinessResult("verantwoordingsrijp"),
    evaluatierijp: leegReadinessResult("evaluatierijp"),
  };
}

function maakView(over: Partial<DecisionDossierView> = {}): DecisionDossierView {
  return {
    decision: baseDecision(),
    procedure: baseProcedure(),
    currentStep: null,
    steps: [],
    readiness: baseReadiness(),
    evidence: [],
    stemverslagen: [],
    bewijs: [],
    besluiten: [],
    assumptions: [],
    risks: [],
    scenarios: [],
    aiOutputs: [],
    dissent: [],
    conditions: [],
    actions: [],
    evaluations: [],
    events: [],
    snapshots: [],
    auto_upgraded: false,
    ...over,
  };
}

function bron(decisions: DecisionDossierView[]): AfschriftBron {
  return {
    context: {
      afschriftId: "afs-1",
      procescode: "B-2026-001",
      versie: "besluitmoment",
      aanleiding: "t.b.v. jaarrekeningcontrole 2026",
      aangemaaktOp: "2026-08-09T12:00:00.000Z",
      aangemaaktDoorNaam: "M. IJzerman",
      gebouwdOnderRol: "voorzitter",
      generatorVersie: "t6-1.0",
    },
    decisions,
    procedureLog: [],
  };
}

function assumption(over: Partial<Assumption>): Assumption {
  return {
    id: "a", decision_id: "dec-1", tekst: "x", type: "macro",
    bron_document_id: null, ai_gedetecteerd: false, status: "concept",
    onzekerheid: null, evaluatiecriterium: null,
    aangemaakt_op: "2026-03-10T09:00:00.000Z", gewijzigd_door: null, ...over,
  };
}
function risk(over: Partial<RiskItem>): RiskItem {
  return {
    id: "r", decision_id: "dec-1", risicomatrix_id: null, categorie: "financieel",
    beschrijving: "x", impact: 3, kans: 2, eigenaar_naam: null, mitigatie: null,
    residual_risk: null, status: "open", aangemaakt_op: "2026-03-12T09:00:00.000Z", ...over,
  };
}
function conditie(over: Partial<DecisionCondition>): DecisionCondition {
  return {
    id: "c", decision_id: "dec-1", voorwaarde: "x", eigenaar_naam: null, kpi: null,
    drempelwaarde: null, monitorfrequentie: null, deadline: null,
    heroverwegingstrigger: null, status: "open",
    aangemaakt_op: "2026-03-14T09:00:00.000Z", ...over,
  };
}
function dissentItem(over: Partial<DissentItem>): DissentItem {
  return {
    id: "d", decision_id: "dec-1", bestuurder_id: null, bestuurder_naam: "X",
    zichtbaarheid: "formele_dissent", formeel_vastgesteld: true, standpunt: "x",
    argument: null, gekoppeld_risico_id: null, gekoppeld_aanname_id: null,
    gekoppeld_voorwaarde_id: null, aangemaakt_op: "2026-04-01T09:00:00.000Z", ...over,
  };
}
function bewijsItem(over: Partial<BewijsItem>): BewijsItem {
  return {
    id: "b", stap_id: "s1", document_id: "doc-1", titel: "ALM-analyse",
    beschrijving: null, documenttype: null, requirement_sleutel: null,
    toegevoegd_op: "2026-03-20T09:00:00.000Z",
    toegevoegd_door_naam: null, ...over,
  };
}
function besluitItem(over: Partial<BesluitItem>): BesluitItem {
  return {
    id: "bes", procedure_id: "proc-1", stap_id: null, decision_id: "dec-1",
    formulering: "Akkoord", motivering: null, datum: "2026-04-19T09:00:00.000Z",
    vastgelegd_door_naam: null, verworpen_alternatieven: null,
    vergadering_id: null, agendapunt_id: null, ...over,
  };
}
function govEvent(over: Partial<GovernanceEvent>): GovernanceEvent {
  return {
    id: "e", decision_id: "dec-1", event_type: "status_gewijzigd", actor_id: null,
    actor_naam: "Y", object_type: "decision_object", object_id: "dec-1",
    oude_waarde: null, nieuwe_waarde: null, reden: null, hash: "abc",
    tijdstip: "2026-03-05T09:00:00.000Z", ...over,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log("afschrift-feitenkaart sanity-tests:");

test("dagenTussen rekent hele dagen en nooit negatief", () => {
  assert.equal(dagenTussen("2026-03-03T09:00:00.000Z", "2026-04-19T09:00:00.000Z"), 47);
  assert.equal(dagenTussen("2026-04-19T09:00:00.000Z", "2026-03-03T09:00:00.000Z"), 0);
  assert.equal(dagenTussen(null, "2026-04-19T09:00:00.000Z"), null);
});

test("tellingen per status kloppen (aannames, risico's, voorwaarden, dissent)", () => {
  const view = maakView({
    assumptions: [
      assumption({ status: "gevalideerd" }),
      assumption({ status: "gevalideerd" }),
      assumption({ status: "concept" }),
    ],
    risks: [risk({ status: "geaccepteerd" }), risk({ status: "open" })],
    conditions: [conditie({ status: "open" }), conditie({ status: "vervuld" })],
    dissent: [
      dissentItem({ formeel_vastgesteld: true }),
      dissentItem({ formeel_vastgesteld: false, zichtbaarheid: "gedeelde_zorg" }),
    ],
  });
  const fk = bouwFeitenkaart(bron([view]));
  const b = fk.besluiten[0];
  assert.equal(b.aannames.totaal, 3);
  assert.equal(b.aannames.perStatus["gevalideerd"], 2);
  assert.equal(b.aannames.perStatus["concept"], 1);
  assert.equal(b.risicos.perStatus["geaccepteerd"], 1);
  assert.equal(b.voorwaarden.perStatus["open"], 1);
  assert.equal(b.dissent.totaal, 2);
  assert.equal(b.dissent.formeel, 1);
  // Totalen (leeswijzer §3)
  assert.equal(fk.totalen.aannames, 3);
  assert.equal(fk.totalen.aannamesGevalideerd, 2);
  assert.equal(fk.totalen.risicosGeaccepteerd, 1);
  assert.equal(fk.totalen.voorwaardenOpen, 1);
  assert.equal(fk.totalen.dissentFormeel, 1);
});

test("bewijs zonder document telt apart én levert een afwijking (AC 4/7)", () => {
  const view = maakView({
    bewijs: [bewijsItem({ document_id: "doc-1" }), bewijsItem({ id: "b2", document_id: null })],
  });
  const fk = bouwFeitenkaart(bron([view]));
  assert.equal(fk.bewijs.totaal, 2);
  assert.equal(fk.bewijs.metDocument, 1);
  assert.equal(fk.bewijs.zonderDocument, 1);
  assert.ok(
    fk.afwijkingen.some((a) => a.includes("alleen uit titel en beschrijving")),
    "verwacht een afwijkingsregel over bewijs zonder bestand"
  );
});

test("doorlooptijd = gestart_op → afgerond_op; onderbouwingsfase uit vastleggingen", () => {
  const view = maakView({
    events: [govEvent({ tijdstip: "2026-03-05T09:00:00.000Z" })],
    besluiten: [besluitItem({ datum: "2026-04-19T09:00:00.000Z" })],
  });
  const fk = bouwFeitenkaart(bron([view]));
  assert.equal(fk.doorlooptijdDagen, 47);
  assert.equal(fk.onderbouwingsfase.start, "2026-03-05T09:00:00.000Z");
  assert.equal(fk.onderbouwingsfase.eind, "2026-04-19T09:00:00.000Z");
  assert.equal(fk.besluiten[0].vastgelegdeBesluiten.totaal, 1);
});

test("nog lopend proces: doorlooptijd tegen generatietijdstip (deterministisch)", () => {
  const view = maakView({ procedure: baseProcedure({ afgerond_op: null }) });
  const fk = bouwFeitenkaart(bron([view]));
  // gestart 2026-03-03 → aangemaaktOp 2026-08-09
  assert.equal(fk.doorlooptijdDagen, dagenTussen("2026-03-03T09:00:00.000Z", "2026-08-09T12:00:00.000Z"));
});

test("hoogste vertrouwelijkheid over meerdere besluiten wint", () => {
  const v1 = maakView({ decision: baseDecision({ vertrouwelijkheid: "intern" }) });
  const v2 = maakView({
    decision: baseDecision({ id: "dec-2", besluit_code: "B-2026-002", vertrouwelijkheid: "strikt_vertrouwelijk" as Vertrouwelijkheid }),
  });
  assert.equal(hoogsteVertrouwelijkheid([v1, v2]), "strikt_vertrouwelijk");
  const fk = bouwFeitenkaart(bron([v1, v2]));
  assert.equal(fk.hoogsteVertrouwelijkheid, "strikt_vertrouwelijk");
  assert.equal(fk.aantalBesluiten, 2);
});

test("afwijkende besluitstatus (heropend) wordt benoemd, niet weggeschreven", () => {
  const view = maakView({ decision: baseDecision({ status: "heropend" }) });
  const fk = bouwFeitenkaart(bron([view]));
  assert.ok(fk.afwijkingen.some((a) => a.includes("heropend")));
});

test("overruling-event levert een afwijkingsregel", () => {
  const view = maakView({
    events: [govEvent({ event_type: "readiness_overruled", tijdstip: "2026-04-10T09:00:00.000Z" })],
  });
  const fk = bouwFeitenkaart(bron([view]));
  assert.ok(fk.afwijkingen.some((a) => a.toLowerCase().includes("overruling")));
});

test("besluiten worden per Decision Object toegewezen (view.besluiten is procesbreed)", () => {
  const v1 = maakView({
    decision: baseDecision({ id: "dec-1" }),
    besluiten: [besluitItem({ id: "x1", decision_id: "dec-1" }), besluitItem({ id: "x2", decision_id: "dec-2" })],
  });
  const v2 = maakView({
    decision: baseDecision({ id: "dec-2", besluit_code: "B-2026-002" }),
    besluiten: [besluitItem({ id: "x1", decision_id: "dec-1" }), besluitItem({ id: "x2", decision_id: "dec-2" })],
  });
  const fk = bouwFeitenkaart(bron([v1, v2]));
  assert.equal(fk.besluiten[0].vastgelegdeBesluiten.totaal, 1);
  assert.equal(fk.besluiten[1].vastgelegdeBesluiten.totaal, 1);
});

console.log(`\nafschrift-feitenkaart: ${n} tests groen.`);
