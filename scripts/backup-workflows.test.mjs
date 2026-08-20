import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function workflow(name) {
  const text = await readFile(path.join(repositoryRoot, ".github", "workflows", name), "utf8");
  return text;
}

async function script(name) {
  return readFile(path.join(repositoryRoot, "scripts", name), "utf8");
}

test("watchdog controleert B2 ook zonder webhook en isoleert de configuratiefout", async () => {
  const text = await workflow("supabase-backup-watchdog.yml");
  assert.match(text, /^  synthetic-alert-delivery:/m);
  assert.match(text, /Deze veilige test raakt geen back-up, completion marker of B2-object aan/);
  assert.match(text, /^  alert-channel-configuration:/m);
  assert.match(text, /^  freshness-alert:[\s\S]*?ALERT_CATEGORY: b2_evidence_invalid/m);
  assert.match(text, /^  inventory-freshness-alert:[\s\S]*?ALERT_CATEGORY: b2_evidence_invalid/m);
  assert.match(text, /^  failure-alert:[\s\S]*?ALERT_CATEGORY: backup_failed/m);
  assert.match(text, /for variable in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY B2_BUCKET_NAME B2_S3_ENDPOINT; do/);
  assert.doesNotMatch(text, /for variable in[^\n]*BACKUP_ALERT_WEBHOOK_URL/);
});

