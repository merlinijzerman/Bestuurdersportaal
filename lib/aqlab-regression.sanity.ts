// lib/aqlab-regression.sanity.ts
// -----------------------------------------------------------------------------
// Sanity-checks op de pure regressie-adviesberekening (lib/aqlab/regression.ts).
// Toetst de deterministische delta-status én de release-adviesregels incl. de
// ADR 0056-consistentiedoorwerking. De DB-orchestratie (berekenRegressie) is
// geen pure functie en wordt via smoke/handmatig getest.
// Run: npx tsx lib/aqlab-regression.sanity.ts   (of: npm run sanity)
// -----------------------------------------------------------------------------
import assert from 'node:assert/strict';
import {
  bepaalRegressieStatus,
  berekenReleaseAdvies,
  gateErnst,
  type TestcaseUitkomst,
} from './aqlab/regression-core';
import type { ConsistentieAggregaat } from './aqlab/consistency';

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

function tc(over: Partial<TestcaseUitkomst> = {}): TestcaseUitkomst {
  return {
    test_case_id: over.test_case_id ?? 'tc-1',
    code: over.code ?? 'BS-01',
    soort: over.soort ?? 'functioneel',
    review_verplicht: over.review_verplicht ?? false,
    consistency_required: over.consistency_required ?? false,
    quality_score: over.quality_score ?? 90,
    gate_status: over.gate_status ?? 'pass',
    kritiekeBlokkade: over.kritiekeBlokkade ?? false,
    consistency: over.consistency ?? null,
    effectiefVolledig: over.effectiefVolledig ?? true,
  };
}

function consistency(over: Partial<ConsistentieAggregaat>): ConsistentieAggregaat {
  return {
    consistency_required: true,
    consistency_iterations: 3,
    passed: 3,
    total: 3,
    consistency_score: 100,
    gate_stability: true,
    fact_stability: true,
    source_stability: true,
    format_stability: true,
    score_spread: 0,
    score_min: 90,
    score_max: 90,
    score_gemiddeld: 90,
    gate_pass_rate: 1,
    fact_correctness_rate: 1,
    source_correctness_rate: 1,
    format_pass_rate: 1,
    retrieval_stability: true,
    source_stability_exact: true,
    correctheid_gemeten: true,
    volledig_gedraaid: true,
    consistency_status: 'consistent',
    release_eligible: true,
    consistency_findings: [],
    meetlabels: { deterministisch: [], judge: [], mens: [] },
    ...over,
  };
}

// ── gateErnst / delta-status ────────────────────────────────────────────────
test('gateErnst ordent geblokkeerd > review_vereist > pass', () => {
  assert.ok(gateErnst('geblokkeerd') > gateErnst('review_vereist'));
  assert.ok(gateErnst('review_vereist') > gateErnst('pass'));
});

test('challenger geblokkeerd terwijl baseline pass → nieuwe_blokkade', () => {
  assert.equal(bepaalRegressieStatus(tc({ gate_status: 'pass' }), tc({ gate_status: 'geblokkeerd' })), 'nieuwe_blokkade');
});

test('score-daling ≥ drempel → regressie; stijging → verbeterd; klein → gelijk', () => {
  assert.equal(bepaalRegressieStatus(tc({ quality_score: 90 }), tc({ quality_score: 80 })), 'regressie');
  assert.equal(bepaalRegressieStatus(tc({ quality_score: 80 }), tc({ quality_score: 90 })), 'verbeterd');
  assert.equal(bepaalRegressieStatus(tc({ quality_score: 90 }), tc({ quality_score: 88 })), 'gelijk');
});

// ── release-advies ──────────────────────────────────────────────────────────
function advies(challenger: TestcaseUitkomst[], opts: { run_type?: string; baseline?: TestcaseUitkomst[]; bevatBlockingSet?: boolean } = {}) {
  const baselinePer = new Map<string, TestcaseUitkomst>();
  for (const b of opts.baseline ?? challenger.map((c) => tc({ ...c, quality_score: c.quality_score, gate_status: 'pass', kritiekeBlokkade: false }))) {
    baselinePer.set(b.test_case_id, b);
  }
  return berekenReleaseAdvies({
    run_type: opts.run_type ?? 'full_regression',
    challenger,
    baselinePer,
    bevatBlockingSet: opts.bevatBlockingSet ?? true,
  });
}

