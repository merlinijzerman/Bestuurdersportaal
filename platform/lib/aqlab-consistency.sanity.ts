// lib/aqlab-consistency.sanity.ts
// -----------------------------------------------------------------------------
// Sanity-checks op de AQLab consistentie-config (lib/aqlab/consistency.ts).
// Waarom: AQL-1 RESERVEERT de ADR 0056-aggregaatvelden zonder ze te berekenen;
// deze checks borgen dat de gereserveerde veldenset compleet is en de gewichten
// kloppen, zodat AQL-3 erop kan bouwen zonder drift.
// Run: npx tsx lib/aqlab-consistency.sanity.ts   (of: npm run sanity)
// -----------------------------------------------------------------------------
import assert from 'node:assert/strict';
import {
  AQLAB_CONSISTENCY_CONFIG,
  AQLAB_CONSISTENCY_AGGREGATE_FIELDS,
  AQLAB_CONSISTENCY_STATUSES,
  AQLAB_CONSISTENCY_ITERATIONS,
  berekenConsistentie,
  type IteratieMeting,
} from './aqlab/consistency';

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

test('stabiliteitsgewichten sommeren tot 1.0', () => {
  const w = AQLAB_CONSISTENCY_CONFIG.scoring.weights;
  const som = w.gate_stability + w.fact_stability + w.source_stability + w.format_stability + w.score_stability;
  assert.ok(Math.abs(som - 1.0) < 1e-9, `gewichten sommeren tot ${som}, verwacht 1.0`);
});

test('elke gewogen dimensie staat ook in dimensions', () => {
  const dims = new Set(AQLAB_CONSISTENCY_CONFIG.dimensions);
  for (const k of Object.keys(AQLAB_CONSISTENCY_CONFIG.scoring.weights)) {
    assert.ok(dims.has(k as (typeof AQLAB_CONSISTENCY_CONFIG.dimensions)[number]), `${k} ontbreekt in dimensions`);
  }
});

test('ADR 0056-correctheidsvelden zijn gereserveerd (naast stabiliteit)', () => {
  const c = AQLAB_CONSISTENCY_AGGREGATE_FIELDS.correctness;
  for (const veld of ['gate_pass_rate', 'fact_correctness_rate', 'source_correctness_rate', 'format_pass_rate']) {
    assert.ok((c as readonly string[]).includes(veld), `gereserveerd correctheidsveld ontbreekt: ${veld}`);
  }
  assert.ok((AQLAB_CONSISTENCY_AGGREGATE_FIELDS.technical as readonly string[]).includes('retrieval_stability'));
});

test('consistent_but_incorrect is een geldige status (ADR 0056)', () => {
  assert.ok(AQLAB_CONSISTENCY_STATUSES.includes('consistent_but_incorrect'));
  assert.equal(AQLAB_CONSISTENCY_STATUSES.length, 5);
});

test('iteratie-aantallen spiegelen de DB-CHECK (3 of 5)', () => {
  assert.deepEqual([...AQLAB_CONSISTENCY_ITERATIONS], [3, 5]);
});

test('normale én kritieke pass-regel + spread-max aanwezig', () => {
  assert.ok(AQLAB_CONSISTENCY_CONFIG.pass_rules.normal.length > 0);
  assert.ok(AQLAB_CONSISTENCY_CONFIG.pass_rules.critical.length > 0);
  assert.equal(AQLAB_CONSISTENCY_CONFIG.scoring.score_spread_max.normal, 10);
  assert.equal(AQLAB_CONSISTENCY_CONFIG.scoring.score_spread_max.critical, 5);
});

// ── AQL-3: berekenConsistentie (ADR 0056) ──────────────────────────────────
// Bouwsteen: één iteratie met alle relevante checks pass=true en gate=pass.
function iter(iteratie: number, over: Partial<IteratieMeting> = {}): IteratieMeting {
  return {
    iteratie,
    gate_status: 'pass',
    quality_score: 90,
    passByCode: {
      exact_numeric_fact_match: true,
      no_forbidden_claim: true,
      claim_matches_source_semantic: true,
      source_id_exists: true,
      source_label_present: true,
      required_section_present: true,
    },
    bronIds: ['HORIZON-MEMO-001'],
    retrievalIds: ['HORIZON-MEMO-001'],
    ...over,
  };
}
const OPT = { iterations: 3, consistency_required: true, critical: false };

test('3/3 identiek + correct → consistent + release_eligible', () => {
  const r = berekenConsistentie([iter(1), iter(2), iter(3)], OPT);
  assert.equal(r.consistency_status, 'consistent');
  assert.equal(r.release_eligible, true);
  assert.equal(r.passed, 3);
  assert.equal(r.gate_stability, true);
  assert.equal(r.fact_stability, true);
  assert.equal(r.consistency_score, 100);
});

test('wisselend feit over iteraties → unstable, niet release_eligible', () => {
  const r = berekenConsistentie(
    [iter(1), iter(2, { passByCode: { ...iter(2).passByCode, exact_numeric_fact_match: false } }), iter(3)],
    OPT
  );
  assert.equal(r.consistency_status, 'unstable');
  assert.equal(r.fact_stability, false);
  assert.equal(r.release_eligible, false);
  assert.ok(r.consistency_findings.some((f) => f.dimensie === 'fact' && f.soort === 'verboden_variatie'));
});

