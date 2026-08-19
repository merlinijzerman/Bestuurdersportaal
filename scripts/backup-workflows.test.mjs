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
    "platform-inventory.yml",
  ]) {
    const text = await workflow(name);
    assert.match(text, /^name: /m, `${name} mist name`);
    assert.match(text, /^on:/m, `${name} mist on`);
    assert.match(text, /^jobs:/m, `${name} mist jobs`);
    assert.doesNotMatch(text, /\t/, `${name} bevat tabs`);
  }
});
