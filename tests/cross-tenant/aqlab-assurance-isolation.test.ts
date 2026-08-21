// tests/cross-tenant/aqlab-assurance-isolation.test.ts
// -----------------------------------------------------------------------------
// §15 — AQLab assurance-isolatie (AQL-4). Het assurance-leespad is het ENIGE
// tenant-facing pad; deze suite bewaakt dat het:
//   • UITSLUITEND aggregaten teruggeeft (het view-model draagt structureel geen
//     ruwe-output/prompt/context/testcase-velden);
//   • fonds-scope respecteert (alleen features waarvan een module beschikbaar is);
//   • de service-role NIET in de (dashboard)-boom binnenhaalt (gecureerd endpoint);
//   • het endpoint + de download authenticeren (anon+RLS) én host↔fonds afdwingen;
//   • de aqlab-service geen ruwe-output-kolommen selecteert;
//   • de aqlab_5-migratie geen fonds_id/geen permissive policy introduceert.
// App-laag: pure-functie-assertions + bron-inspectie (net als aqlab-isolation).
// -----------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  bepaalGebruikteFeatures,
  bouwAssuranceTegel,
  type AssuranceMeetwaarden,
} from '../../core/lib/aqlab/assurance-core';
import type { ModuleKey } from '../../core/lib/module-registry';
import {
  redenGeenGebruikerscontrole,
  redenGeenHostGuard,
  redenGeenRlsClient,
} from './route-wrapper-bewust';

const hier = dirname(fileURLToPath(import.meta.url));
const lees = (...p: string[]) => readFileSync(join(hier, '..', '..', ...p), 'utf8');

function meet(over: Partial<AssuranceMeetwaarden> = {}): AssuranceMeetwaarden {
  return {
    feature_code: 'brongebonden_vraagbeantwoording',
    release_status: 'vrijgegeven', laatste_controle: '2026-07-08',
    aantal_functioneel: 24, aantal_blokkerend: 6, kritieke_bevindingen: 0,
    openstaande_review: 0, brongebondenheid_ratio: 0.9, format_compliance_ratio: 1,
    regressie_status: 'gelijk', audit_export_id: 'exp-1', inhoud_hash: 'a'.repeat(64),
    ...over,
  };
}

// De verboden (ruwe) begrippen die NOOIT in het fonds-view-model mogen lekken.
const RUWE_VELDEN = [
  'gegenereerd_antwoord', 'antwoord', 'output', 'prompt', 'system_prompt',
  'gebruikte_context', 'context', 'testcase', 'test_case', 'inputvraag',
  'gebruikte_bronnen', 'snapshot_refs',
];

test('AQL-4 — assurance-tegel bevat UITSLUITEND aggregaten (geen ruwe velden)', () => {
  const keys = Object.keys(bouwAssuranceTegel(meet()));
  for (const verboden of RUWE_VELDEN) {
    assert.ok(!keys.includes(verboden), `assurance-tegel lekt veld '${verboden}'`);
  }
});

test('AQL-4 — fonds-scope: alleen features van beschikbare modules', () => {
  // Fonds zonder de procedures-module ziet besluitvoorbereiding niet.
  const zonderProcedures = bepaalGebruikteFeatures(new Set<ModuleKey>(['ai', 'notulen']));
  assert.ok(!zonderProcedures.includes('besluitvoorbereiding'));
  // Fonds zonder enige AI-module ziet niets.
  assert.deepEqual(bepaalGebruikteFeatures(new Set<ModuleKey>(['home', 'beheer'])), []);
});

test('AQL-4 — de (dashboard)-assurance-view haalt de service-role NIET binnen', () => {
  const page = lees('app', '(dashboard)', 'governance', 'assurance', 'page.tsx');
  assert.ok(!page.includes('supabase-service'), 'service-role-client in de tenant-boom');
  assert.ok(!page.includes('createServiceSupabase'), 'createServiceSupabase in de tenant-boom');
  // De data komt van het gecureerde endpoint.
  assert.ok(page.includes('/api/aqlab/assurance'), 'assurance-view fetcht niet het gecureerde endpoint');
});

