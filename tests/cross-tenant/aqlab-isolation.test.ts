// tests/cross-tenant/aqlab-isolation.test.ts
// -----------------------------------------------------------------------------
// §15 — AQLab-isolatie (AQL-1). App-laag: pure-functie-assertions + bron-
// inspectie op de migraties. Bewaakt de invarianten die de DB-laag-check
// (supabase/checks/2026_07_10_aqlab_cross_tenant.sql) onder échte RLS aantoont:
//   - aqlab_-tabellen zijn deny-by-default (GEEN permissive policies in de code)
//   - de append-only tabellen dragen no_update/no_delete-triggers
//   - fixtures zijn synthetic=true afgedwongen
//   - de gate blokkeert seeden zolang content_hash-placeholders bestaan
//   - de testset-groepering zet security-cases apart (soort=security_blocking)
// -----------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { testsetVan } from '../../lib/aqlab/seed/loader';
import { evalueerGate, PLACEHOLDER } from '../../lib/aqlab/seed/gate';

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, '..', '..', ...p), 'utf8');

const M1 = lees('supabase', 'migrations', '2026_07_10_aqlab_1_register.sql');
const M2 = lees('supabase', 'migrations', '2026_07_10_aqlab_2_runs.sql');
const M3 = lees('supabase', 'migrations', '2026_07_10_aqlab_3_governance.sql');
const AQLAB_TABELLEN = [
  'aqlab_ai_features', 'aqlab_test_sets', 'aqlab_test_cases', 'aqlab_prompt_versions',
  'aqlab_model_configurations', 'aqlab_fixture_documents', 'aqlab_test_case_fixtures',
  'aqlab_runs', 'aqlab_run_outputs', 'aqlab_scores', 'aqlab_findings',
  'aqlab_human_reviews', 'aqlab_release_decisions', 'aqlab_audit_exports', 'aqlab_log',
];

test('AQL-1 — elke aqlab_-tabel heeft RLS expliciet aan (guardrail nieuwe tabellen)', () => {
  const alle = M1 + M2 + M3;
  for (const t of AQLAB_TABELLEN) {
    assert.ok(
      alle.includes(`alter table public.${t} enable row level security`) ||
        alle.includes(`alter table public.${t}  enable row level security`) ||
        new RegExp(`alter table public\\.${t}\\s+enable row level security`).test(alle),
      `RLS niet aangezet op ${t}`
    );
  }
});

test('AQL-1 — deny-by-default: GEEN permissive policy op aqlab_-tabellen (decision 0058)', () => {
  const alle = M1 + M2 + M3;
  // Er mag geen enkele "create policy ... on public.aqlab_..." bestaan: toegang
  // loopt server-side via de platform-service-role-wrapper, niet via policies.
  const policyRe = /create policy[^;]*on\s+public\.aqlab_/gi;
  const treffers = alle.match(policyRe) ?? [];
  assert.equal(treffers.length, 0, `onverwachte policy op aqlab_-tabel: ${treffers.join(' | ')}`);
});

test('AQL-1 — append-only tabellen dragen no_update/no_delete-triggers', () => {
  for (const t of ['aqlab_log', 'aqlab_release_decisions', 'aqlab_audit_exports']) {
    assert.ok(M3.includes(`trg_${t}_no_update`), `no_update-trigger ontbreekt op ${t}`);
    assert.ok(M3.includes(`trg_${t}_no_delete`), `no_delete-trigger ontbreekt op ${t}`);
  }
  assert.ok(M3.includes('fn_log_append_only'), 'hergebruik van fn_log_append_only ontbreekt');
});

test('AQL-1 — fixtures zijn synthetic=true afgedwongen (geen echte fondsdata)', () => {
  assert.ok(/synthetic\s+boolean[^,]*check\s*\(\s*synthetic\s*=\s*true\s*\)/i.test(M1),
    'CHECK (synthetic = true) ontbreekt op aqlab_fixture_documents');
});

test('AQL-1 — release-beslisregel: kritieke bevinding blokkeert vrijgave (CHECK)', () => {
  assert.ok(M3.includes('aqlab_release_kritiek_blokkeert'), 'beslisregel-CHECK ontbreekt');
  assert.ok(/kritieke_bevindingen_count\s*=\s*0/.test(M3), 'kritieke-count-conditie ontbreekt in CHECK');
});

test('AQL-1 — geen fonds_id op aqlab_-tabellen (provider-globaal in MVP)', () => {
  const alle = M1 + M2 + M3;
  assert.ok(!/aqlab_[a-z_]*\([^)]*fonds_id/i.test(alle), 'onverwachte fonds_id-kolom op een aqlab_-tabel');
});

test('AQL-1 — testset-groepering: security-cases apart, kern-features 1:1', () => {
  assert.equal(testsetVan({ id: 'BS-01', feature: 'bestuurlijke_samenvatting' }), 'samenvatting');
  assert.equal(testsetVan({ id: 'BQ-01', feature: 'brongebonden_vraagbeantwoording' }), 'vraagbeantwoording');
  assert.equal(testsetVan({ id: 'BV-01', feature: 'besluitvoorbereiding' }), 'besluitvoorbereiding');
  // Elke SEC-feature valt in de aparte security_safety-set.
  assert.equal(testsetVan({ id: 'SEC-01', feature: 'cross_tenant' }), 'security_safety');
  assert.equal(testsetVan({ id: 'SEC-02', feature: 'promptonthulling' }), 'security_safety');
});

test('AQL-1 — gate blokkeert seeden zolang content_hash-placeholders bestaan', () => {
  const statePath = join(hier, '..', '..', 'ai-quality-lab', 'AQLAB-VALIDATION-STATE.yaml');
  // Simuleer een seed-YAML mét placeholder → hash-poort rood → SEED_ALLOWED false.
  const metPlaceholder = evalueerGate(`x: ${PLACEHOLDER}\n`, statePath);
  assert.equal(metPlaceholder.seedAllowed, false);
  assert.ok(metPlaceholder.redenen.length >= 1);
  // Alle vier poorten in de huidige state open → geblokkeerd.
  assert.ok(metPlaceholder.poorten.every((p) => !p.groen));
});
