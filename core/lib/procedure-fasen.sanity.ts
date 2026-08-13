// ============================================================
//  Sanity-tests voor core/lib/procedure-fasen.ts (D8).
//
//  Kernbewijs: de fasebeschrijving valt fail-safe terug op de generieke
//  default wanneer een fonds geen override heeft; een niet-lege override
//  wint; een lege/whitespace-override telt niet (fallback). Dit is de
//  fallback-helft van de §8 fonds-override-test (de RLS-isolatiehelft
//  loopt via tests/cross-tenant, DB-laag).
// ============================================================

import assert from "node:assert/strict";
import { mergeFasen, type FaseDefault } from "./procedure-fasen";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const defaults: FaseDefault[] = [
  { fase_code: "I", volgorde: 1, titel: "Kaders", generieke_beschrijving: "Default I" },
  { fase_code: "II", volgorde: 2, titel: "Onderbouwing", generieke_beschrijving: "Default II" },
  { fase_code: "III", volgorde: 3, titel: "Besluitvorming", generieke_beschrijving: null },
];

check("zonder override → generieke default", () => {
  const r = mergeFasen(defaults, []);
  assert.equal(r.length, 3);
  assert.equal(r[0].beschrijving, "Default I");
  assert.equal(r[0].is_override, false);
});

check("override wint van default", () => {
  const r = mergeFasen(defaults, [{ fase_code: "I", beschrijving: "SPH-variant I" }]);
  const fase1 = r.find((f) => f.fase_code === "I")!;
  assert.equal(fase1.beschrijving, "SPH-variant I");
  assert.equal(fase1.is_override, true);
  // andere fasen ongewijzigd
  assert.equal(r.find((f) => f.fase_code === "II")!.beschrijving, "Default II");
});

check("lege/whitespace override telt niet (fallback naar default)", () => {
  const r = mergeFasen(defaults, [{ fase_code: "I", beschrijving: "   " }]);
  const fase1 = r.find((f) => f.fase_code === "I")!;
  assert.equal(fase1.beschrijving, "Default I");
  assert.equal(fase1.is_override, false);
});

check("null default zonder override → null beschrijving", () => {
  const r = mergeFasen(defaults, []);
  assert.equal(r.find((f) => f.fase_code === "III")!.beschrijving, null);
});

check("resultaat is gesorteerd op volgorde", () => {
  const geschud: FaseDefault[] = [defaults[2], defaults[0], defaults[1]];
  const r = mergeFasen(geschud, []);
  assert.deepEqual(r.map((f) => f.volgorde), [1, 2, 3]);
});

console.log(`\nprocedure-fasen.sanity: ${n} checks groen.`);
