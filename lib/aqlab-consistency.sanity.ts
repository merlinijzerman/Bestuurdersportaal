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

console.log(`\n${n} sanity-tests geslaagd.`);
