// ============================================================================
//  Sanity-tests voor de pure audit-beoordeling (W11, EPIC W, deploy 3).
//
//  Server-loos: audit-enforce.ts heeft geen imports met I/O. De DB-write zelf
//  (de handelingstabel) is geïnjecteerd in de wrapper en wordt daar getest.
//
//  Het kernpunt dat hier hard moet staan is de OMGEKEERDE vlag-semantiek: anders
//  dan bij capability betekent de vlag-uit-stand NIETS SCHRIJVEN. Wie die
//  analogie te ver doortrekt, bouwt een wrapper die met de vlag uit al rijen
//  wegschrijft — en dat is geen gedragsbehoudende landing meer.
//
//  Uitvoeren: npx tsx core/lib/audit-enforce.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  auditEnforceVoorOmgeving,
  beoordeelAudit,
} from "./audit-enforce";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("audit-enforce sanity-tests:");

// ── De env-schakelaar ────────────────────────────────────────────────────────

test("alleen ENFORCE_AUDIT=on zet de poort aan", () => {
  assert.equal(auditEnforceVoorOmgeving({ enforceAudit: "on" }), true);
  assert.equal(auditEnforceVoorOmgeving({ enforceAudit: " ON " }), true);
  assert.equal(auditEnforceVoorOmgeving({ enforceAudit: "off" }), false);
  assert.equal(auditEnforceVoorOmgeving({ enforceAudit: "" }), false);
  assert.equal(auditEnforceVoorOmgeving({ enforceAudit: null }), false);
  assert.equal(auditEnforceVoorOmgeving({}), false);
});

test("de schakelaar leunt NIET op de omgeving — kale opt-in", () => {
  const omgevingsInvoer = {
    enforceAudit: undefined,
    vercelEnv: "production",
    vercelTargetEnv: "preview",
    deployTarget: "staging",
  };
  assert.equal(
    auditEnforceVoorOmgeving(omgevingsInvoer),
    false,
    "een beschermde omgeving mag de audit-poort in W11 niet stil aanzetten"
  );
});

// ── De zou-actie, met de OMGEKEERDE semantiek ────────────────────────────────

test("geen declaratie / \"geen\" → niets (geen log, geen rij), ongeacht de vlag", () => {
  for (const handhaven of [false, true]) {
    assert.deepEqual(beoordeelAudit({ audit: undefined, handhaven }), { actie: "niets" });
    assert.deepEqual(beoordeelAudit({ audit: "geen", handhaven }), { actie: "niets" });
  }
});

test("AuditSpec + vlag UIT → OBSERVE (loggen, NIETS schrijven) — de omgekeerde semantiek", () => {
  const u = beoordeelAudit({ audit: { handeling: "besluit.status.wijzigen" }, handhaven: false });
  assert.deepEqual(u, { actie: "observe", handeling: "besluit.status.wijzigen" });
  // De naam "observe" is bewust hetzelfde woord als bij capability, maar de
  // BETEKENIS is tegengesteld: hier schrijft observe niets. De wrapper-test
  // (route-wrapper.sanity.ts) bewijst dat er onder deze tak geen schrijver draait.
});

test("AuditSpec + vlag AAN → SCHRIJVEN, met het handeling-label", () => {
  const u = beoordeelAudit({ audit: { handeling: "risico.sluiten" }, handhaven: true });
  assert.deepEqual(u, { actie: "schrijven", handeling: "risico.sluiten" });
});

console.log(`\n${n} sanity-tests geslaagd.`);
