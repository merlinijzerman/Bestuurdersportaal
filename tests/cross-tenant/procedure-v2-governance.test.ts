// ============================================================================
//  §15 / engine v2 — governance- en tenant-invarianten op de nieuwe D6/D7-routes.
// ----------------------------------------------------------------------------
//  App-laag, bron-inspectie (zelfde patroon als audit-fonds.test.ts): de
//  kritieke server-side waarborgen op de nieuwe routes mogen niet stil
//  regresseren. De DB-laag (RLS-weigering, readiness-unie, snapshot-integriteit)
//  staat in supabase/checks/2026_08_13_engine_v2_verificatie.sql en draait tegen
//  de doeldatabase.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/procedure-v2-governance.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, "..", "..", ...p), "utf8");

const requirementsRoute = lees("app", "api", "procedures", "[id]", "requirements", "route.ts");
const requirementItemRoute = lees("app", "api", "procedures", "[id]", "requirements", "[reqId]", "route.ts");
const heropenenRoute = lees("app", "api", "procedures", "[id]", "stappen", "[stapId]", "heropenen", "route.ts");
const checklistItemRoute = lees("app", "api", "procedures", "[id]", "checklist", "[itemId]", "route.ts");
const decisionLib = lees("core", "lib", "decision.ts");
const readinessMigratie = lees("supabase", "migrations", "2026_08_13_d7c_readiness_unie.sql");

const rolGate = /\[\s*"voorzitter"\s*,\s*"beheerder"\s*\]\.includes\(/;

test("D7 requirements-toevoegen: rol-gate voorzitter/beheerder aanwezig", () => {
  assert.match(requirementsRoute, rolGate);
});

test("D7 requirements-toevoegen: fonds_id server-side uit de procedure, niet uit de body", () => {
  // Fonds komt uit een select op `procedures`, en wordt aan de insert gevoerd.
  assert.match(requirementsRoute, /from\("procedures"\)[\s\S]*?select\("id, fonds_id"\)/);
  assert.match(requirementsRoute, /fonds_id:\s*procedure\.fonds_id/);
  // Geen fonds_id rechtstreeks uit de request body.
  assert.doesNotMatch(requirementsRoute, /body\.fonds_id/);
});

test("D7 requirements-toevoegen: schrijft een governance_event", () => {
  assert.match(requirementsRoute, /from\("governance_events"\)\s*\.insert/);
  assert.match(requirementsRoute, /event_type:\s*"requirement_toegevoegd"/);
});

test("D7 requirement deactiveren: REQ-006 — blokkerend vereist motivering", () => {
  // De guard moet blokkerend + actief===false + ontbrekende motivering afvangen.
  assert.match(
    requirementItemRoute,
    /reqRow\.blokkerend\s*&&\s*body\.actief === false\s*&&\s*!motivering/
  );
  assert.match(requirementItemRoute, /status:\s*422/);
  assert.match(requirementItemRoute, rolGate);
});

test("D6 heropenen: rol-gate + verplichte motivering + governance_event", () => {
  assert.match(heropenenRoute, rolGate);
  // Motivering verplicht: lege motivering → 400.
  assert.match(heropenenRoute, /if\s*\(!motivering\)/);
  assert.match(heropenenRoute, /event_type:\s*"stap_heropend"/);
  // Alleen een afgeronde stap mag heropend worden.
  assert.match(heropenenRoute, /stap\.status !== "afgerond"/);
});

test("D7 checklist (de)activeren: rol-gate + governance_event", () => {
  assert.match(checklistItemRoute, rolGate);
  assert.match(checklistItemRoute, /checklistitem_gedeactiveerd/);
});

test("D7 readiness-unie: buildEvidenceLijst leest actieve instantie-requirements", () => {
  assert.match(decisionLib, /from\("procedure_requirement_instance"\)/);
  assert.match(decisionLib, /\.eq\("actief",\s*true\)/);
  // De unie mag geen dubbeltelling geven: template + instance worden
  // geconcateneerd (disjuncte rijen), niet gededupliceerd weg.
  assert.match(decisionLib, /alleRequirements\s*=\s*\[\s*\.\.\.requirements,\s*\.\.\.instanceRequirements\s*\]/);
});

test("D7 readiness-migratie: UNION ALL van template + instantie én grant-herstel (Gate H)", () => {
  assert.match(readinessMigratie, /union all/i);
  assert.match(readinessMigratie, /procedure_requirement_instance/);
  assert.match(readinessMigratie, /actief\s*=\s*true/);
  // Grant-hygiëne na create-or-replace (les OP-C13).
  assert.match(readinessMigratie, /revoke all on function public\.fn_decision_readiness_check\(uuid, text\) from public, anon/);
  assert.match(readinessMigratie, /grant execute on function public\.fn_decision_readiness_check\(uuid, text\) to authenticated, service_role/);
});
