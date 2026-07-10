// lib/aqlab/seed/apply.ts
// -----------------------------------------------------------------------------
// Seedloader stap 5 (apply) + stap 6 (post-seed-verificatie). GATE-BEWAAKT:
// deze module weigert te draaien zolang SEED_ALLOWED = false of zonder expliciete
// --apply. Idempotente upserts op natuurlijke sleutels (herhaalbaar).
//
// LET OP (Fase 2): dit apply-pad is pas UITVOERBAAR nadat de vier gate-poorten
// sluiten (validatierapport §6) en de content_hashes in de bron staan. Zolang de
// gate open is, wordt deze code NIET aangeroepen door de CLI. Het gebruikt de
// service-role UITSLUITEND server-side (CLI), nooit in client-code (CLAUDE.md).
// -----------------------------------------------------------------------------
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  parseBronnen,
  structureleValidatie,
  hashVerificatie,
  testsetVan,
  CORE_FEATURES,
  type ParseResult,
} from './loader';

/** Harde weigering als de gate niet groen is of --apply ontbreekt. */
export function assertApplyToegestaan(seedAllowed: boolean, applyFlag: boolean): void {
  if (!seedAllowed) {
    throw new Error(
      'SEED_ALLOWED = false — seeden geblokkeerd door de seeding-gate. Sluit eerst de vier poorten (validatierapport §6).'
    );
  }
  if (!applyFlag) {
    throw new Error('apply geweigerd: dry-run is default. Voeg --apply toe én bevestig expliciet akkoord.');
  }
}

/** Service-role client — server-side/CLI only. Fail-closed zonder key. */
function maakServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL ontbreekt — seed-apply kan niet starten.');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY ontbreekt — vereist voor de server-side seed-apply.');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

const TESTSET_NAMEN: Record<string, string> = {
  samenvatting: 'Golden set — bestuurlijke samenvatting',
  vraagbeantwoording: 'Golden set — brongebonden vraagbeantwoording',
  besluitvoorbereiding: 'Golden set — besluitvoorbereiding',
  security_safety: 'Golden set — security/safety (blocking)',
};

/**
 * Voer de seed uit (idempotent). Volgorde: features → testsets → fixtures →
 * testcases → koppelingen → aqlab_log-append. synthetic=true wordt door de
 * DB-CHECK afgedwongen; de loader weigert bovendien niet-synthetische fixtures.
 */
