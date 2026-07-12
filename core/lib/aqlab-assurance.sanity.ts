// lib/aqlab-assurance.sanity.ts
// -----------------------------------------------------------------------------
// Sanity-checks op de PURE assurance-kern (lib/aqlab/assurance-core.ts, AQL-4):
// de feature↔module-mapping, de indicator-drempels, de statustaal, en — cruciaal
// voor de tenant-isolatie — dat het view-model UITSLUITEND aggregaten bevat en
// de vaste "wat wel/niet"-uitleg + disclaimer draagt (geen ruwe output/prompt).
// Run: npx tsx lib/aqlab-assurance.sanity.ts   (of: npm run sanity)
// -----------------------------------------------------------------------------
import assert from "node:assert/strict";
import type { ModuleKey } from "./module-registry";
import {
  bepaalGebruikteFeatures,
  bouwAssuranceTegel,
  bouwAssuranceView,
  fondsStatusLabel,
  indicatorVan,
  regressieLabel,
  type AssuranceMeetwaarden,
} from "./aqlab/assurance-core";
import { AI_ONDERSTEUNEND, DISCLAIMER_44, WAT_NIET, WAT_WEL, WAT_WEL_NIET_VRIJGEGEVEN } from "./aqlab/assurance-teksten";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function meet(over: Partial<AssuranceMeetwaarden> = {}): AssuranceMeetwaarden {
  // Spread `over` LAATST zodat een expliciete null (bv. brongebondenheid_ratio:null)
  // de default overschrijft — geen ?? -val dat null stilletjes terugzet.
  return {
    feature_code: "brongebonden_vraagbeantwoording",
    release_status: "vrijgegeven",
    laatste_controle: "2026-07-08",
    aantal_functioneel: 24,
    aantal_blokkerend: 6,
    kritieke_bevindingen: 0,
    openstaande_review: 0,
    brongebondenheid_ratio: 0.9,
    format_compliance_ratio: 1,
    regressie_status: "gelijk",
    audit_export_id: "exp-1",
    inhoud_hash: "b".repeat(64),
    ...over,
  };
}

console.log("aqlab-assurance sanity-tests:");

// ── Feature↔module-mapping ─────────────────────────────────────────────────
test("alle modules aan → alle 3 features zichtbaar", () => {
  const alle = new Set<ModuleKey>(["ai", "notulen", "procedures"]);
  const codes = bepaalGebruikteFeatures(alle);
  assert.deepEqual(new Set(codes), new Set(["brongebonden_vraagbeantwoording", "bestuurlijke_samenvatting", "besluitvoorbereiding"]));
});

test("procedures uit → besluitvoorbereiding verdwijnt", () => {
  const codes = bepaalGebruikteFeatures(new Set<ModuleKey>(["ai", "notulen"]));
  assert.ok(!codes.includes("besluitvoorbereiding"));
  assert.ok(codes.includes("brongebonden_vraagbeantwoording"));
});

test("geen relevante modules → geen features", () => {
  assert.deepEqual(bepaalGebruikteFeatures(new Set<ModuleKey>(["home", "beheer"])), []);
});

// ── Indicator-drempels + labels ────────────────────────────────────────────
test("indicatorVan volgt de drempels", () => {
  assert.equal(indicatorVan(0.9), "Hoog");
  assert.equal(indicatorVan(0.6), "Midden");
  assert.equal(indicatorVan(0.3), "Laag");
  assert.equal(indicatorVan(null), "Onbekend");
});

test("fondsStatusLabel gebruikt bewuste 'vrijgegeven voor gebruik'-taal", () => {
  assert.equal(fondsStatusLabel("vrijgegeven"), "Vrijgegeven voor gebruik");
  assert.equal(fondsStatusLabel("review_vereist"), "Review vereist");
  assert.equal(fondsStatusLabel(null), "Niet vrijgegeven");
  assert.equal(fondsStatusLabel("geblokkeerd"), "Niet vrijgegeven");
});

test("regressieLabel vertaalt naar bestuurlijke taal", () => {
  assert.equal(regressieLabel("verbeterd"), "Verbeterd");
  assert.equal(regressieLabel("regressie"), "Aandachtspunt");
  assert.equal(regressieLabel(null), "Onbekend");
});

// ── Tegel bevat UITSLUITEND aggregaten + vaste uitleg (tenant-isolatie) ─────
const RUWE_VELDEN = [
  "gegenereerd_antwoord", "antwoord", "output", "prompt", "system_prompt",
  "gebruikte_context", "context", "testcase", "test_case", "inputvraag", "fonds",
];

test("AssuranceTegel bevat geen ruwe-output/prompt/context-velden", () => {
  const tegel = bouwAssuranceTegel(meet());
  const keys = Object.keys(tegel);
  for (const verboden of RUWE_VELDEN) {
    assert.ok(!keys.includes(verboden), `tegel lekt veld '${verboden}'`);
  }
});

test("tegel draagt de vaste wat-wel/wat-niet-uitleg + footer", () => {
  const tegel = bouwAssuranceTegel(meet());
  assert.equal(tegel.wat_wel, WAT_WEL);
  assert.equal(tegel.wat_niet, WAT_NIET);
  assert.equal(tegel.footer, AI_ONDERSTEUNEND);
  assert.equal(tegel.type_controle, "Productbrede controle");
});

test("positieve 'wat wel'-tekst ALLEEN bij vrijgegeven (geen schijnzekerheid)", () => {
  assert.equal(bouwAssuranceTegel(meet({ release_status: "vrijgegeven" })).wat_wel, WAT_WEL);
  assert.equal(bouwAssuranceTegel(meet({ release_status: "review_vereist" })).wat_wel, WAT_WEL_NIET_VRIJGEGEVEN);
  assert.equal(bouwAssuranceTegel(meet({ release_status: null })).wat_wel, WAT_WEL_NIET_VRIJGEGEVEN);
  assert.equal(bouwAssuranceTegel(meet({ release_status: "geblokkeerd" })).wat_wel, WAT_WEL_NIET_VRIJGEGEVEN);
});

test("tegel-aggregaten kloppen (aantallen, indicator, status)", () => {
  const tegel = bouwAssuranceTegel(meet({ openstaande_review: 2, kritieke_bevindingen: 0 }));
  assert.equal(tegel.aantal_testgevallen, "24 functioneel + 6 blokkerend");
  assert.equal(tegel.status_label, "Vrijgegeven voor gebruik");
  assert.equal(tegel.brongebondenheid, "Hoog");
  assert.equal(tegel.format_compliance, "Voldoet");
  assert.equal(tegel.openstaande_review, "2");
});

test("bouwAssuranceView levert banner + disclaimer + tegels", () => {
  const v = bouwAssuranceView([meet(), meet({ feature_code: "besluitvoorbereiding" })]);
  assert.ok(v.scope_banner.includes("productbrede controle"));
  assert.equal(v.disclaimer, DISCLAIMER_44);
  assert.equal(v.tegels.length, 2);
});

test("onbekende meetwaarden → eerlijke 'Onbekend' (geen schijnzekerheid)", () => {
  const tegel = bouwAssuranceTegel(meet({
    brongebondenheid_ratio: null, format_compliance_ratio: null,
    aantal_functioneel: null, aantal_blokkerend: null, regressie_status: null,
  }));
  assert.equal(tegel.brongebondenheid, "Onbekend");
  assert.equal(tegel.format_compliance, "Onbekend");
  assert.equal(tegel.aantal_testgevallen, "Onbekend");
  assert.equal(tegel.regressie, "Onbekend");
});

console.log(`\n${n} sanity-tests geslaagd.`);
