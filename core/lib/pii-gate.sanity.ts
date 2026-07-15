// ============================================================================
//  Sanity-tests voor lib/pii-gate.ts (Scenario A, besluit 0072, FR-9 / AC-10).
//  Dekt: harde PII-signalen blokkeren; zuivere beleidsvraag wordt NIET geblokkeerd.
//
//  Uitvoeren: npx tsx lib/pii-gate.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import { bevatPersoonsgegevens } from "./pii-gate";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("pii-gate sanity-tests:");

test("AC-10 negatief: zuivere beleids-/wetsvraag bevat geen PII", () => {
  const r = bevatPersoonsgegevens(
    "Wat zegt de Pensioenwet over de solidariteitsreserve en welke DNB-guidance geldt?"
  );
  assert.equal(r.bevatPii, false);
  assert.deepEqual(r.soorten, []);
});

test("geldige BSN (elf-proef) wordt gedetecteerd", () => {
  const r = bevatPersoonsgegevens("Kun je iets opzoeken voor deelnemer 123456782?");
  assert.equal(r.bevatPii, true);
  assert.ok(r.soorten.includes("bsn"));
});

test("willekeurig 9-cijferig getal (geen elf-proef) is geen BSN", () => {
  const r = bevatPersoonsgegevens("Het reservebedrag is 123456789 euro.");
  assert.equal(r.soorten.includes("bsn"), false);
});

test("e-mailadres wordt gedetecteerd", () => {
  const r = bevatPersoonsgegevens("Stuur het naar jan.jansen@voorbeeld.nl");
  assert.ok(r.soorten.includes("email"));
});

test("NL IBAN wordt gedetecteerd", () => {
  const r = bevatPersoonsgegevens("Rekening NL91 ABNA 0417 1643 00 gebruiken");
  assert.ok(r.soorten.includes("iban"));
});

test("telefoonnummer wordt gedetecteerd", () => {
  const r = bevatPersoonsgegevens("Bel mij op 06-12345678 voor overleg");
  assert.ok(r.soorten.includes("telefoon"));
});

test("expliciete persoonsaanduiding wordt gedetecteerd", () => {
  const r = bevatPersoonsgegevens("Wat vindt mevrouw Pietersen van dit voorstel?");
  assert.ok(r.soorten.includes("persoonsaanduiding"));
});

test("letterlijke fondsnaam telt als fondsgegeven", () => {
  const r = bevatPersoonsgegevens(
    "Hoe verhoudt Stichting Pensioenfonds Horizon zich tot de norm?",
    ["Stichting Pensioenfonds Horizon"]
  );
  assert.ok(r.soorten.includes("fondsnaam"));
});

console.log(`\n${n} pii-gate sanity-tests geslaagd.`);
