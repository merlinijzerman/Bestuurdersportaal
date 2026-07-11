// lib/aqlab-audit-export.sanity.ts
// -----------------------------------------------------------------------------
// Sanity-checks op de PURE delen van de auditexport (AQL-4): de HTML-renderer
// (lib/aqlab/audit-html.ts) + de sha256-hashbepaling. Toetst determinisme
// (dezelfde view → dezelfde HTML → dezelfde hash), dat de disclaimer §4.4 in
// elke export staat, en dat een inhoudswijziging de hash verandert (verifieer-
// baarheid). De DB/Storage-orchestratie (genereer/verifieer) raakt I/O → smoke/handmatig.
// Run: npx tsx lib/aqlab-audit-export.sanity.ts   (of: npm run sanity)
// -----------------------------------------------------------------------------
import assert from "node:assert/strict";
import { renderAqlabAuditHtml, type AqlabAuditView } from "./aqlab/audit-html";
import { sha256 } from "./aqlab/seed/canonical";
import { DISCLAIMER_44 } from "./aqlab/assurance-teksten";

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function view(over: Partial<AqlabAuditView> = {}): AqlabAuditView {
  return {
    feature: { code: "bestuurlijke_samenvatting", naam: "Bestuurlijke samenvatting" },
    variant: { prompt_versie: "system_prompt v3", model_config: "Baseline (claude-x)" },
    run: { id: "run-1", run_type: "full_regression", gestart_op: "2026-07-08T10:00:00Z", voltooid_op: "2026-07-08T10:05:00Z" },
    testset: { code: "TS-BS", naam: "Golden set — bestuurlijke samenvatting", aantal_testgevallen: 8 },
    snapshot_hashes: ["a".repeat(64)],
    scores: [{ criterium: "brongebondenheid", methode: "deterministisch", score: 90, pass: true, motivatie: null, meetbeperking: null }],
    findings: [],
    human_reviews: [],
    regressie: { release_advies: "accepteren", samenvatting: null },
    besluit: {
      release_status: "vrijgegeven", besluit: "vrijgegeven", besluit_door_naam: "Governance Owner",
      besluit_op: "2026-07-08T11:00:00Z", motivatie: null, kritieke_bevindingen_count: 0, assurance_scope: "productbreed",
    },
    gegenereerd_op: "2026-07-08T11:05:00Z",
    gegenereerd_door_naam: "Operator",
    ...over,
  };
}

console.log("aqlab-audit-export sanity-tests:");

test("dezelfde view levert byte-identieke HTML (determinisme)", () => {
  assert.equal(renderAqlabAuditHtml(view()), renderAqlabAuditHtml(view()));
});

test("dezelfde view levert dezelfde sha256 (verifieerbaar)", () => {
  assert.equal(sha256(renderAqlabAuditHtml(view())), sha256(renderAqlabAuditHtml(view())));
});

test("de disclaimer §4.4 staat in elke export", () => {
  assert.ok(renderAqlabAuditHtml(view()).includes(DISCLAIMER_44));
});

test("een inhoudswijziging verandert de hash", () => {
  const h1 = sha256(renderAqlabAuditHtml(view()));
  const h2 = sha256(renderAqlabAuditHtml(view({ besluit: { ...view().besluit, kritieke_bevindingen_count: 1 } })));
  assert.notEqual(h1, h2);
});

test("de export embed de eigen hash NIET (hash niet over zichzelf)", () => {
  const html = renderAqlabAuditHtml(view());
  assert.ok(!html.includes(sha256(html)));
});

test("sha256 levert 64 hex-tekens", () => {
  assert.match(sha256(renderAqlabAuditHtml(view())), /^[0-9a-f]{64}$/);
});

test("vijandige veldwaarden worden ge-escaped (geen HTML-injectie)", () => {
  const kwaad = '<script>alert(1)</script>"><img src=x onerror=alert(2)>';
  const html = renderAqlabAuditHtml(view({
    besluit: { ...view().besluit, motivatie: kwaad, besluit_door_naam: kwaad },
    findings: [{ ernst: "kritiek", type: kwaad, omschrijving: kwaad, status: "open" }],
    human_reviews: [{ oordeel: "overruled", motivatie: kwaad, door: kwaad, op: "2026-07-08T10:00:00Z" }],
  }));
  // Geen enkele ONGE-escapete tag-opening uit de vijandige invoer mag overleven
  // (< en " zijn ge-escaped → attribuut-injectie onmogelijk). De letterlijke
  // tekst "onerror=" mag wél als inerte, ge-escapete inhoud voorkomen.
  assert.ok(!html.includes("<script>"), "ongesanitiseerde <script> in export");
  assert.ok(!html.includes("<img"), "ongesanitiseerde <img-tag in export");
  assert.ok(html.includes("&lt;script&gt;"), "escaping ontbreekt");
});

console.log(`\n${n} sanity-tests geslaagd.`);
