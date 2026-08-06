// ============================================================
//  Sanity-tests voor core/lib/aqlab/guardrailkader-view.ts (T3, FR-19).
//
//  Geen testframework; standalone met assert.
//  Uitvoeren: npx tsx core/lib/aqlab-guardrailkader-view.sanity.ts
//  (Flat in core/lib/ zodat `npm run sanity` de suite oppikt — zelfde patroon
//   als aqlab-assurance.sanity.ts.)
//
//  Verifieert dat de read-only guardrailkader-view het canonieke register 1-op-1
//  weergeeft: 23 rijen, kernregel groen, de bureau-promptvariant, en dat de
//  borging-aard de klasse volgt (H/D geautomatiseerd, M via evalset).
// ============================================================

import assert from "node:assert/strict";
import {
  bouwGuardrailkaderView,
  bouwGuardrailkaderRij,
  BUREAU_PROMPTVARIANT,
} from "./aqlab/guardrailkader-view";
import { GUARDRAILKADER } from "./guardrailkader";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("aqlab-guardrailkader-view sanity-tests:");

const view = bouwGuardrailkaderView();

check("de view toont alle 23 guardrails, in registervolgorde", () => {
  assert.equal(view.totaal, 23);
  assert.deepEqual(view.rijen.map((r) => r.id), GUARDRAILKADER.map((g) => g.id));
});

check("kernregel §7.2 is groen in de view (FR-20 doorwerking)", () => {
  assert.equal(view.kernregelGroen, true);
  assert.ok(view.kernregelTekst.toLowerCase().includes("uitsluitend op modelgedrag"));
});

check("de bureau-promptvariant is bureau_stuk_v1", () => {
  assert.equal(BUREAU_PROMPTVARIANT, "bureau_stuk_v1");
  assert.equal(view.promptvariant, "bureau_stuk_v1");
});

check("geautomatiseerd + evalset telt op tot het totaal", () => {
  assert.equal(view.aantalGeautomatiseerd + view.aantalViaEvalset, view.totaal);
  // De zes M-leunende guardrails (G1,G3,G4,G8,G18,G19) → 'Aftekening via evalset'.
  assert.equal(view.aantalViaEvalset, 6);
});

check("borging-aard volgt de klasse van elke guardrail", () => {
  for (const g of GUARDRAILKADER) {
    const rij = bouwGuardrailkaderRij(g);
    const verwacht = g.klassen.includes("M") ? "Aftekening via evalset" : "Geautomatiseerd geborgd";
    assert.equal(rij.borging, verwacht, `${g.id}`);
  }
});

check("G2 is 'Alleen bureau', G23 is 'Bestaande rollen', G19 draagt een restrisico", () => {
  const g2 = view.rijen.find((r) => r.id === "G2")!;
  const g23 = view.rijen.find((r) => r.id === "G23")!;
  const g19 = view.rijen.find((r) => r.id === "G19")!;
  assert.equal(g2.rollenLabel, "Alleen bureau");
  assert.equal(g23.rollenLabel, "Bestaande rollen");
  assert.ok(g19.restrisico && g19.restrisico.includes("besluit 0131"));
});

check("G8 leest als 'Verboden voor bureau', niet als een voor-iedereen-verbod", () => {
  const g8 = view.rijen.find((r) => r.id === "G8")!;
  assert.equal(g8.rollenLabel, "Verboden voor bureau");
  // G4 is wél voor elke rol verboden en mag daar niet mee samenvallen.
  const g4 = view.rijen.find((r) => r.id === "G4")!;
  assert.equal(g4.rollenLabel, "Geen enkele rol");
});

check("elke rij heeft een niet-lege bewijs-verwijzing (herleidbaarheid)", () => {
  for (const r of view.rijen) {
    assert.ok(r.bewijs.trim().length > 0, `${r.id}: lege bewijs-verwijzing`);
  }
});

console.log(`\n${n} sanity-tests geslaagd.`);
