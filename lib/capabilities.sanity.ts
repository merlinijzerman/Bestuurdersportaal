// ============================================================
//  Sanity-tests voor het capability-model (besluit 0006 B11).
//
//  De DB-read (requireCapability) is niet pure-TS testbaar; de
//  autorisatie-LOGICA zit in de pure mapping rolHeeftCapability. Die toetsen we
//  hier 1-op-1 tegen de eis uit het ticket (§7/§14 punt 5): beheerder mag
//  catalog.manage; bestuurder/voorzitter niet.
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx lib/capabilities.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { rolHeeftCapability, ROL_CAPABILITIES } from "./capabilities";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("capability sanity-tests:");

test("beheerder heeft catalog.manage", () => {
  assert.equal(rolHeeftCapability("beheerder", "catalog.manage"), true);
});

test("bestuurder heeft GEEN catalog.manage", () => {
  assert.equal(rolHeeftCapability("bestuurder", "catalog.manage"), false);
});

test("voorzitter heeft GEEN catalog.manage", () => {
  assert.equal(rolHeeftCapability("voorzitter", "catalog.manage"), false);
});

test("onbekende rol heeft geen capabilities", () => {
  assert.equal(rolHeeftCapability("auditor", "catalog.manage"), false);
});

test("null/undefined rol is veilig (geen capability)", () => {
  assert.equal(rolHeeftCapability(null, "catalog.manage"), false);
  assert.equal(rolHeeftCapability(undefined, "catalog.manage"), false);
});

test("alle drie de bekende rollen staan in de mapping", () => {
  for (const rol of ["beheerder", "voorzitter", "bestuurder"]) {
    assert.ok(rol in ROL_CAPABILITIES, `${rol} ontbreekt in mapping`);
  }
});

test("beheerder heeft dossiers.manage", () => {
  assert.equal(rolHeeftCapability("beheerder", "dossiers.manage"), true);
});

test("voorzitter heeft dossiers.manage", () => {
  assert.equal(rolHeeftCapability("voorzitter", "dossiers.manage"), true);
});

test("bestuurder heeft GEEN dossiers.manage", () => {
  assert.equal(rolHeeftCapability("bestuurder", "dossiers.manage"), false);
});

// ── Increment C — document-/metadata-capabilities ──────────────────────
const C_CAPS = [
  "documents.metadata.update",
  "documents.status.change",
  "documents.bronstatus.change",
  "metadata.review",
] as const;

test("beheerder + voorzitter dragen alle C-capabilities", () => {
  for (const cap of C_CAPS) {
    assert.equal(rolHeeftCapability("beheerder", cap), true, `beheerder ${cap}`);
    assert.equal(rolHeeftCapability("voorzitter", cap), true, `voorzitter ${cap}`);
  }
});

// I-2-release: bestuurder mag ALLE metadatavelden bewerken — koppelvelden
// (documents.metadata.update) én documentstatus/bronstatus. Review-AFRONDING
// (metadata.review) is een beoordelende governance-handeling, GEEN metadata-
// bewerking, en blijft bij beheerder/voorzitter.
const C_BEWERK_CAPS = [
  "documents.metadata.update",
  "documents.status.change",
  "documents.bronstatus.change",
] as const;

test("bestuurder draagt alle metadata-bewerkcapabilities (I-2-release)", () => {
  for (const cap of C_BEWERK_CAPS) {
    assert.equal(rolHeeftCapability("bestuurder", cap), true, `bestuurder ${cap}`);
  }
});

test("bestuurder draagt GEEN metadata.review (review = governance, geen bewerking)", () => {
  assert.equal(rolHeeftCapability("bestuurder", "metadata.review"), false);
});

// ── Increment E — classification.review ────────────────────────────────
test("beheerder + voorzitter dragen classification.review", () => {
  assert.equal(rolHeeftCapability("beheerder", "classification.review"), true);
  assert.equal(rolHeeftCapability("voorzitter", "classification.review"), true);
});

test("bestuurder draagt GEEN classification.review", () => {
  assert.equal(rolHeeftCapability("bestuurder", "classification.review"), false);
});

// ── Increment D — notulen.segment.confirm ──────────────────────────────
test("beheerder + voorzitter dragen notulen.segment.confirm", () => {
  assert.equal(rolHeeftCapability("beheerder", "notulen.segment.confirm"), true);
  assert.equal(rolHeeftCapability("voorzitter", "notulen.segment.confirm"), true);
});

test("bestuurder draagt GEEN notulen.segment.confirm (server-side gating)", () => {
  assert.equal(rolHeeftCapability("bestuurder", "notulen.segment.confirm"), false);
});

// ── Increment F — profile.manage.own (strikt zelfbeheer, besluit 0017) ─────
test("alle drie de rollen dragen profile.manage.own (eigen profiel beheren)", () => {
  for (const rol of ["beheerder", "voorzitter", "bestuurder"]) {
    assert.equal(rolHeeftCapability(rol, "profile.manage.own"), true, `${rol} profile.manage.own`);
  }
});

test("er bestaat GEEN profile.manage.all in de mapping (geen beheerder-override)", () => {
  // Profielen zijn strikt zelfbeheerd; niemand mag andermans profiel wijzigen.
  // Zou er ooit een manage.all bijkomen, dan faalt deze test bewust als signaal
  // om de privacy-keuze (besluit 0017) opnieuw te wegen.
  for (const caps of Object.values(ROL_CAPABILITIES)) {
    assert.ok(
      !(caps as string[]).includes("profile.manage.all"),
      "profile.manage.all mag aan geen enkele rol toegekend zijn"
    );
  }
});

console.log(`\n${n} sanity-tests geslaagd.`);
