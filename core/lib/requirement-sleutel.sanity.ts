// ============================================================
//  Sanity-tests voor core/lib/requirement-sleutel.ts.
//
//  De sleutel is het scharnier van de bewijs↔vereiste-binding: hij wordt in
//  TS gebouwd (decision.ts, de bewijs-API, StapPaneel) en in SQL nagemaakt
//  (fn_decision_readiness_check). Loopt de vorm uiteen, dan vervult een
//  bewijsstuk in de weergave iets anders dan in de gate. Deze checks pinnen
//  de vorm.
// ============================================================

import assert from "node:assert/strict";
import {
  requirementIdentiteit,
  requirementSleutel,
} from "./requirement-sleutel";

let n = 0;
function check(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

check("identiteit = documenttype als die er is", () => {
  assert.equal(requirementIdentiteit("alm_analyse", "ALM-analyse"), "alm_analyse");
});

check("identiteit valt terug op het label", () => {
  assert.equal(requirementIdentiteit(null, "Transitieplan"), "Transitieplan");
  assert.equal(requirementIdentiteit(undefined, "Transitieplan"), "Transitieplan");
});

check("sleutelvorm is stap|type|identiteit", () => {
  assert.equal(
    requirementSleutel(1, "document", null, "Transitieplan"),
    "1|document|Transitieplan"
  );
  assert.equal(
    requirementSleutel(9, "external_submission", "dnb_indiening", "DNB-indiening"),
    "9|external_submission|dnb_indiening"
  );
});

check("ongetagde vereisten op één stap krijgen verschillende sleutels", () => {
  // Precies de situatie uit de invaarseed v2: drie document-vereisten op stap
  // 1, alle documenttype = null. Vóór de binding matchte één bewijsstuk ze
  // alle drie; nu onderscheidt het label ze.
  const sleutels = [
    "Transitieplan",
    "Formeel invaarverzoek",
    "(Gewijzigde) pensioenovereenkomst/-regeling en compensatieafspraken",
  ].map((label) => requirementSleutel(1, "document", null, label));
  assert.equal(new Set(sleutels).size, 3);
});

check("geen normalisatie: hoofdletters en spaties blijven staan", () => {
  // De SQL-tegenhanger doet coalesce(documenttype, label) zonder trim of
  // lower. Zou TS wél normaliseren, dan zou de weergave iets vervuld noemen
  // wat de gate niet vindt.
  assert.equal(
    requirementSleutel(2, "document", null, " Verslag "),
    "2|document| Verslag "
  );
  assert.notEqual(
    requirementSleutel(2, "document", null, "Verslag"),
    requirementSleutel(2, "document", null, "verslag")
  );
});

check("type maakt deel uit van de sleutel", () => {
  assert.notEqual(
    requirementSleutel(8, "document", null, "Hoorrecht"),
    requirementSleutel(8, "consultation", null, "Hoorrecht")
  );
});

console.log(`\nrequirement-sleutel.sanity: ${n} checks groen.`);
