import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("biedt rollen, schema, data en customizations aan één falende single transaction aan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "atomic-supabase-restore-"));
  const source = path.join(root, "source");
  const restoreWorkdir = path.join(root, "restore");
  const fakeBin = path.join(root, "bin");
  const psqlLog = path.join(root, "psql.log");
  const archive = path.join(root, "database.tar.gz");
  await mkdir(source);
  await mkdir(restoreWorkdir);
  await mkdir(fakeBin);

  try {
    await Promise.all([
      writeFile(path.join(source, "roles.sql"), "create role restore_test;\n"),
      writeFile(path.join(source, "schema.sql"), "create table public.restore_test(id integer);\n"),
      writeFile(path.join(source, "data.sql"), [
        "COPY auth.users (id) FROM stdin;",
        "\\.",
        "COPY auth.identities (id) FROM stdin;",
        "\\.",
        "COPY storage.buckets (id) FROM stdin;",
        "\\.",
        "COPY storage.objects (id) FROM stdin;",
        "\\.",
        "",
      ].join("\n")),
      writeFile(path.join(source, "managed-customizations.sql"), [
        "drop policy if exists restore_test on storage.objects;",
        "create policy restore_test on storage.objects for select using (true);",
        "",
      ].join("\n")),
      writeFile(path.join(source, "database-validation.json"), '{"manifest_version":1}\n'),
      writeFile(path.join(source, "metadata.txt"), "source_project=aebwiufuegsiwhwpdrfb\n"),
    ]);

    const tarResult = await run("tar", ["-C", source, "-czf", archive, "."]);
    assert.equal(tarResult.code, 0, tarResult.stderr);
    const archiveBytes = await readFile(archive);
    await writeFile(`${archive}.sha256`, `${createHash("sha256").update(archiveBytes).digest("hex")}  ${path.basename(archive)}\n`);

    const fakePsql = path.join(fakeBin, "psql");
    await writeFile(fakePsql, [
      "#!/usr/bin/env bash",
      "set -Eeuo pipefail",
      "if [[ \" $* \" == *\" -Atc select 1 \"* ]]; then",
      "  echo 1",
      "  exit 0",
      "fi",
      "printf '%s\\n' \"$*\" >> \"$PSQL_LOG\"",
      "exit \"${PSQL_RESTORE_EXIT:-0}\"",
      "",
    ].join("\n"));
    await chmod(fakePsql, 0o700);

    const result = await run("bash", ["scripts/restore-supabase-backup.sh", archive], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        PSQL_LOG: psqlLog,
        PSQL_RESTORE_EXIT: "23",
        RESTORE_WORKDIR: restoreWorkdir,
        TARGET_DB_URL: "postgresql://postgres.restoretarget@restoretarget.example.invalid:5432/postgres",
        TARGET_PROJECT_REF: "restoretarget",
        TARGET_IS_EMPTY_CONFIRMED: "YES",
        RESTORE_STATE_BACKUP_MARKER_KEY: "backup-status/2026/08/19/manifest-2026-08-19T06-49-24Z.json",
        RESTORE_STATE_DATABASE_SHA256: "a".repeat(64),
      },
    });

    assert.equal(result.code, 23, `${result.stdout}\n${result.stderr}`);
    const invocations = (await readFile(psqlLog, "utf8")).trim().split("\n");
    assert.equal(invocations.length, 1);
    const restoreInvocation = invocations[0];
    assert.match(restoreInvocation, /--single-transaction/);
    assert.match(restoreInvocation, /-v VERBOSITY=sqlstate/);
    for (const phase of ["roles", "schema", "data", "managed_customizations"]) {
      assert.match(restoreInvocation, new RegExp(`RESTORE_PHASE=${phase}`));
    }
    for (const file of ["roles.sql", "schema.sql", "data.sql", "managed-customizations.restore.sql"]) {
      assert.match(restoreInvocation, new RegExp(file.replace(".", "\\.")));
    }
    assert.match(restoreInvocation, /RESTORE_PHASE=resume_state/);
    assert.match(restoreInvocation, /create-supabase-managed-restore-state\.sql/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
