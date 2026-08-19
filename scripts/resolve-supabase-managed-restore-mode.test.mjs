import assert from "node:assert/strict";
import test from "node:test";

import { resolveManagedRestoreMode } from "./resolve-supabase-managed-restore-mode.mjs";

const expected = {
  sourceProjectRef: "aebwiufuegsiwhwpdrfb",
  targetProjectRef: "abcdefghijklmnopqrst",
  backupMarkerKey: "backup-status/2026/08/19/manifest-2026-08-19T06-49-24Z.json",
  databaseSha256: "a".repeat(64),
};

test("staat alleen een aantoonbaar leeg doel als fresh toe", () => {
  assert.deepEqual(resolveManagedRestoreMode({
    public_tables: 0,
    auth_users: 0,
    storage_buckets: 0,
    storage_objects: 0,
    state: null,
  }, expected), { mode: "fresh", prior_phase: null });
  assert.throws(() => resolveManagedRestoreMode({
    public_tables: 1,
    auth_users: 0,
    storage_buckets: 0,
    storage_objects: 0,
    state: null,
  }, expected), /veilig worden bepaald/);
});

test("hervat uitsluitend dezelfde bron/marker/database op hetzelfde doel", () => {
  const snapshot = {
    public_tables: 120,
    auth_users: 16,
    storage_buckets: 4,
    storage_objects: 34,
    state: {
      contract_version: 1,
      phase: "database_restored",
      source_project_ref: expected.sourceProjectRef,
      target_project_ref: expected.targetProjectRef,
      backup_marker_key: expected.backupMarkerKey,
      database_sha256: expected.databaseSha256,
    },
  };
  assert.deepEqual(resolveManagedRestoreMode(snapshot, expected), {
    mode: "resume",
    prior_phase: "database_restored",
  });
  assert.throws(() => resolveManagedRestoreMode({
    ...snapshot,
    state: { ...snapshot.state, target_project_ref: "zyxwvutsrqponmlkjihg" },
  }, expected), /veilig worden bepaald/);
  assert.throws(() => resolveManagedRestoreMode({
    ...snapshot,
    state: { ...snapshot.state, database_sha256: "b".repeat(64) },
  }, expected), /veilig worden bepaald/);
});

test("weigert onbekende of afgeronde statefasen fail-closed", () => {
  assert.throws(() => resolveManagedRestoreMode({
    public_tables: 1,
    auth_users: 1,
    storage_buckets: 1,
    storage_objects: 1,
    state: {
      contract_version: 1,
      phase: "unknown",
      source_project_ref: expected.sourceProjectRef,
      target_project_ref: expected.targetProjectRef,
      backup_marker_key: expected.backupMarkerKey,
      database_sha256: expected.databaseSha256,
    },
  }, expected), /veilig worden bepaald/);
});
