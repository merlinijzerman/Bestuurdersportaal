// ============================================================================
//  Sanity-tests voor de vergelijk-intentie + documentkoppeling (T5).
// ----------------------------------------------------------------------------
//  Borgt de confidence-gating (eenduidig → direct; twijfel → verduidelijking) en
//  het uitgewerkte voorbeeld uit de werkopdracht ("Vergelijk transitieplan v3 met v4").
//
//  Uitvoeren: npx tsx core/lib/vergelijk-intent.sanity.ts  (of npm run sanity)
// ============================================================================

import assert from "node:assert/strict";
import { bepaalVergelijkIntent, koppelDocumenten, type DocumentRef } from "./vergelijk-intent";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

// ── Intentie ─────────────────────────────────────────────────────────────────
test("uitgewerkt voorbeeld: 'Vergelijk transitieplan v3 met v4' → zeker, twee hints", () => {
  const i = bepaalVergelijkIntent("Vergelijk transitieplan v3 met v4");
  assert.equal(i.isVergelijk, true);
  assert.equal(i.vertrouwen, "zeker");
  assert.match(i.bronHint!, /transitieplan v3/i);
  assert.match(i.doelHint!, /v4/i);
});

test("'verschil tussen A en B' herkend met twee hints", () => {
  const i = bepaalVergelijkIntent("Wat is het verschil tussen het beleggingsplan en de ABTN?");
  assert.equal(i.isVergelijk, true);
  assert.equal(i.vertrouwen, "zeker");
  assert.match(i.bronHint!, /beleggingsplan/i);
  assert.match(i.doelHint!, /abtn/i);
});

test("'X vs Y' herkend", () => {
  const i = bepaalVergelijkIntent("transitieplan v3 vs v4");
  assert.equal(i.isVergelijk, true);
});

test("geen trigger → geen vergelijking", () => {
  assert.equal(bepaalVergelijkIntent("Wat is de dekkingsgraad van ons fonds?").isVergelijk, false);
  assert.equal(bepaalVergelijkIntent("").isVergelijk, false);
});

test("trigger zonder twee onderscheiden hints → onzeker (verduidelijking nodig)", () => {
  const i = bepaalVergelijkIntent("Kun je het transitieplan vergelijken?");
  assert.equal(i.isVergelijk, true);
  assert.equal(i.vertrouwen, "onzeker");
});

// ── Documentkoppeling ────────────────────────────────────────────────────────
const DOCS: DocumentRef[] = [
  { id: "d-v3", titel: "Transitieplan v3" },
  { id: "d-v4", titel: "Transitieplan v4" },
  { id: "d-abtn", titel: "ABTN 2026" },
];

test("eenduidige koppeling: v3 → d-v3, v4 → d-v4", () => {
  const k = koppelDocumenten("transitieplan v3", "v4", DOCS);
  assert.equal(k.eenduidig, true);
  assert.equal(k.bron?.id, "d-v3");
  assert.equal(k.doel?.id, "d-v4");
});

test("koppeling niet eenduidig wanneer een hint nergens op matcht", () => {
  const k = koppelDocumenten("indexatiememo", "v4", DOCS);
  assert.equal(k.eenduidig, false);
  assert.equal(k.bron, null); // geen match voor 'indexatiememo'
});

test("koppeling weigert bron==doel", () => {
  const k = koppelDocumenten("transitieplan", "transitieplan", DOCS);
  // Beide hints matchen beide v3/v4-titels even sterk → niet scherp/eenduidig.
  assert.equal(k.eenduidig, false);
});

test("versietoken onderscheidt: 'plan v4' kiest v4 boven v3", () => {
  const k = koppelDocumenten("transitieplan v4", "transitieplan v3", DOCS);
  assert.equal(k.bron?.id, "d-v4");
  assert.equal(k.doel?.id, "d-v3");
  assert.equal(k.eenduidig, true);
});

console.log(`\nvergelijk-intent.sanity: ${n} tests groen.`);