test('stabiel maar consistent fout (alle iteraties zelfde fout) → consistent_but_incorrect (blokkerend)', () => {
  const fout = (i: number) =>
    iter(i, { passByCode: { ...iter(i).passByCode, exact_numeric_fact_match: false } });
  const r = berekenConsistentie([fout(1), fout(2), fout(3)], OPT);
  // fact_stability = true (allemaal identiek fout), maar fact_correctness_rate = 0.
  assert.equal(r.fact_stability, true);
  assert.equal(r.fact_correctness_rate, 0);
  assert.equal(r.consistency_status, 'consistent_but_incorrect');
  assert.equal(r.release_eligible, false);
});

test('gate-fout in één iteratie → gate_stability false → unstable, niet release_eligible', () => {
  const r = berekenConsistentie([iter(1), iter(2, { gate_status: 'geblokkeerd' }), iter(3)], OPT);
  assert.equal(r.gate_stability, false);
  assert.equal(r.passed, 2);
  assert.equal(r.release_eligible, false);
});

test('alleen score-spreiding (stabiele dims) → light_variation, niet zelfstandig release_eligible', () => {
  const r = berekenConsistentie(
    [iter(1, { quality_score: 95 }), iter(2, { quality_score: 78 }), iter(3, { quality_score: 90 })],
    OPT
  );
  assert.equal(r.gate_stability, true);
  assert.equal(r.score_spread, 17);
  assert.equal(r.consistency_status, 'light_variation');
  assert.equal(r.release_eligible, false);
});

test('kritieke pass-regel: 5/5 vereist (critical) — 4/5 pass → niet release_eligible', () => {
  const critOpt = { iterations: 5, consistency_required: true, critical: true };
  const iters = [iter(1), iter(2), iter(3), iter(4), iter(5, { gate_status: 'review_vereist' })];
  const r = berekenConsistentie(iters, critOpt);
  assert.equal(r.passed, 4);
  assert.equal(r.release_eligible, false);
});

test('bronkeuze-inconsistentie (verschillende bronIds) → source_stability false', () => {
  const r = berekenConsistentie(
    [iter(1), iter(2, { bronIds: ['ANDERE-BRON-002'] }), iter(3)],
    OPT
  );
  assert.equal(r.source_stability, false);
  assert.equal(r.source_stability_exact, true);
  assert.ok(r.consistency_findings.some((f) => f.dimensie === 'source'));
});

test('retrieval_stability is diagnostisch: verschil blokkeert niet zelfstandig release', () => {
  const r = berekenConsistentie(
    [iter(1), iter(2, { retrievalIds: ['X', 'Y'] }), iter(3)],
    OPT
  );
  assert.equal(r.retrieval_stability, false);
  // Bronkeuze + feiten stabiel + correct → nog steeds consistent + release_eligible.
  assert.equal(r.consistency_status, 'consistent');
  assert.equal(r.release_eligible, true);
});

test('onvolledige run (minder iteraties dan gepland) → niet release_eligible (review)', () => {
  // Review-finding 2: kritieke case plant 5, maar slechts 1 iteratie gedraaid.
  const r = berekenConsistentie([iter(1)], { iterations: 5, consistency_required: true, critical: true });
  assert.equal(r.volledig_gedraaid, false);
  assert.equal(r.release_eligible, false);
  assert.equal(r.consistency_status, 'review_required');
});

test('geen machinaal toetsbare correctheidschecks → review_required, niet release_eligible', () => {
  // Review-finding 3: ad-hoc zonder checks mag geen groen vinkje krijgen.
  const kaal = (i: number): IteratieMeting => ({ iteratie: i, gate_status: 'pass', quality_score: 90, passByCode: {}, bronIds: ['B'], retrievalIds: ['B'] });
  const r = berekenConsistentie([kaal(1), kaal(2), kaal(3)], OPT);
  assert.equal(r.correctheid_gemeten, false);
  assert.equal(r.release_eligible, false);
  assert.equal(r.consistency_status, 'review_required');
});

test('meetlabels scheiden deterministisch vs judge vs mens (geen schijnzekerheid)', () => {
  const r = berekenConsistentie([iter(1), iter(2), iter(3)], OPT);
  assert.ok(r.meetlabels.deterministisch.includes('gate_stability'));
  assert.ok(r.meetlabels.judge.includes('claim_matches_source_semantic'));
  assert.ok(r.meetlabels.mens.length > 0);
});

test('correctheidsdrempels: normaal soepeler op format dan kritiek', () => {
  assert.ok(
    AQLAB_CONSISTENCY_CONFIG.correctness_thresholds.normal.format_pass_rate <
      AQLAB_CONSISTENCY_CONFIG.correctness_thresholds.critical.format_pass_rate
  );
  for (const dim of ['fact', 'source', 'format'] as const) {
    assert.ok(AQLAB_CONSISTENCY_CONFIG.dimension_criteria[dim].length > 0);
  }
});

console.log(`\n${n} sanity-tests geslaagd.`);
