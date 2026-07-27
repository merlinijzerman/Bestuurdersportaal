// ============================================================================
//  P3-B — tenant-gebruikersbeheer: pure guard-/validatietests (FO §10, 0082).
// ----------------------------------------------------------------------------
//  Toetst de wachtwoordvrije, DB-vrije basisvalidatie van het aanmaakpad en de
//  rol-whitelist. Dit zijn de NEGATIEVE controles die in cross-tenant-ci stap
//  [2] meedraaien (acceptatiecriterium 9): aanmaak zonder fonds / met ongeldige
//  rol / met een te zwak wachtwoord faalt hard, en de rol-whitelist blijft
//  gelijk aan de profielen.rol-CHECK (drift-bewaking).
//
//  De fonds-EXISTENTIE-checks (ontbrekend/ongeldig/onbekend fonds → trigger-
//  rollback, géén half account) leven in de DB-trigger maak_profiel() en worden
//  bewezen door supabase/checks/2026_07_08_maak_profiel_deterministisch.sql
//  (paste-in-check, zoals zijn sibling-checks). Die trigger is exact het pad dat
//  auth.admin.createUser raakt.
//
//  Draaien:  node --import tsx --test tests/cross-tenant/p3b-gebruikersbeheer.test.ts
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import {
  TENANT_ROLLEN,
  MIN_WACHTWOORD_LENGTE,
  isTenantRol,
  valideerAanmaakBasis,
} from "../../app/(platform)/platform/(beveiligd)/gebruikers/gedeeld";

// De whitelist MOET gelijk blijven aan de profielen.rol-CHECK
// (schema.sql: rol in ('bestuurder','voorzitter','beheerder')). Drift hier zou
// betekenen dat de UI/action een rol toelaat die de DB-CHECK weigert (of andersom).
const ROL_CHECK_WAARDEN = ["bestuurder", "voorzitter", "beheerder"];

const GELDIG = {
  fondsId: "11111111-1111-1111-1111-111111111111",
  email: "nieuw@example.test",
  naam: "Nieuwe Bestuurder",
  rol: "bestuurder",
  reden: "Onboarding n.a.v. benoemingsbesluit",
  wachtwoordLengte: MIN_WACHTWOORD_LENGTE,
};

test("rol-whitelist is identiek aan de profielen.rol-CHECK", () => {
  assert.deepEqual([...TENANT_ROLLEN].sort(), [...ROL_CHECK_WAARDEN].sort());
  for (const r of ROL_CHECK_WAARDEN) assert.ok(isTenantRol(r), `${r} zou geldig moeten zijn`);
  assert.ok(!isTenantRol("superuser"), "onbekende rol mag niet geldig zijn");
  assert.ok(!isTenantRol("platform"), "platform is geen tenant-rol");
});

test("geldige invoer passeert de basisvalidatie", () => {
  assert.deepEqual(valideerAanmaakBasis(GELDIG), { ok: true });
});

test("NEGATIEF: aanmaak zonder fonds faalt hard (geen default/eerste-fonds)", () => {
  const r = valideerAanmaakBasis({ ...GELDIG, fondsId: "" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.foutcode, "fonds_verplicht");
});

test("NEGATIEF: ontbrekende reden faalt hard (governance)", () => {
  const r = valideerAanmaakBasis({ ...GELDIG, reden: "   " });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.foutcode, "reden_verplicht");
});

test("NEGATIEF: ongeldige rolwaarde faalt hard (whitelist)", () => {
  const r = valideerAanmaakBasis({ ...GELDIG, rol: "beheerder-plus" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.foutcode, "ongeldige_rol");
});

test("NEGATIEF: te zwak wachtwoord faalt hard (server-side sterkte-eis)", () => {
  const r = valideerAanmaakBasis({ ...GELDIG, wachtwoordLengte: MIN_WACHTWOORD_LENGTE - 1 });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.foutcode, "wachtwoord_te_zwak");
});

test("NEGATIEF: leeg e-mailadres en lege naam falen hard", () => {
  assert.equal((valideerAanmaakBasis({ ...GELDIG, email: "  " }) as { foutcode?: string }).foutcode, "email_verplicht");
  assert.equal((valideerAanmaakBasis({ ...GELDIG, naam: "" }) as { foutcode?: string }).foutcode, "naam_verplicht");
});
