// ============================================================================
//  Sanity-tests voor lib/web-retrieval.ts (Scenario A, besluit 0072).
//  Dekt: content-blok-parsing (bevraagd/geciteerd/fout), herverificatie tegen de
//  whitelist (AC-1/AC-5/AC-6/AC-7) en weging op normgewicht (AC-4).
//
//  Uitvoeren: npx tsx lib/web-retrieval.sanity.ts
// ============================================================================

import assert from "node:assert/strict";
import {
  buildWebSearchTool,
  extractWebResultaten,
  bouwWebbronnen,
  bevraagdeDomeinen,
  beoordeelWebGate,
  WEB_SEARCH_TOOL_TYPE,
} from "./web-retrieval";
import type { WhitelistEntry } from "./web-whitelist";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const WL: WhitelistEntry[] = [
  { id: "1", domein: "dnb.nl", matchtype: "domein_subdomeinen", pad: null, normgewicht: "bindend", categorie: null, tier: "1", status: "actief", toelichting: "t" },
  { id: "2", domein: "pensioenfederatie.nl", matchtype: "domein_subdomeinen", pad: null, normgewicht: "sector_guidance", categorie: null, tier: "3", status: "actief", toelichting: "t" },
  { id: "3", domein: "afm.nl", matchtype: "domein", pad: null, normgewicht: "bindend", categorie: null, tier: "1", status: "inactief", toelichting: "t" },
];

console.log("web-retrieval sanity-tests:");

test("buildWebSearchTool: juiste type + allowed_domains + max_uses", () => {
  const tool = buildWebSearchTool(["dnb.nl", "afm.nl"], 3);
  assert.equal(tool.type, WEB_SEARCH_TOOL_TYPE);
  assert.equal(tool.name, "web_search");
  assert.deepEqual(tool.allowed_domains, ["dnb.nl", "afm.nl"]);
  assert.equal(tool.max_uses, 3);
});

test("extractWebResultaten leest geciteerde + bevraagde bronnen", () => {
  const content = [
    { type: "web_search_tool_result", content: [
      { type: "web_search_result", url: "https://www.dnb.nl/a", title: "DNB A", page_age: "2026-01-01" },
      { type: "web_search_result", url: "https://pensioenfederatie.nl/b", title: "PF B", page_age: null },
    ] },
    { type: "text", text: "Volgens DNB…", citations: [
      { type: "web_search_result_location", url: "https://www.dnb.nl/a", title: "DNB A" },
    ] },
  ];
  const r = extractWebResultaten(content);
  assert.equal(r.bevraagd.length, 2);
  assert.equal(r.geciteerd.length, 1);
  assert.equal(r.foutcode, null);
});

test("AC-7: web_search-fout levert foutcode, geen bronnen", () => {
  const content = [
    { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
  ];
  const r = extractWebResultaten(content);
  assert.equal(r.foutcode, "max_uses_exceeded");
  assert.equal(r.geciteerd.length, 0);
});

test("misvormde/lege content breekt niet", () => {
  assert.deepEqual(extractWebResultaten(null).geciteerd, []);
  assert.deepEqual(extractWebResultaten("geen array").bevraagd, []);
  assert.deepEqual(extractWebResultaten([{ type: "text", text: "x" }]).geciteerd, []);
});

test("bouwWebbronnen herverifieert, koppelt normgewicht + ophaaldatum, dedup", () => {
  const geciteerd = [
    { url: "https://toezicht.dnb.nl/x", titel: "DNB toezicht", paginaDatum: null },
    { url: "https://toezicht.dnb.nl/x", titel: "DNB toezicht", paginaDatum: null }, // dubbel
    { url: "https://pensioenfederatie.nl/y", titel: "PF", paginaDatum: null },
  ];
  const bronnen = bouwWebbronnen(geciteerd, WL, "2026-07-15T10:00:00.000Z");
  assert.equal(bronnen.length, 2);
  // AC-4: bindend (dnb) vóór sector_guidance (pf).
  assert.equal(bronnen[0].domein, "toezicht.dnb.nl");
  assert.equal(bronnen[0].normgewicht, "bindend");
  assert.equal(bronnen[0].ophaaldatum, "2026-07-15T10:00:00.000Z");
  assert.equal(bronnen[1].normgewicht, "sector_guidance");
});

test("AC-1/AC-5: citaat buiten whitelist valt af (geen fabricage)", () => {
  const geciteerd = [
    { url: "https://kwaadaardig.example/nep", titel: "Nep", paginaDatum: null },
    { url: "https://afm.nl/z", titel: "AFM", paginaDatum: null }, // entry inactief → geen match
  ];
  const bronnen = bouwWebbronnen(geciteerd, WL, "2026-07-15T10:00:00.000Z");
  assert.equal(bronnen.length, 0);
});

test("bevraagdeDomeinen normaliseert en dedupliceert", () => {
  const d = bevraagdeDomeinen([
    { url: "https://www.dnb.nl/a", titel: null, paginaDatum: null },
    { url: "https://toezicht.dnb.nl/b", titel: null, paginaDatum: null },
    { url: "https://www.dnb.nl/c", titel: null, paginaDatum: null },
  ]).sort();
  assert.deepEqual(d, ["dnb.nl", "toezicht.dnb.nl"]);
});

// ── Gating (FR-1/FR-4/FR-9) ─────────────────────────────────
const basis = {
  vlagAan: true,
  aantalActieveEntries: 5,
  scopeActief: false,
  bronsoortprofiel: "generiek" as const,
  bevatPii: false,
};

test("gate: extern signaal + vlag aan + whitelist + geen pii → mag", () => {
  assert.deepEqual(beoordeelWebGate(basis), { mag: true, reden: "ok" });
});

test("gate: vlag uit → geen web", () => {
  assert.equal(beoordeelWebGate({ ...basis, vlagAan: false }).reden, "vlag_uit");
});

test("gate: geen actieve whitelist → geen web", () => {
  assert.equal(beoordeelWebGate({ ...basis, aantalActieveEntries: 0 }).reden, "geen_whitelist");
});

test("gate: scope actief → geen web", () => {
  assert.equal(beoordeelWebGate({ ...basis, scopeActief: true }).reden, "scope_actief");
});

test("gate: pure fondsvraag (geen extern signaal) → geen web", () => {
  assert.equal(beoordeelWebGate({ ...basis, bronsoortprofiel: "fonds" }).reden, "geen_extern_signaal");
});

test("AC-10: pii in de vraag → web geblokkeerd", () => {
  assert.equal(beoordeelWebGate({ ...basis, bevatPii: true }).reden, "pii_geblokkeerd");
});

console.log(`\n${n} web-retrieval sanity-tests geslaagd.`);
