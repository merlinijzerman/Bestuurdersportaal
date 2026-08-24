// ============================================================
//  Generieke sanity-test D10 (P2, #167) — vervulling positief én gebonden.
//
//  Toetst voor ÁLLE requirement-typen dat een vereiste niet vervuld is zonder een
//  gebonden feit, en dat een nieuw type dit niet stilzwijgend kan omzeilen: elk type
//  moet in REQUIREMENT_BRON een brontabel declareren, of expliciet de field-
//  uitzondering zijn. Voeg je een type toe zonder bron, dan faalt óf de typecheck
//  (Record<RequirementType,…>) óf deze test.
//
//  Geen testframework; standalone. Uitvoeren: npx tsx core/lib/vervulling.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { ALLE_REQUIREMENT_TYPES, REQUIREMENT_BRON } from "./requirement-bron";
import { vervuldViaBinding } from "./vervulling";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

test("elk type declareert een bron; alleen `field` is de uitzondering", () => {
  for (const t of ALLE_REQUIREMENT_TYPES) {
    const bron = REQUIREMENT_BRON[t];
    if (t === "field") {
      assert.equal(bron, null, "`field` hoort de gemotiveerde uitzondering (null) te zijn");
    } else {
      assert.ok(
        bron !== null,
        `type "${t}" moet een brontabel declareren — positief én gebonden, geen stilzwijgende uitzondering`
      );
      assert.ok(bron.brontabel.length > 0 && bron.scopeKolom.length > 0);
    }
  }
});

test("geen gebonden type is vervuld zonder gebonden feit", () => {
  for (const t of ALLE_REQUIREMENT_TYPES) {
    if (t === "field") continue;
    assert.equal(
      vervuldViaBinding(t, 0, 1),
      false,
      `"${t}": vervuld zonder gebonden feit — precies de fout die D10 wegneemt`
    );
  }
});

test("min_aantal wordt gehonoreerd (1 en >1)", () => {
  for (const t of ALLE_REQUIREMENT_TYPES) {
    if (t === "field") continue;
    assert.equal(vervuldViaBinding(t, 1, 1), true, `"${t}": één feit vervult min_aantal 1`);
    assert.equal(vervuldViaBinding(t, 1, 2), false, `"${t}": min_aantal 2 niet gehaald met 1 feit`);
    assert.equal(vervuldViaBinding(t, 2, 2), true, `"${t}": min_aantal 2 gehaald met 2 feiten`);
    assert.equal(vervuldViaBinding(t, 5, 2), true, `"${t}": oververvulling is toegestaan`);
    assert.equal(vervuldViaBinding(t, 1, null), true, `"${t}": null min_aantal telt als 1`);
  }
});

test("`field` wordt nooit via een gebonden feit vervuld verklaard", () => {
  assert.equal(vervuldViaBinding("field", 5, 1), false);
});

console.log(`\nvervulling.sanity: ${n} generieke checks groen (${ALLE_REQUIREMENT_TYPES.length} typen).`);
