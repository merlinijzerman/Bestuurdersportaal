// ============================================================
//  Sanity-tests voor de rapportage-retire (werkopdracht 2.5).
//
//  Wat hier bevroren wordt:
//   • Retire geldt ALLEEN bij het aanleveren van een rapportage.
//   • Alleen een rapportage-voorganger kan worden afgevoerd.
//   • De voorganger moet vanuit zijn status naar `historisch` mogen
//     (vastgesteld/van_kracht → historisch; concept niet).
//   • De redenplicht komt uit de transitietabel (historisch = redenplicht).
//
//  Geen testframework in de repo; standalone met assert.
//  Uitvoeren: npx tsx core/lib/document-rapportage-retire.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import {
  beoordeelRapportageRetire,
  isActueleRapportageVoorganger,
} from "./document-rapportage-retire";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

console.log("document-rapportage-retire sanity-tests:");

test("een vastgestelde rapportage-voorganger mag naar historisch (met reden)", () => {
  const r = beoordeelRapportageRetire({
    nieuwDocumenttype: "rapportage",
    voorgangerDocumenttype: "rapportage",
    voorgangerStatus: "vastgesteld",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.naar, "historisch");
    assert.equal(r.redenVerplicht, true); // vastgesteld → historisch vraagt reden
  }
});

test("een van_kracht rapportage-voorganger mag óók naar historisch", () => {
  const r = beoordeelRapportageRetire({
    nieuwDocumenttype: "rapportage",
    voorgangerDocumenttype: "rapportage",
    voorgangerStatus: "van_kracht",
  });
  assert.equal(r.ok, true);
});

test("retire kan NIET als het nieuwe stuk geen rapportage is", () => {
  const r = beoordeelRapportageRetire({
    nieuwDocumenttype: "beleid",
    voorgangerDocumenttype: "rapportage",
    voorgangerStatus: "vastgesteld",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "geen_rapportage_upload");
});

test("een voorganger die geen rapportage is, kan niet worden afgevoerd", () => {
  const r = beoordeelRapportageRetire({
    nieuwDocumenttype: "rapportage",
    voorgangerDocumenttype: "beleid",
    voorgangerStatus: "van_kracht",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "voorganger_geen_rapportage");
});

test("een voorganger op concept is niet afvoerbaar naar historisch", () => {
  const r = beoordeelRapportageRetire({
    nieuwDocumenttype: "rapportage",
    voorgangerDocumenttype: "rapportage",
    voorgangerStatus: "concept",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.foutcode, "voorganger_niet_afvoerbaar");
});

test("een voorganger zonder status is niet afvoerbaar", () => {
  const r = beoordeelRapportageRetire({
    nieuwDocumenttype: "rapportage",
    voorgangerDocumenttype: "rapportage",
    voorgangerStatus: null,
  });
  assert.equal(r.ok, false);
});

test("isActueleRapportageVoorganger: alleen vastgesteld/van_kracht", () => {
  assert.equal(isActueleRapportageVoorganger("vastgesteld"), true);
  assert.equal(isActueleRapportageVoorganger("van_kracht"), true);
  assert.equal(isActueleRapportageVoorganger("concept"), false);
  assert.equal(isActueleRapportageVoorganger("historisch"), false);
  assert.equal(isActueleRapportageVoorganger("gearchiveerd"), false);
  assert.equal(isActueleRapportageVoorganger(null), false);
});

console.log(`\n${n} sanity-tests geslaagd.\n`);
