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
  assert.match(text, /managed-customizations-manifest\.json/);
  assert.doesNotMatch(text, /pg_dump .*auth-data\.sql/);
  assert.doesNotMatch(text, /pg_dump .*storage-data\.sql/);
  assert.doesNotMatch(text, /echo "- (?:Database|Storage|Completion marker): \\\\`/);
  assert.match(text, /printf -- '- Database: `%s`/);
});

test("alle backup- en restoreworkflows behouden de vereiste YAML-basisstructuur", async () => {
  for (const name of [
    "supabase-backup.yml",
    "supabase-backup-watchdog.yml",
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
