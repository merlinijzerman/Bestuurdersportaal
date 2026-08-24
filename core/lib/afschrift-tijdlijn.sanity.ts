// ============================================================
//  Sanity-tests voor de afschrift-tijdlijn + auditlog (T6, C2/C4).
//
//  Kernacceptatie (AC 3a): de tijdlijn voegt BEIDE auditsporen samen —
//  procedure_log ('proces') én governance_events ('besluit') — correct
//  chronologisch gemengd. Een tijdlijn uit één spoor is aantoonbaar onvolledig.
//  Verder: CSV-escaping (RFC 4180) en de bron-kolom in de auditlog.
//
//  Geen testframework; standalone. Uitvoeren: npx tsx core/lib/afschrift-tijdlijn.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import type {
  DecisionDossierView,
  DecisionObject,
  ProcedureSummary,
  ReadinessOverview,
  ReadinessResult,
  ReadinessTarget,
  GovernanceEvent,
} from "./decision-view";
import type { AfschriftBron, ProcedureLogEntry } from "./afschrift-types";
import {
  bouwAuditRegels,
  tijdlijnCSV,
  tijdlijnHTML,
  auditlogCSV,
  auditlogJSON,
} from "./afschrift-tijdlijn";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// Compacte view-fabriek (alleen wat bouwAuditRegels raakt is inhoudelijk).
function leegReadiness(): ReadinessOverview {
  const r = (t: ReadinessTarget): ReadinessResult => ({
    decision_id: "dec-1", target: t, voldoet: true, blokkerend: false,
    kan_overrulen: [], ontbrekend: [],
  });
  return {
    onderbouwing_compleet: r("onderbouwing_compleet"), reviewrijp: r("reviewrijp"),
    bespreekrijp: r("bespreekrijp"), besluitrijp: r("besluitrijp"),
    verantwoordingsrijp: r("verantwoordingsrijp"), evaluatierijp: r("evaluatierijp"),
  };
}
function decision(over: Partial<DecisionObject> = {}): DecisionObject {
  return {
    id: "dec-1", procedure_id: "proc-1", fonds_id: "fonds-1", besluit_code: "B-2026-001",
    titel: "Besluit", besluitvraag: "?", aanleiding: null, scope: null,
    governance_orgaan: null, vertrouwelijkheid: "intern", complexiteit: "routine",
    risiconiveau: "laag", mandaatgevoelig: false, toezichtgevoelig: false,
    beleidsafwijking: false, ai_risicoklasse: "laag", status: "besloten",
    is_primary_decision: true, eigenaar_id: null, eigenaar_naam: null,
    template_versie: null, gewenste_besluitdatum: null,
    aangemaakt_op: "2026-03-01T09:00:00.000Z", laatst_gewijzigd: "2026-04-01T09:00:00.000Z", ...over,
  };
}
function procedure(): ProcedureSummary {
  return {
    id: "proc-1", fonds_id: "fonds-1", template_code: "t", template_versie: null, titel: "Proces",
    beschrijving: null, status: "besloten", gestart_op: "2026-03-01T09:00:00.000Z",
    gestart_door: null, deadline: null, afgerond_op: "2026-04-01T09:00:00.000Z", decision_id: "dec-1",
  };
}
function view(over: Partial<DecisionDossierView> = {}): DecisionDossierView {
  return {
    decision: decision(), procedure: procedure(), currentStep: null, steps: [],
    readiness: leegReadiness(), evidence: [], stemverslagen: [], bewijs: [], besluiten: [],
    assumptions: [], risks: [], scenarios: [], aiOutputs: [], dissent: [], conditions: [],
    actions: [], evaluations: [], events: [], snapshots: [], auto_upgraded: false, ...over,
  };
}
function gev(over: Partial<GovernanceEvent>): GovernanceEvent {
  return {
    id: "e1", decision_id: "dec-1", event_type: "assumption_toegevoegd", actor_id: null,
    actor_naam: "Anna", object_type: "assumption", object_id: "a1", oude_waarde: null,
    nieuwe_waarde: { tekst: "x" }, reden: null, hash: "deadbeef12345678",
    tijdstip: "2026-03-10T09:00:00.000Z", ...over,
  };
}
function logEntry(over: Partial<ProcedureLogEntry>): ProcedureLogEntry {
  return {
    id: "l1", procedure_id: "proc-1", event_type: "stap_voltooid", actor_naam: "Merlin",
    payload: { stap: "Onderbouwing" }, tijdstip: "2026-03-20T09:00:00.000Z", ...over,
  };
}