// Wrapper-bewust (W3, issue #94): het assurance-endpoint loopt sinds de codemod
// via `withFondsRoute({ hostGuard: true })`. De drie eisen — anon+RLS, sessie-
// controle en host↔fonds — zijn dan niet weg maar verhuisd naar de wrapper. De
// helpers kijken per geëxporteerde handler waar de eis is belegd en verankeren de
// delegatie met `toetsWrapperFundament()`: alleen een wrapper die feitelijk
// createServerSupabase + auth.getUser doet, de service-role níét aanraakt en
// onder `hostGuard` beoordeelRouteHostToegang met 403 afdwingt, telt mee. Een
// route die de wrapper zónder `hostGuard: true` gebruikt, valt hier dus rood uit.
test('AQL-4 — het assurance-endpoint authenticeert (anon+RLS) én dwingt host↔fonds af', () => {
  const route = lees('app', 'api', 'aqlab', 'assurance', 'route.ts');
  assert.equal(redenGeenRlsClient(route), null, 'endpoint mist anon+RLS-auth');
  assert.equal(redenGeenGebruikerscontrole(route), null, 'endpoint mist getUser');
  assert.equal(redenGeenHostGuard(route), null, 'endpoint mist host↔fonds-enforce');
  // Het gecureerde endpoint mag de service-role nooit binnenhalen (AQL-4-kern).
  assert.ok(
    !route.includes('createServiceSupabase') && !route.includes('SUPABASE_SERVICE_ROLE_KEY'),
    'endpoint raakt de service-role — het assurance-leespad is deny-by-default'
  );
  const dl = lees('app', 'api', 'aqlab', 'assurance', 'audit', '[exportId]', 'route.ts');
  assert.ok(dl.includes('magFondsAuditExportZien'), 'download mist scope-autorisatie');
  assert.equal(redenGeenHostGuard(dl), null, 'download mist host↔fonds-enforce');
});

test('AQL-4 — fonds-download alleen voor VRIJGEGEVEN rapporten (niet geblokkeerd/tussenstatus)', () => {
  const svc = lees('core', 'lib', 'aqlab', 'assurance.ts');
  // D1b: de download-poort weigert zodra de export niet vrijgegeven is (RPC-vlag
  // is_vrijgegeven → opslag_ref null → 403); de feitelijke release_status-filtering
  // zit in de SECURITY DEFINER-RPC's + de storage-policy.
  assert.ok(svc.includes('is_vrijgegeven'),
    'magFondsAuditExportZien toetst de vrijgegeven-status (is_vrijgegeven) niet');
  const mig = lees('supabase', 'migrations', '2026_07_12_d1b_assurance_rpcs.sql');
  assert.ok(/release_status\s*=\s*'vrijgegeven'/.test(mig),
    "de D1b-RPC's/storage-policy filteren de export-referentie niet op release_status='vrijgegeven'");
});

test('AQL-4 — het bevroren auditrapport selecteert nooit ruwe-excerpt-kolommen', () => {
  // Regressie-borg (RLS-review): bouwAuditView mag de harde ruwe kolommen niet
  // in het (fonds-downloadbare) rapport trekken. `fragment` = ruw excerpt op
  // aqlab_findings; gegenereerd_antwoord/gebruikte_context/inputvraag = ruwe output.
  const gen = lees('platform', 'lib', 'aqlab', 'audit-export.ts');
  for (const veld of ['fragment', 'gegenereerd_antwoord', 'gebruikte_context', 'inputvraag']) {
    assert.ok(!gen.includes(veld), `audit-export selecteert ruw veld '${veld}' in het rapport`);
  }
});

test('AQL-4 — de assurance-service selecteert geen ruwe-output-kolommen', () => {
  const svc = lees('core', 'lib', 'aqlab', 'assurance.ts');
  for (const veld of ['gegenereerd_antwoord', 'gebruikte_context', 'inputvraag', 'gebruikte_bronnen', 'snapshot_refs']) {
    assert.ok(!svc.includes(veld), `assurance-service selecteert ruw veld '${veld}'`);
  }
});

test('AQL-4 — aqlab_5-migratie: geen fonds_id, geen permissive policy, bucket private', () => {
  const m5 = lees('supabase', 'migrations', '2026_07_10_aqlab_5_assurance.sql');
  // Geen fonds_id-KOLOM (het woord mag wel in een toelichtende comment staan).
  assert.ok(!/fonds_id\s+(uuid|text|integer)/i.test(m5), 'onverwachte fonds_id-kolom in aqlab_5');
  assert.ok(!/add\s+column[^;]*fonds_id/i.test(m5), 'onverwachte fonds_id-kolomtoevoeging in aqlab_5');
  assert.ok(!/create policy[^;]*on\s+storage\.objects/i.test(m5), 'onverwachte storage-policy (deny-by-default vereist)');
  assert.ok(/insert into storage\.buckets[\s\S]*'aqlab-audit'[\s\S]*false/i.test(m5), 'aqlab-audit-bucket niet privaat aangemaakt');
  assert.ok(m5.includes('platform.aqlab.govern'), 'govern-capability niet geseed');
});
