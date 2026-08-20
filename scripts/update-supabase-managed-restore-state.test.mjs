import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./update-supabase-managed-restore-state.sh", import.meta.url));
const baseEnv = {
  TARGET_DB_URL: "postgresql://postgres:secret@target-ref.pooler.supabase.com:5432/postgres",
  SOURCE_PROJECT_REF: "abcdefghijklmnopqrst",
  TARGET_PROJECT_REF: "zyxwvutsrqponmlkjihg",
  BACKUP_MARKER_KEY: "backup-status/2026/08/19/manifest-2026-08-19T06-49-24Z.json",
  DB_SHA256: "a".repeat(64),
};

async function fakePsql() {
  const dir = await mkdtemp(join(tmpdir(), "restore-state-test-"));
  const executable = join(dir, "psql");
  await writeFile(executable, `#!/usr/bin/env bash\nset -eu\nif [[ " $* " == *" -c "* ]]; then exit 0; fi\ncat >/dev/null\nprintf '1\\n'\n`);
  await chmod(executable, 0o700);
  return dir;
}

test("werkt een gebonden hervattingsfase bij", async () => {
  const bin = await fakePsql();
  const result = spawnSync("bash", [script, "storage_restored"], {
    encoding: "utf8",
    env: { ...process.env, ...baseEnv, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESTORE_STATE_PHASE=storage_restored/);
});

test("weigert een ongeldige marker vóór de databaseaanroep", async () => {
  const bin = await fakePsql();
  const result = spawnSync("bash", [script, "technical_verified"], {
    encoding: "utf8",
    env: { ...process.env, ...baseEnv, BACKUP_MARKER_KEY: "other.json", PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /REJECTED:marker/);
});

test("finaliseert alleen na een exact gebonden functional_verified-state", async () => {
  const bin = await fakePsql();
  const result = spawnSync("bash", [script, "finalize"], {
    encoding: "utf8",
    env: { ...process.env, ...baseEnv, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESTORE_STATE_FINALIZED/);
});