function bron(): AfschriftBron {
  return {
    context: {
      afschriftId: "afs-1", procescode: "B-2026-001", versie: "besluitmoment",
      aanleiding: null, aangemaaktOp: "2026-08-09T12:00:00.000Z",
      aangemaaktDoorNaam: "M. IJzerman", gebouwdOnderRol: "voorzitter", generatorVersie: "t6-1.0",
    },
    decisions: [
      view({
        events: [
          gev({ id: "e1", event_type: "assumption_toegevoegd", tijdstip: "2026-03-10T09:00:00.000Z" }),
          gev({ id: "e2", event_type: "risk_toegevoegd", tijdstip: "2026-03-25T09:00:00.000Z", object_type: "risk" }),
        ],
      }),
    ],
    procedureLog: [
      logEntry({ id: "l1", event_type: "stap_voltooid", tijdstip: "2026-03-20T09:00:00.000Z" }),
      logEntry({ id: "l0", event_type: "procedure_aangemaakt", tijdstip: "2026-03-01T09:00:00.000Z", payload: {} }),
    ],
  };
}

console.log("afschrift-tijdlijn sanity-tests:");

test("beide sporen worden samengevoegd en chronologisch gesorteerd (AC 3a)", () => {
  const regels = bouwAuditRegels(bron());
  assert.equal(regels.length, 4);
  // chronologisch: 03-01 (proces), 03-10 (besluit), 03-20 (proces), 03-25 (besluit)
  assert.deepEqual(
    regels.map((r) => `${r.spoor}:${r.event_type}`),
    ["proces:procedure_aangemaakt", "besluit:assumption_toegevoegd", "proces:stap_voltooid", "besluit:risk_toegevoegd"]
  );
  // Beide sporen aantoonbaar aanwezig
  assert.ok(regels.some((r) => r.spoor === "proces" && r.event_type === "stap_voltooid"));
  assert.ok(regels.some((r) => r.spoor === "besluit" && r.event_type === "assumption_toegevoegd"));
});

test("besluit-spoor draagt hash + besluit_code; proces-spoor niet", () => {
  const regels = bouwAuditRegels(bron());
  const besluitRegel = regels.find((r) => r.event_type === "assumption_toegevoegd")!;
  assert.equal(besluitRegel.besluit_code, "B-2026-001");
  assert.equal(besluitRegel.hash, "deadbeef12345678");
  const procesRegel = regels.find((r) => r.event_type === "stap_voltooid")!;
  assert.equal(procesRegel.besluit_code, null);
  assert.equal(procesRegel.hash, null);
});

test("tijdlijn-CSV bevat kop + één regel per gebeurtenis, beide sporen", () => {
  const regels = bouwAuditRegels(bron());
  const csv = tijdlijnCSV(regels);
  const regelsCsv = csv.trimEnd().split("\r\n");
  assert.equal(regelsCsv.length, 1 + 4); // kop + 4
  assert.ok(regelsCsv[0].includes('"spoor"'));
  assert.ok(csv.includes('"proces"') && csv.includes('"besluit"'));
});

test("CSV-cellen zijn RFC 4180: quotes verdubbeld, komma's veilig", () => {
  const b = bron();
  b.procedureLog = [logEntry({ payload: { titel: 'Notitie met "quote", en komma' } })];
  b.decisions[0].events = [];
  const csv = tijdlijnCSV(bouwAuditRegels(b));
  assert.ok(csv.includes('""quote""'), "interne quotes moeten verdubbeld zijn");
});

test("auditlog-JSON heeft een expliciete bron-kolom en behoudt oude/nieuwe waarde", () => {
  const regels = bouwAuditRegels(bron());
  const parsed = JSON.parse(auditlogJSON(regels)) as Array<{ bron: string; nieuwe_waarde: unknown }>;
  assert.equal(parsed.length, 4);
  assert.ok(parsed.every((p) => p.bron === "proces" || p.bron === "besluit"));
  const assumptionRegel = parsed.find((p) => (p as { event_type?: string }).event_type === "assumption_toegevoegd")!;
  assert.deepEqual(assumptionRegel.nieuwe_waarde, { tekst: "x" });
});

test("auditlog-CSV heeft de bron-kolom in de kop", () => {
  const csv = auditlogCSV(bouwAuditRegels(bron()));
  assert.ok(csv.split("\r\n")[0].includes('"bron"'));
});

test("tijdlijn-HTML rendert beide spoor-badges", () => {
  const html = tijdlijnHTML(bouwAuditRegels(bron()), {
    procescode: "B-2026-001", procedureTitel: "Proces", versie: "besluitmoment",
    gegenereerdOp: "2026-08-09T12:00:00.000Z",
  });
  assert.ok(html.includes("sp-proces") && html.includes("sp-besluit"));
  assert.ok(html.includes("<!DOCTYPE html>"));
});

console.log(`\nafschrift-tijdlijn: ${n} tests groen.`);
