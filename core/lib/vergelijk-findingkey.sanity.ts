// ============================================================================
//  Sanity-tests voor de canonieke bevindingssleutel (T5 ↔ T10).
// ----------------------------------------------------------------------------
//  Pint het finding_key-CONTRACT op sha256-vectoren. Kantelt een van deze waarden,
//  dan is het sleutelformaat gewijzigd — en breekt de koppeling tussen bestaande
//  comparison_results (T5) en difference_judgements (T10). Alleen bewust bijwerken.
//
//  Uitvoeren: npx tsx core/lib/vergelijk-findingkey.sanity.ts  (of npm run sanity)
// ============================================================================

import assert from "node:assert/strict";
import { mintFindingKey } from "./vergelijk-findingkey";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// Gepinde vectoren (berekend uit de canonieke NUL-gescheiden string).
const FK_CONCEPT = "fk_8cae7d5da3e40323b7d26c7652dfa6c8768f880c077a43109554ef715035d04e";
const FK_DIMENSIE = "fk_d0b84e108d45764a1bcd57c2f615cda03efda03d7051712068385b3821e6a70e";
const FK_SWAPPED = "fk_1a3d8d1f0e030c6df20ff41beded0e2d4312e400ace8c44cfa825ff141acbb15";

test("concept-pad: gepinde vector stabiel", () => {
  assert.equal(
    mintFindingKey({
      mode: "symmetrisch",
      bronDocumentId: "doc-v3",
      doelDocumentId: "doc-v4",
      conceptId: "c-boven",
      dimensie: "solidariteitsreserve.bovengrens",
    }),
    FK_CONCEPT
  );
});

test("dimensie-pad (geen concept): gepinde vector stabiel", () => {
  assert.equal(
    mintFindingKey({
      mode: "symmetrisch",
      bronDocumentId: "doc-v3",
      doelDocumentId: "doc-v4",
      dimensie: "solidariteitsreserve.bovengrens",
    }),
    FK_DIMENSIE
  );
});

test("concept_id verandert de sleutel t.o.v. het pure dimensie-pad", () => {
  assert.notEqual(FK_CONCEPT, FK_DIMENSIE);
});

test("determinisme: dezelfde input → dezelfde sleutel", () => {
  const a = mintFindingKey({ mode: "symmetrisch", bronDocumentId: "x", doelDocumentId: "y", dimensie: "d" });
  const b = mintFindingKey({ mode: "symmetrisch", bronDocumentId: "x", doelDocumentId: "y", dimensie: "d" });
  assert.equal(a, b);
});

test("richtinggevoelig: bron/doel omdraaien geeft een andere sleutel", () => {
  const heen = mintFindingKey({
    mode: "symmetrisch", bronDocumentId: "doc-v3", doelDocumentId: "doc-v4", conceptId: "c-boven", dimensie: "x",
  });
  const terug = mintFindingKey({
    mode: "symmetrisch", bronDocumentId: "doc-v4", doelDocumentId: "doc-v3", conceptId: "c-boven", dimensie: "x",
  });
  assert.equal(terug, FK_SWAPPED);
  assert.notEqual(heen, terug);
});

test("normalisatie: hoofdletters/spaties in de dimensie collapsen naar dezelfde sleutel", () => {
  const genormaliseerd = mintFindingKey({
    mode: "symmetrisch", bronDocumentId: "doc-v3", doelDocumentId: "doc-v4",
    dimensie: "  Solidariteitsreserve.Bovengrens  ",
  });
  assert.equal(genormaliseerd, FK_DIMENSIE);
});

test("lege conceptId valt terug op het dimensie-pad", () => {
  const leeg = mintFindingKey({
    mode: "symmetrisch", bronDocumentId: "doc-v3", doelDocumentId: "doc-v4",
    conceptId: "", dimensie: "solidariteitsreserve.bovengrens",
  });
  assert.equal(leeg, FK_DIMENSIE);
});

test("ontbrekend verplicht veld gooit (fail-fast)", () => {
  assert.throws(() =>
    mintFindingKey({ mode: "symmetrisch", bronDocumentId: "", doelDocumentId: "y", dimensie: "d" })
  );
  assert.throws(() =>
    mintFindingKey({ mode: "symmetrisch", bronDocumentId: "x", doelDocumentId: "y", dimensie: "" })
  );
});

console.log(`\nvergelijk-findingkey.sanity: ${n} tests groen.`);