test("back-up publiceert restorecontract 2 zonder redundante managed datafiles", async () => {
  const text = await workflow("supabase-backup.yml");
  assert.match(text, /restore_contract_version=2/);
  assert.match(text, /BACKUP_CREATED_UTC="\$\(date -u \+%Y-%m-%dT%H:%M:%SZ\)"/);
  assert.match(text, /"created_utc": created_utc/);
  assert.match(text, /managed-customizations-manifest\.json/);
  assert.match(text, /psql "\$SUPABASE_DB_URL" -X -qAt -v ON_ERROR_STOP=1 -f scripts\/create-backup-validation\.sql/);
  assert.doesNotMatch(text, /pg_dump .*auth-data\.sql/);
  assert.doesNotMatch(text, /pg_dump .*storage-data\.sql/);
  assert.doesNotMatch(text, /echo "- (?:Database|Storage|Completion marker): \\\\`/);
  assert.match(text, /printf -- '- Database: `%s`/);
});

test("watchdog accepteert zowel ISO-tijd als het bestaande contract-v2 manifest", async () => {
  const text = await workflow("supabase-backup-watchdog.yml");
  assert.match(text, /def parse_created_utc\(value\):/);
  assert.match(text, /datetime\.fromisoformat\(value\.replace\("Z", "\+00:00"\)\)/);
  assert.match(text, /datetime\.strptime\(value, "%Y-%m-%dT%H-%M-%SZ"\)/);
  assert.match(text, /created = parse_created_utc\(marker\["created_utc"\]\)/);
});

test("kosteloze preflight is main-only, versleuteld, herhaalbaar en ruimt altijd op", async () => {
  const text = await workflow("supabase-restore-preflight.yml");
  assert.match(text, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(text, /B2_READONLY_APPLICATION_KEY_ID/);
  assert.match(text, /cryptsetup luksFormat/);
  assert.match(text, /"data-root": \$data_root/);
  assert.match(text, /run: bash scripts\/run-supabase-restore-preflight\.sh/);
  assert.match(text, /\/etc\/apt\/apt-mirrors\.txt/);
  assert.match(text, /https:\/\/archive\.ubuntu\.com\/ubuntu/);
  assert.doesNotMatch(text, /['"]http:\/\/azure\.archive\.ubuntu\.com\/ubuntu['"]/);
  assert.match(text, /timeout --signal=TERM 5m apt-get update/);
  assert.match(text, /Versleutelde productiegegevens aantoonbaar vernietigen[\s\S]*?if: always\(\)/);
  assert.doesNotMatch(text, /RESTORE_TARGET_DB_URL|RESTORE_TARGET_SUPABASE_SERVICE_ROLE_KEY/);

  const runner = await script("run-supabase-restore-preflight.sh");
  assert.match(runner, /for iteration in 1 2; do/);
  assert.match(runner, /supabase stop --no-backup/);
  assert.match(runner, /--dry-run/);
  assert.match(runner, /cmp --silent/);
  assert.match(runner, /physical_objects_redownloaded_and_hashed: true/);
  assert.match(runner, /contains_sql_or_row_values/);
  assert.match(runner, /RESTORE_SQLSTATE/);
  assert.match(runner, /database-validation\.restore\.json/);
  assert.match(runner, /managed_customizations_prepare/);
  assert.match(runner, /storage-diagnostic\.json/);
  assert.match(runner, /STORAGE_HTTP_STATUS/);
  assert.match(runner, /restore-supabase-storage-with-metadata\.sh/);
  assert.match(runner, /validation-diagnostic\.json/);
  assert.match(runner, /contains_hashes_counts_bucket_or_object_names_or_values/);

  const metadataRestore = await script("restore-supabase-storage-with-metadata.sh");
  assert.match(metadataRestore, /capture-supabase-storage-metadata\.sql/);
  assert.match(metadataRestore, /restore-supabase-storage\.mjs/);
  assert.match(metadataRestore, /reconcile-supabase-storage-metadata\.sql/);
  assert.match(metadataRestore, /SNAPSHOT_STATE/);
  const targetSafetyCheck = metadataRestore.indexOf("bron- en doelproject zijn gelijk");
  const metadataCapture = metadataRestore.indexOf("STORAGE_PHASE=metadata_capture");
  assert.notEqual(targetSafetyCheck, -1);
  assert.ok(targetSafetyCheck < metadataCapture);

  const captureMetadata = await script("capture-supabase-storage-metadata.sql");
  assert.match(captureMetadata, /select bucket_id, name, owner, owner_id, metadata, user_metadata/);
  assert.doesNotMatch(captureMetadata, /select [^\n]*version/);
  assert.match(captureMetadata, /revoke all on schema bestuurdersportaal_restore_private from public/);

  const reconcileMetadata = await script("reconcile-supabase-storage-metadata.sql");
  assert.match(reconcileMetadata, /owner = source\.owner/);
  assert.match(reconcileMetadata, /owner_id = source\.owner_id/);
  assert.match(reconcileMetadata, /metadata = source\.metadata/);
  assert.match(reconcileMetadata, /user_metadata = source\.user_metadata/);
  assert.doesNotMatch(reconcileMetadata, /version = source\.version/);
  assert.match(reconcileMetadata, /drop schema bestuurdersportaal_restore_private cascade/);
});

test("managed restore scheidt keys, hervat exact, test Auth/RLS/app en lekt geen productiedata", async () => {
  const text = await workflow("supabase-restore-drill.yml");
  assert.match(text, /RESTORE_TARGET_SUPABASE_ADMIN_KEY/);
  assert.match(text, /RESTORE_TARGET_SUPABASE_CLIENT_KEY/);
  assert.doesNotMatch(text, /secrets\.RESTORE_TARGET_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(text, /platform_inventory_marker_key/);
  assert.match(text, /EXPECTED_CHECKSUM_NAME="platform-inventory-marker-\$\{INVENTORY_MARKER_NAME#manifest-\}"/);
  assert.doesNotMatch(text, /basename "\$INVENTORY_MARKER_PATH" \| sed 's\/\^platform-\/\/'/);
  const markerStep = text.indexOf("- name: Niet-geheime Auth-inventarismarker ophalen en valideren");
  const inventoryStep = text.indexOf("- name: Niet-geheime Auth-inventaris ophalen en valideren");
  const archiveStep = text.indexOf("- name: Exacte backup-archieven binnen LUKS ophalen");
  assert.notEqual(markerStep, -1);
  assert.ok(markerStep < inventoryStep && inventoryStep < archiveStep);
  assert.match(text.slice(markerStep, inventoryStep), /env\.write\(f"INVENTORY_KEY=/);
  assert.doesNotMatch(text.slice(markerStep, inventoryStep), /INVENTORY_PATH=/);
  assert.match(text.slice(inventoryStep, archiveStep), /INVENTORY_PATH="\$DRILL_ROOT/);
  assert.match(text.slice(inventoryStep, archiveStep), /verify-portable-checksum\.mjs/);
  assert.doesNotMatch(text.slice(inventoryStep, archiveStep), /sha256sum -c/);
  assert.match(text, /scripts\/download-b2-object-with-retry\.sh/);
  assert.match(text, /B2_DOWNLOAD_MAX_ATTEMPTS: "3"/);
  assert.match(text, /B2_DOWNLOAD_RETRY_DELAY_SECONDS: "5"/);
  const downloadInvocations = text.slice(markerStep).split("\n").filter(
    (line) => line.trim() === "scripts/download-b2-object-with-retry.sh \\",
  );
  assert.equal(downloadInvocations.length, 8);
  assert.equal((text.match(/scripts\/download-b2-object-with-retry\.sh/g) || []).length, 11);
  assert.doesNotMatch(text, /aws s3 cp/);
  assert.match(text.slice(inventoryStep, archiveStep), /"\$INVENTORY_BYTES" "\$INVENTORY_SHA256"/);
  assert.match(text.slice(archiveStep), /"\$DB_BYTES" "\$DB_SHA256"/);
  assert.match(text.slice(archiveStep), /"\$STORAGE_BYTES" "\$STORAGE_SHA256"/);
  assert.equal(
    (text.match(/--source "\$DB_SOURCE_DIR\/database-validation\.restore\.json"/g) || []).length,
    2,
  );
  assert.doesNotMatch(text, /--source "\$DB_SOURCE_DIR\/database-validation\.json"/);
  assert.equal(
    (text.match(/psql "\$TARGET_DB_URL" -X -qAt -v ON_ERROR_STOP=1 -f scripts\/create-backup-validation\.sql/g) || []).length,
    2,
  );
  assert.equal(
    (text.match(/node scripts\/normalize-supabase-validation-json\.mjs/g) || []).length,
    2,
  );
  assert.equal(
    (text.match(/--allow-additional-trigger auth\.users\.bij_app_metadata/g) || []).length,
    2,
  );
  const technicalValidation = text.indexOf("- name: Database-, Auth- en Storage-inhoud exact controleren");
  const provisioningMigration = text.indexOf("- name: Auth-provisioningmigratie op tijdelijke restore-target toepassen");
  const authConfig = text.indexOf("- name: Auth-provider- en beveiligingsinstellingen vergelijken");
  assert.ok(technicalValidation < provisioningMigration && provisioningMigration < authConfig);
  assert.match(text, /supabase\/migrations\/2026_08_19_maak_profiel_admin_api_provisioning\.sql/);
  assert.match(text, /TARGET_VALIDATION_RAW_PATH="\$DRILL_ROOT\/target-validation\.raw"/);
  assert.match(text, /FINAL_TARGET_VALIDATION_RAW_PATH="\$DRILL_ROOT\/final-target-validation\.raw"/);
  assert.match(text, /verify-supabase-managed-keys\.mjs/);
  assert.match(text, /verify-supabase-auth-config\.mjs/);
  assert.match(text, /verify-supabase-managed-functional\.mjs setup/);
  assert.match(text, /run-supabase-managed-app-smoke\.mjs/);
  assert.match(text, /TENANT_ENFORCE=on/);
  assert.match(text, /resolve-supabase-managed-restore-mode\.mjs/);
  assert.match(text, /create-supabase-managed-restore-state\.sql|RESTORE_STATE_BACKUP_MARKER_KEY/);
  assert.match(text, /update-supabase-managed-restore-state\.sh finalize/);
  assert.match(text, /cryptsetup luksFormat/);
  assert.match(text, /setsid \.\/node_modules\/\.bin\/next start/);
  assert.doesNotMatch(text, /npm run start > "\$APP_LOG"/);
  assert.match(text, /kill -- "-\$pid"/);
  assert.match(text, /kill -- "-\$PID"/);
  assert.match(text, /sudo fuser -km "\$MANAGED_RESTORE_ROOT"/);

  // De smoke draait over TLS omdat de app HSTS en upgrade-insecure-requests
  // meestuurt; over plain http laadt Chrome de _next-chunks niet en hydrateert
  // React nooit. De terminator is een wegwerplaag binnen LUKS — de
  // productieheaders in next.config.ts blijven onaangeroerd.
  assert.match(text, /serve-managed-smoke-tls\.mjs/);
  assert.match(text, /openssl req -x509/);
  assert.match(text, /APP_SMOKE_PORT=3443 APP_SMOKE_SCHEME=https/);
  assert.match(text, /TLS_CERT="\$DRILL_ROOT\/smoke-tls\.crt"/);
  assert.doesNotMatch(text, /APP_SMOKE_PORT=3000 node/);
  assert.match(text, /APP_WORKTREE=\$SECURE_ROOT\/app-worktree/);
  assert.match(text, /Versleutelde productiegegevens aantoonbaar vernietigen[\s\S]*?if: always\(\)/);
  assert.match(text, /create-supabase-managed-restore-evidence\.mjs/);
  assert.match(text, /bp-managed-restore-evidence-\$\{\{ github\.run_id \}\}\/\*\.json/);
  assert.doesNotMatch(text, /path:[\s\S]{0,500}storage-manifest\.json/);
  assert.doesNotMatch(text, /path:[\s\S]{0,500}target-validation\.json/);

  const keys = await script("verify-supabase-managed-keys.mjs");
  assert.match(keys, /sb_secret_/);
  assert.match(keys, /sb_publishable_/);
  assert.match(keys, /purpose !== "admin"/);

  const storage = await script("restore-supabase-storage.mjs");
  assert.match(storage, /publishable key mag niet voor Storage-beheer/);
  assert.match(storage, /return \{ apikey: key \}/);

  const functional = await script("verify-supabase-managed-functional.mjs");
  assert.match(functional, /signInWithPassword/);
  assert.match(functional, /rls_foreign_document_visible/);
  assert.match(functional, /storage_cross_tenant_visible/);

  const evidence = await script("create-supabase-managed-restore-evidence.mjs");
  assert.doesNotMatch(evidence, /storage_path:/);
  assert.doesNotMatch(evidence, /document_id:/);

  const stateSql = await script("create-supabase-managed-restore-state.sql");
  const stateUpdater = await script("update-supabase-managed-restore-state.sh");
  assert.match(stateSql, /bestuurdersportaal_managed_restore_private\.resume_state/);
  assert.match(stateSql, /updated_at timestamptz/);
  assert.match(stateUpdater, /bestuurdersportaal_managed_restore_private\.resume_state/);
  assert.match(stateUpdater, /updated_at = now\(\)/);
  assert.doesNotMatch(stateSql, /managed_restore_state/);
  assert.doesNotMatch(stateSql, /bestuurdersportaal_restore_private\.resume_state/);

  const login = await readFile(path.join(repositoryRoot, "app", "login", "page.tsx"), "utf8");
  assert.match(login, /window\.location\.replace\("\/"\)/);
  assert.doesNotMatch(login, /router\.(?:push|refresh)/);

  // De smoke mag het loginformulier pas aanraken nadat React is gehydrateerd.
  // Klikken daarvoor levert een native GET /login op — de velden hebben geen
  // name-attribuut — en dat is niet te onderscheiden van een mislukte login.
  const smoke = await readFile(
    path.join(repositoryRoot, "scripts", "run-supabase-managed-app-smoke.mjs"),
    "utf8"
  );
  const hydratie = smoke.indexOf("__reactProps$");
  const invullen = smoke.indexOf('getByLabel("E-mailadres")');
  assert.ok(hydratie > 0 && invullen > hydratie);
  assert.match(smoke, /MANAGED_APP_SMOKE_DIAGNOSTIC/);
  assert.match(smoke, /APP_SMOKE_SCHEME/);

  // De dashboardcontrole mag niet afhangen van het fondsmanifest: welke
  // modules in de nav staan is een configuratiekeuze per fonds, geen bewijs
  // dat het herstel is geslaagd.
  assert.match(smoke, /a\[href="\/profiel"\]/);
  assert.doesNotMatch(smoke, /getByRole\("link", \{ name: "Home"/);

  // De TLS-terminator bestaat alleen omdat deze twee productieheaders blijven
  // staan. Verdwijnen ze, dan is de wegwerplaag zinloos geworden en moet die
  // keuze bewust opnieuw worden gemaakt in plaats van stil mee te schuiven.
  const config = await readFile(path.join(repositoryRoot, "next.config.ts"), "utf8");
  assert.match(config, /Strict-Transport-Security/);
  assert.match(config, /upgrade-insecure-requests/);

  // Alles wat door de terminator loopt is herstelde productiedata: geen paden,
  // hosts, headers of bodies in de logs.
  const tls = await readFile(
    path.join(repositoryRoot, "scripts", "serve-managed-smoke-tls.mjs"),
    "utf8"
  );
  assert.doesNotMatch(tls, /console\.(?:log|info|warn|error|debug)/);
  assert.match(tls, /"x-forwarded-proto": "https"/);
});

test("Auth-configuratiediagnose is main-only, read-only en publiceert geen waarden", async () => {
  const text = await workflow("supabase-auth-config-diagnosis.yml");
  assert.match(text, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(text, /DIAGNOSE_READ_ONLY/);
  assert.match(text, /B2_READONLY_APPLICATION_KEY_ID/);
  assert.match(text, /verify-portable-checksum\.mjs/);
  assert.match(text, /diagnose-supabase-auth-config\.mjs/);
  assert.match(text, /auth-config-diagnostic-\$\{\{ github\.run_id \}\}/);
  assert.match(text, /actions\/upload-artifact@v4\.6\.2/);
  assert.doesNotMatch(text, /TARGET_DB_URL|TARGET_SUPABASE_ADMIN_KEY|restore-supabase-backup|restore-supabase-storage|update-supabase-managed-restore-state|psql /);
  assert.doesNotMatch(text, /supabase db push|supabase start|supabase stop/);

  const diagnostic = await script("diagnose-supabase-auth-config.mjs");
  assert.match(diagnostic, /mismatch_category|mismatchCategory/);
  assert.match(diagnostic, /secret_values_compared: false/);
  assert.doesNotMatch(diagnostic, /console\.log\(.*target|JSON\.stringify\(target/);
});

test("captured triggers kwalificeren de vooraf gecontroleerde public-functie", async () => {
  const text = await script("capture-supabase-managed-customizations.sql");
  assert.match(text, /function_namespace\.nspname = 'public'/);
  assert.match(text, /regexp_replace\([\s\S]*pg_get_triggerdef\(t\.oid\)[\s\S]*EXECUTE FUNCTION %I\.%I\(/);
});

test("alle backup- en restoreworkflows behouden de vereiste YAML-basisstructuur", async () => {
  for (const name of [
    "supabase-backup.yml",
    "supabase-backup-watchdog.yml",
    "supabase-restore-preflight.yml",
    "supabase-restore-drill.yml",
    "supabase-auth-config-diagnosis.yml",
    "platform-inventory.yml",
  ]) {
    const text = await workflow(name);
    assert.match(text, /^name: /m, `${name} mist name`);
    assert.match(text, /^on:/m, `${name} mist on`);
    assert.match(text, /^jobs:/m, `${name} mist jobs`);
    assert.doesNotMatch(text, /\t/, `${name} bevat tabs`);
  }
});
