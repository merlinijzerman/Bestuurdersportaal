// lib/aqlab-diff.sanity.ts
// -----------------------------------------------------------------------------
// Sanity-checks op de pure tekst-diff (lib/aqlab/diff.ts), die de outputvergelijking
// (scherm 4) en de verboden-variatie-markering (scherm 6b) voedt.
// Run: npx tsx lib/aqlab-diff.sanity.ts   (of: npm run sanity)
// -----------------------------------------------------------------------------
import assert from 'node:assert/strict';
import { woordDiff, heeftVerschil } from './aqlab/diff';

let n = 0;
function test(naam: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

test('identieke tekst → alle segmenten gelijk, geen verschil', () => {
  const d = woordDiff('de premie is 28,6%', 'de premie is 28,6%');
  assert.ok(d.every((s) => s.type === 'gelijk'));
  assert.equal(heeftVerschil(d), false);
});

test('gewijzigd cijfer → verwijderd + toegevoegd segment (verboden variatie zichtbaar)', () => {
  const d = woordDiff('de premie is 28,6%', 'de premie is 30,1%');
  assert.ok(d.some((s) => s.type === 'verwijderd' && s.tekst.includes('28,6%')));
  assert.ok(d.some((s) => s.type === 'toegevoegd' && s.tekst.includes('30,1%')));
  assert.equal(heeftVerschil(d), true);
});

test('reconstructie: gelijk+verwijderd = oud, gelijk+toegevoegd = nieuw', () => {
  const oud = 'aanleiding en voorstel volgen hier';
  const nieuw = 'aanleiding en het voorstel volgt hieronder';
  const d = woordDiff(oud, nieuw);
  const herOud = d.filter((s) => s.type !== 'toegevoegd').map((s) => s.tekst).join('');
  const herNieuw = d.filter((s) => s.type !== 'verwijderd').map((s) => s.tekst).join('');
  assert.equal(herOud, oud);
  assert.equal(herNieuw, nieuw);
});

test('alleen witruimteverschil telt niet als inhoudelijk verschil', () => {
  const d = woordDiff('a b', 'a  b');
  assert.equal(heeftVerschil(d), false);
});

console.log(`\n${n} sanity-tests geslaagd.`);
