// lib/aqlab-criteria.sanity.ts
// -----------------------------------------------------------------------------
// Sanity-checks op de AQLab scorecriteria-registry (lib/aqlab/criteria.ts).
// Waarom: de criterium-registry is de code-seed waar aqlab_scores.criterium_code
// en de seedloader-validatie op steunen; sleutels moeten uniek en stabiel zijn.
// Run: npx tsx lib/aqlab-criteria.sanity.ts   (of: npm run sanity)
// -----------------------------------------------------------------------------
import assert from 'node:assert/strict';
import {
  AQLAB_CRITERIA,
  AQLAB_CRITERIA_KEYS,
  criteriumByKey,
  isBekendCriterium,
} from './aqlab/criteria';

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

test('registry bevat de 14 checks uit de v0.2-seed', () => {
  assert.equal(AQLAB_CRITERIA.length, 14);
  assert.equal(AQLAB_CRITERIA_KEYS.length, 14);
});

test('criterium-sleutels zijn uniek', () => {
  const set = new Set(AQLAB_CRITERIA_KEYS);
  assert.equal(set.size, AQLAB_CRITERIA_KEYS.length);
});

test('elke methode is een geldige waarde', () => {
  const geldig = new Set(['deterministic', 'heuristic', 'judge', 'human']);
  for (const c of AQLAB_CRITERIA) assert.ok(geldig.has(c.methode), `ongeldige methode: ${c.methode}`);
});

test('elk criterium heeft pass/fail/limitation ingevuld (geen schijnzekerheid)', () => {
  for (const c of AQLAB_CRITERIA) {
    assert.ok(c.pass_condition.length > 0, `${c.key}: lege pass_condition`);
    assert.ok(c.fail_condition.length > 0, `${c.key}: lege fail_condition`);
    assert.ok(c.limitation.length > 0, `${c.key}: lege limitation`);
  }
});

test('de [Volgens wetgeving]-gevoelige duiding blijft judge/human, niet deterministisch', () => {
  // risk_duiding_correct en claim_matches_source_semantic zijn juridisch/inhoudelijk
  // → mogen niet als deterministisch gelabeld staan (geen schijnzekerheid).
  assert.equal(criteriumByKey('risk_duiding_correct')?.methode, 'judge');
  assert.equal(criteriumByKey('claim_matches_source_semantic')?.methode, 'judge');
  assert.equal(criteriumByKey('human_review')?.methode, 'human');
});

test('lookup- en guard-functies werken', () => {
  assert.equal(criteriumByKey('exact_numeric_fact_match')?.methode, 'deterministic');
  assert.equal(criteriumByKey('bestaat-niet'), undefined);
  assert.equal(isBekendCriterium('pii_minimization'), true);
  assert.equal(isBekendCriterium('onzin'), false);
});

console.log(`\n${n} sanity-tests geslaagd.`);
