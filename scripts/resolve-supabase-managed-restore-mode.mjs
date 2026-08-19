#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const RESUMABLE_PHASES = new Set([
  "database_restored",
  "storage_restored",
  "technical_verified",
  "functional_verified",
]);

class RestoreModeError extends Error {
  constructor(category) {
    super("Managed restore-modus kon niet veilig worden bepaald");
    this.name = "RestoreModeError";
    this.category = category;
  }
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function resolveManagedRestoreMode(snapshot, expected) {
  if (!snapshot || typeof snapshot !== "object" || !expected || typeof expected !== "object") {
    throw new RestoreModeError("contract");
  }
  const counts = ["public_tables", "auth_users", "storage_buckets", "storage_objects"]
    .map((key) => count(snapshot[key]));
  if (counts.some((value) => value === null)) throw new RestoreModeError("counts");

  if (snapshot.state == null) {
    if (counts.every((value) => value === 0)) return { mode: "fresh", prior_phase: null };
    throw new RestoreModeError("nonempty_without_state");
  }
  const state = snapshot.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new RestoreModeError("state_contract");
  if (counts[0] === 0) throw new RestoreModeError("state_without_database");
  if (state.contract_version !== 1) throw new RestoreModeError("state_version");
  if (!RESUMABLE_PHASES.has(state.phase)) throw new RestoreModeError("state_phase");

  for (const [stateKey, expectedKey] of [
    ["source_project_ref", "sourceProjectRef"],
    ["target_project_ref", "targetProjectRef"],
    ["backup_marker_key", "backupMarkerKey"],
    ["database_sha256", "databaseSha256"],
  ]) {
    if (state[stateKey] !== expected[expectedKey]) throw new RestoreModeError("state_binding");
  }
  return { mode: "resume", prior_phase: state.phase };
}

async function main() {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) throw new RestoreModeError("inputs");
  const result = resolveManagedRestoreMode(JSON.parse(await readFile(snapshotPath, "utf8")), {
    sourceProjectRef: process.env.SOURCE_PROJECT_REF,
    targetProjectRef: process.env.TARGET_PROJECT_REF,
    backupMarkerKey: process.env.BACKUP_MARKER_KEY,
    databaseSha256: process.env.DB_SHA256,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const category = error instanceof RestoreModeError ? error.category : "unknown";
    process.stderr.write(`RESTORE_MODE_REJECTED:${category}\n`);
    process.exitCode = 1;
  });
}