export async function apply(seedAllowed: boolean, applyFlag: boolean): Promise<{ log: string[] }> {
  assertApplyToegestaan(seedAllowed, applyFlag);
  const p = parseBronnen();

  // Defense-in-depth (fail-closed): de gate dekt alleen de vier poorten. Herbevestig
  // hier óók de structurele validatie + hash-verificatie, zodat een directe apply()-
  // aanroep nooit een structureel kapotte/ongeverifieerde set kan seeden.
  const hardFails = structureleValidatie(p);
  const { mismatches, ontbrekend } = hashVerificatie(p);
  const blokkades = [...hardFails, ...mismatches, ...ontbrekend];
  if (blokkades.length > 0) {
    throw new Error(`apply geweigerd: structuur/hash-verificatie faalt:\n  - ${blokkades.join('\n  - ')}`);
  }

  const db = maakServiceClient();
  const log: string[] = [];

  // 1. Features (3 productfeatures).
  for (const code of Object.keys(CORE_FEATURES)) {
    const { error } = await db
      .from('aqlab_ai_features')
      .upsert({ code, naam: code }, { onConflict: 'code' });
    if (error) throw new Error(`feature ${code}: ${error.message}`);
  }
  log.push(`features: ${Object.keys(CORE_FEATURES).length} upsert`);

  // 2. Testsets (4). security_safety → feature_id null.
  const testsetKeys = [...new Set(p.testcases.map(testsetVan))].sort();
  const featureIdVoorTestset = (key: string): string | null => {
    const featureCode = Object.entries(CORE_FEATURES).find(([, v]) => v === key)?.[0];
    return featureCode ?? null; // resolve naar id hieronder
  };
  const testsetId = new Map<string, string>();
  for (const key of testsetKeys) {
    const featureCode = featureIdVoorTestset(key);
    let feature_id: string | null = null;
    if (featureCode) {
      const { data } = await db.from('aqlab_ai_features').select('id').eq('code', featureCode).single();
      feature_id = data?.id ?? null;
    }
    const { data, error } = await db
      .from('aqlab_test_sets')
      .upsert({ code: key, naam: TESTSET_NAMEN[key] ?? key, feature_id }, { onConflict: 'code' })
      .select('id')
      .single();
    if (error) throw new Error(`testset ${key}: ${error.message}`);
    testsetId.set(key, data.id);
  }
  log.push(`testsets: ${testsetKeys.length} upsert (${testsetKeys.join(', ')})`);

  // 3. Fixtures (24) — synthetic afgedwongen; upsert op (code, versie).
  const fixtureId = new Map<string, string>();
  for (const [code, f] of p.fixtures) {
    if (f.synthetic !== true) throw new Error(`weigering: niet-synthetische fixture ${code}`);
    const hash = p.hashes.find((h) => h.fixture_id === code)?.content_hash ?? f.content_hash ?? null;
    const versie = f.versie ?? 1;
    const { data, error } = await db
      .from('aqlab_fixture_documents')
      .upsert(
        { code, titel: f.titel ?? code, documenttype: f.documenttype ?? null, versie, content_hash: hash, synthetic: true },
        { onConflict: 'code,versie' }
      )
      .select('id')
      .single();
    if (error) throw new Error(`fixture ${code}: ${error.message}`);
    fixtureId.set(code, data.id);
  }
  log.push(`fixtures: ${p.fixtures.size} upsert`);

  // 4. Testcases + koppelingen.
  let links = 0;
  for (const t of p.testcases) {
    const test_set_id = testsetId.get(testsetVan(t));
    if (!test_set_id) throw new Error(`${t.id}: geen testset-id`);
    const { data, error } = await db
      .from('aqlab_test_cases')
      .upsert(
        {
          test_set_id,
          code: t.id,
          titel: t.testcase_title ?? t.id,
          gebruikersvraag: t.user_question ?? null,
          soort: testsetVan(t) === 'security_safety' ? 'security_blocking' : 'functioneel',
          review_verplicht: t.review_required === true,
          consistency_required: t.consistency_required === true,
          consistency_iterations: t.consistency_iterations ?? 3,
          minimale_acceptatiescore: t.min_quality_score ?? null,
          broncontext_ref: t.required_source_ids ?? [],
          spec: t as unknown as Record<string, unknown>,
        },
        { onConflict: 'test_set_id,code' }
      )
      .select('id')
      .single();
    if (error) throw new Error(`testcase ${t.id}: ${error.message}`);
    const test_case_id = data.id;

    for (const [rol, ids] of [
      ['required', t.required_source_ids ?? []],
      ['excluded', t.excluded_source_ids ?? []],
    ] as const) {
      for (const src of ids) {
        const fixture_document_id = fixtureId.get(src);
        if (!fixture_document_id) continue; // bewust niet-bestaande (SEC-05) overslaan
        const { error: le } = await db
          .from('aqlab_test_case_fixtures')
          .upsert({ test_case_id, fixture_document_id, rol }, { onConflict: 'test_case_id,fixture_document_id,rol' });
        if (le) throw new Error(`koppeling ${t.id}→${src}: ${le.message}`);
        links++;
      }
    }
  }
  log.push(`testcases: ${p.testcases.length} upsert; koppelingen: ${links}`);

  // 5. Append-only auditregel.
  const { error: loge } = await db.from('aqlab_log').insert({
    actie: 'seed_apply',
    object_type: 'golden_set',
    nieuwe_waarde: { fixtures: p.fixtures.size, testcases: p.testcases.length, testsets: testsetKeys },
  });
  if (loge) throw new Error(`aqlab_log: ${loge.message}`);

  return { log };
}

/** Stap 6 — post-seed-verificatie (rijtellingen + bidirectionele koppelingen). */
export async function postSeedVerificatie(): Promise<{ ok: boolean; meldingen: string[] }> {
  const db = maakServiceClient();
  const p: ParseResult = parseBronnen();
  const meldingen: string[] = [];
  let ok = true;

  const tel = async (tabel: string, verwacht: number) => {
    const { count, error } = await db.from(tabel).select('*', { count: 'exact', head: true });
    if (error) {
      meldingen.push(`${tabel}: fout ${error.message}`);
      ok = false;
      return;
    }
    if ((count ?? 0) < verwacht) {
      meldingen.push(`${tabel}: ${count} rijen (< verwacht ${verwacht})`);
      ok = false;
    } else {
      meldingen.push(`${tabel}: ${count} rijen ✓`);
    }
  };

  await tel('aqlab_fixture_documents', p.fixtures.size);
  await tel('aqlab_test_cases', p.testcases.length);
  await tel('aqlab_test_sets', 4);
  return { ok, meldingen };
}