test('schone full_regression zonder regressie → accepteren (voorstel)', () => {
  const r = advies([tc()], { baseline: [tc()] });
  assert.equal(r.advies, 'accepteren');
  assert.equal(r.formeel, true);
});

test('open kritieke blokkade → blokkeren; accepteren onmogelijk', () => {
  const r = advies([tc({ gate_status: 'geblokkeerd', kritiekeBlokkade: true })]);
  assert.equal(r.advies, 'blokkeren');
});

test('niet-gehaalde security_blocking-case → blokkeren', () => {
  const r = advies([tc({ soort: 'security_blocking', gate_status: 'review_vereist' })]);
  assert.equal(r.advies, 'blokkeren');
});

test('cijfer-inconsistentie (fact_stability false, required) → blokkeren', () => {
  const r = advies([tc({ consistency_required: true, consistency: consistency({ fact_stability: false, consistency_status: 'unstable', release_eligible: false }) })]);
  assert.equal(r.advies, 'blokkeren');
});

test('bronkeuze-inconsistentie (source_stability false) → minstens aanpassen', () => {
  const r = advies([tc({ consistency_required: true, consistency: consistency({ source_stability: false, consistency_status: 'unstable', release_eligible: false }) })]);
  assert.ok(r.advies === 'aanpassen' || r.advies === 'blokkeren');
});

test('consistent_but_incorrect (required) → blokkeren', () => {
  const r = advies([tc({ consistency_required: true, consistency: consistency({ fact_correctness_rate: 0, consistency_status: 'consistent_but_incorrect', release_eligible: false }) })]);
  assert.equal(r.advies, 'blokkeren');
});

test('consistent_but_incorrect blokkeert OOK als consistency_required=false (geen schijnzekerheid)', () => {
  // Regressie-guard voor review-finding 1: aggregaat bestaat maar de testcase is
  // niet als consistency_required gemarkeerd → mag NIET als accepteren passeren.
  const r = advies([tc({ consistency_required: false, consistency: consistency({ consistency_required: false, fact_correctness_rate: 0, consistency_status: 'consistent_but_incorrect', release_eligible: false }) })]);
  assert.equal(r.advies, 'blokkeren');
});

test('metadata_only: bron-set niet vergeleken (source_stability_exact=false) → geen accepteren', () => {
  const r = advies([tc({ consistency: consistency({ source_stability_exact: false }) })]);
  assert.ok(r.advies === 'aanpassen' || r.advies === 'blokkeren');
});

test('score-regressie t.o.v. baseline → aanpassen', () => {
  const r = advies([tc({ quality_score: 70 })], { baseline: [tc({ quality_score: 90 })] });
  assert.equal(r.advies, 'aanpassen');
});

test('subset zonder blocking-set → nooit accepteren (aanpassen)', () => {
  const r = advies([tc()], { run_type: 'subset', baseline: [tc()], bevatBlockingSet: false });
  assert.equal(r.advies, 'aanpassen');
  assert.equal(r.formeel, false);
});

test('subset met alles op orde → indicatief accepteren (niet formeel)', () => {
  const r = advies([tc({ soort: 'security_blocking' })], { run_type: 'subset', baseline: [tc({ soort: 'security_blocking' })], bevatBlockingSet: true });
  assert.equal(r.advies, 'accepteren');
  assert.equal(r.formeel, false);
});

test('ad_hoc → geen (formeel) advies', () => {
  const r = advies([tc()], { run_type: 'ad_hoc' });
  assert.equal(r.advies, null);
  assert.equal(r.formeel, false);
});

console.log(`\n${n} sanity-tests geslaagd.`);
