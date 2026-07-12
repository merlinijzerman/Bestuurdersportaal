// ============================================================
//  Sanity-tests voor het metadata-model (Increment C).
//  Dekt de contextvalidatieregels (FO §6) en de veld-classificatie
//  (RAG-impact / governance-kritiek, FO §7).
//
//  Uitvoeren: npx tsx lib/document-metadata.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  valideerContext,
  contextIsGeldig,
  isRagImpactVeld,
  isGovernanceKritiekVeld,
} from "./document-metadata";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("document-metadata sanity-tests:");

test("context 'dossier' zonder procesinstantie wordt geweigerd", () => {
  const blokkers = valideerContext({ context: "dossier", procesinstantie_id: null });
  assert.equal(blokkers.length, 1);
  assert.equal(contextIsGeldig({ context: "dossier", procesinstantie_id: null }), false);
});

test("context 'dossier' MET procesinstantie is geldig", () => {
  assert.equal(
    contextIsGeldig({ context: "dossier", procesinstantie_id: "p1" }),
    true
  );
});

test("context 'vergadering' zonder vergadering_id wordt geweigerd", () => {
  assert.equal(
    contextIsGeldig({ context: "vergadering", vergadering_id: null }),
    false
  );
});

test("agendapunt zonder vergadering wordt geweigerd", () => {
  const blokkers = valideerContext({
    context: "algemeen",
    agendapunt_id: "a1",
    vergadering_id: null,
  });
  assert.ok(blokkers.some((b) => b.includes("agendapunt")));
});

test("agendapunt MET vergadering is structureel geldig", () => {
  assert.equal(
    contextIsGeldig({
      context: "vergadering",
      vergadering_id: "v1",
      agendapunt_id: "a1",
    }),
    true
  );
});

test("context 'algemeen' heeft geen koppelverplichting", () => {
  assert.equal(contextIsGeldig({ context: "algemeen" }), true);
});

test("RAG-impactvelden zijn als zodanig geclassificeerd", () => {
  assert.equal(isRagImpactVeld("status"), true);
  assert.equal(isRagImpactVeld("bronstatus"), true);
  assert.equal(isRagImpactVeld("geldig_vanaf"), true);
  assert.equal(isRagImpactVeld("documenttype"), true);
  // agendapunt_id raakt de RAG-scope niet rechtstreeks
  assert.equal(isRagImpactVeld("agendapunt_id"), false);
});

test("governance-kritieke velden vereisen altijd een reden", () => {
  assert.equal(isGovernanceKritiekVeld("geldig_vanaf"), true);
  assert.equal(isGovernanceKritiekVeld("vervangen_door_document_id"), true);
  assert.equal(isGovernanceKritiekVeld("documenttype"), false);
});

console.log(`\n${n} sanity-tests geslaagd.`);
