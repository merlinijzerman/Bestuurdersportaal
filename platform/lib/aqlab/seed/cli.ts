// lib/aqlab/seed/cli.ts
// -----------------------------------------------------------------------------
// AQLab seedloader — CLI. Dry-run is DEFAULT en schrijft niets. `--apply` seedt
// uitsluitend als (a) de gate groen is (SEED_ALLOWED = true) én (b) --apply is
// meegegeven. Zolang een poort openstaat weigert de loader (gate-first).
//
// Run:  npx tsx lib/aqlab/seed/cli.ts            # dry-run (verificatie)
//       npx tsx lib/aqlab/seed/cli.ts --apply    # seed (alleen na akkoord + groene gate)
//
// Exit: 0 = dry-run groen / apply geslaagd; 2 = gate blokkeert of hard fail.
// -----------------------------------------------------------------------------
import { join } from 'node:path';
import { dryRun, AQLAB_DIR, AVG_TC, LEGAL_TCS } from './loader';
import { evalueerGate } from './gate';

const lijn = (c = '─') => console.log(c.repeat(72));

async function main() {
  const applyFlag = process.argv.includes('--apply');

  console.log('AQLAB SEEDLOADER — dry-run is default; geen mutatie zonder groene gate + --apply');
  lijn('═');

  // ── 1-4. Dry-run (parse, structureel, hash, plan) ──────────────────────────
  const r = dryRun();
  console.log(
    `1. PARSE      testcases=${r.parse.testcases.length} fixtures=${r.parse.fixtures.size} ` +
      `checks=${r.parse.checkKeys.size} canonical_texts=${Object.keys(r.parse.canonicalTexts).length}`
  );

  console.log(`2. STRUCTUUR  hard-fails=${r.hardFails.length}`);
  for (const h of r.hardFails) console.log(`   ! ${h}`);

  console.log(
    `3. HASH       mismatches=${r.hashMismatches.length} | placeholders in seed-YAML=${r.placeholderCount}`
  );
  for (const m of r.hashMismatches) console.log(`   ! ${m}`);

  console.log(
    `4. PLAN       fixtures=${r.plan.fixtures} · testsets=${r.plan.testsets.length} ` +
      `(${r.plan.testsets.join(', ')}) · testcases=${r.plan.testcases}`
  );
  lijn();

  // ── Gate ───────────────────────────────────────────────────────────────────
  const gate = evalueerGate(r.parse.seedYamlRaw, join(AQLAB_DIR, 'AQLAB-VALIDATION-STATE.yaml'));
  console.log('GATE (seeding-gate §6):');
  for (const p of gate.poorten) console.log(`   [${p.groen ? 'PASS' : 'RED '}] ${p.omschrijving}`);
  console.log(`\n   SEED_ALLOWED = ${gate.seedAllowed}  (AVG-case ${AVG_TC}; juridisch ${LEGAL_TCS.join('/')})`);
  lijn('═');

  const structureelGroen = r.hardFails.length === 0 && r.hashMismatches.length === 0;

  // ── Apply (alleen na groene gate + --apply) ────────────────────────────────
  if (applyFlag) {
    if (!gate.seedAllowed) {
      console.error('\n✗ --apply geweigerd: SEED_ALLOWED = false. Sluit eerst de vier poorten.');
      process.exit(2);
    }
    if (!structureelGroen) {
      console.error('\n✗ --apply geweigerd: structurele validatie of hash-verificatie faalt.');
      process.exit(2);
    }
    // Lazy import: alleen laden als we écht gaan schrijven (env/DB vereist).
    const { apply, postSeedVerificatie } = await import('./apply');
    console.log('\n5. APPLY (transactionele upsert)…');
    const { log } = await apply(gate.seedAllowed, applyFlag);
    for (const l of log) console.log(`   ${l}`);
    console.log('6. POST-SEED-VERIFICATIE…');
    const v = await postSeedVerificatie();
    for (const m of v.meldingen) console.log(`   ${m}`);
    process.exit(v.ok ? 0 : 2);
  }

  // ── Dry-run afronding ──────────────────────────────────────────────────────
  console.log(
    structureelGroen
      ? '✓ DRY-RUN: structureel groen. ' +
          (gate.seedAllowed
            ? 'Gate groen → seeden mag met --apply (na akkoord).'
            : 'Gate BLOKKEERT → geen seed tot de poorten sluiten.')
      : '✗ DRY-RUN: structurele/hard fails — los eerst op.'
  );
  process.exit(structureelGroen ? 0 : 2);
}

main().catch((e) => {
  console.error('FOUT:', e instanceof Error ? e.message : e);
  process.exit(2);
});
