#!/usr/bin/env bash

# Restore a real, checksummed backup twice into a disposable local Supabase
# stack. All source data, service output and temporary logs stay on the
# encrypted volume supplied through PREFLIGHT_ROOT. Only aggregate/hash-based
# evidence is copied out by the workflow after this script succeeds.

set -Eeuo pipefail
umask 077

: "${PREFLIGHT_ROOT:?PREFLIGHT_ROOT ontbreekt}"
: "${DB_ARCHIVE_PATH:?DB_ARCHIVE_PATH ontbreekt}"
: "${STORAGE_ARCHIVE_PATH:?STORAGE_ARCHIVE_PATH ontbreekt}"
: "${MARKER_PATH:?MARKER_PATH ontbreekt}"
: "${BACKUP_MARKER_KEY:?BACKUP_MARKER_KEY ontbreekt}"
: "${EVIDENCE_DIR:?EVIDENCE_DIR ontbreekt}"

for path in "$PREFLIGHT_ROOT" "$DB_ARCHIVE_PATH" "$STORAGE_ARCHIVE_PATH" "$MARKER_PATH"; do
  case "$path" in
    "$PREFLIGHT_ROOT"|"$PREFLIGHT_ROOT"/*) ;;
    *) echo "Preflight stopt: pad valt buiten het versleutelde volume." >&2; exit 1 ;;
  esac
done

stop_stack() {
  supabase stop --no-backup >"$PREFLIGHT_ROOT/supabase-stop.log" 2>&1 || true
}
trap stop_stack EXIT

STORAGE_RESTORE_DIR="$PREFLIGHT_ROOT/storage"
mkdir -p "$STORAGE_RESTORE_DIR"

python3 - "$STORAGE_ARCHIVE_PATH" <<'PY'
import pathlib
import sys
import tarfile

archive = sys.argv[1]
with tarfile.open(archive, "r:gz") as handle:
    for member in handle:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit("Storage-archief bevat een onveilig pad")
        if not (member.isfile() or member.isdir()):
            raise SystemExit("Storage-archief bevat een onveilig niet-regulier bestand")
PY
tar -xzf "$STORAGE_ARCHIVE_PATH" -C "$STORAGE_RESTORE_DIR"
test -s "$STORAGE_RESTORE_DIR/storage-manifest.json"

export TARGET_PROJECT_REF=local
export TARGET_SUPABASE_URL=http://127.0.0.1:54321
if ! node scripts/restore-supabase-storage.mjs \
  --input-dir "$STORAGE_RESTORE_DIR" \
  --dry-run >"$PREFLIGHT_ROOT/storage-dry-run.json" 2>"$PREFLIGHT_ROOT/storage-dry-run.log"; then
  echo "Preflight stopt: echte Storage-archief faalt de read-only dry-run." >&2
  exit 1
fi

load_local_status() {
  local status_path="$PREFLIGHT_ROOT/supabase-status.env"
  supabase status -o env >"$status_path" 2>"$PREFLIGHT_ROOT/supabase-status.log"
  # The file is produced by the pinned local CLI and contains shell-quoted
  # localhost values. Never print or copy it outside the encrypted volume.
  set -a
  # shellcheck disable=SC1090
  source "$status_path"
  set +a
  rm -f "$status_path"
  : "${DB_URL:?Lokale DB_URL ontbreekt}"
  : "${API_URL:?Lokale API_URL ontbreekt}"
  : "${SERVICE_ROLE_KEY:?Lokale SERVICE_ROLE_KEY ontbreekt}"
  echo "::add-mask::$SERVICE_ROLE_KEY"
  export TARGET_DB_URL="$DB_URL"
  export TARGET_SUPABASE_URL="$API_URL"
  export TARGET_SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
}

assert_empty_target() {
  local output_path="$1"
  psql "$TARGET_DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "
    select json_build_object(
      'public_tables', (
        select count(*) from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
      ),
      'auth_users', (select count(*) from auth.users),
      'storage_buckets', (select count(*) from storage.buckets),
      'storage_objects', (select count(*) from storage.objects)
    )::text;
  " >"$output_path" 2>"$PREFLIGHT_ROOT/empty-target.log"
  python3 - "$output_path" <<'PY'
import json
import pathlib
import sys

values = json.loads(pathlib.Path(sys.argv[1]).read_text())
expected = {"public_tables": 0, "auth_users": 0, "storage_buckets": 0, "storage_objects": 0}
if values != expected:
    raise SystemExit("Lokale Supabase-stack is niet schoon")
PY
}

for iteration in 1 2; do
  stop_stack
  if ! bash scripts/start-ephemeral-supabase.sh \
    >"$PREFLIGHT_ROOT/supabase-start-$iteration.log" 2>&1; then
    echo "Preflight stopt: lokale Supabase-stack start niet (iteratie $iteration)." >&2
    exit 1
  fi
  load_local_status

  SERVER_MAJOR="$(psql "$TARGET_DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "show server_version_num" | cut -c1-2)"
  test "$SERVER_MAJOR" = "17" || {
    echo "Preflight stopt: lokale PostgreSQL-major is $SERVER_MAJOR in plaats van 17." >&2
    exit 1
  }

  ITERATION_ROOT="$PREFLIGHT_ROOT/iteration-$iteration"
  RESTORE_WORKDIR="$ITERATION_ROOT/database"
  mkdir -p "$ITERATION_ROOT" "$RESTORE_WORKDIR"
  assert_empty_target "$ITERATION_ROOT/target-precheck.json"

  export RESTORE_WORKDIR TARGET_IS_EMPTY_CONFIRMED=YES
  DATABASE_RESTORE_LOG="$ITERATION_ROOT/database-restore.log"
  if ! bash scripts/restore-supabase-backup.sh "$DB_ARCHIVE_PATH" \
    >"$DATABASE_RESTORE_LOG" 2>&1; then
    RESTORE_PHASE="$(sed -n 's/^RESTORE_PHASE=\(archive_integrity\|archive_safety\|archive_extract\|restore_contract\|target_safety\|target_connection\|data_contract\|managed_customizations_prepare\|validation_json\|roles\|schema\|data\|managed_customizations\)$/\1/p' "$DATABASE_RESTORE_LOG" | tail -n 1)"
    RESTORE_SQLSTATE="$(sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\)[[:space:]]*$/\1/p' "$DATABASE_RESTORE_LOG" | tail -n 1)"
    RESTORE_PHASE="${RESTORE_PHASE:-pre_psql}"
    RESTORE_SQLSTATE="${RESTORE_SQLSTATE:-unknown}"
    python3 - "$EVIDENCE_DIR/restore-diagnostic.json" "$iteration" "$RESTORE_PHASE" "$RESTORE_SQLSTATE" <<'PY'
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

path, iteration, phase, sqlstate = sys.argv[1:]
allowed_phases = {
    "pre_psql", "archive_integrity", "archive_safety", "archive_extract",
    "restore_contract", "target_safety", "target_connection", "data_contract",
    "managed_customizations_prepare", "validation_json", "roles", "schema",
    "data", "managed_customizations",
}
if phase not in allowed_phases:
    phase = "unknown"
if sqlstate != "unknown" and not re.fullmatch(r"[0-9A-Z]{5}", sqlstate):
    sqlstate = "unknown"
pathlib.Path(path).write_text(json.dumps({
    "schema_version": 1,
    "status": "database-restore-failed",
    "created_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "iteration": int(iteration),
    "phase": phase,
    "sqlstate": sqlstate,
    "contains_sql_or_row_values": False,
}, indent=2) + "\n")
PY
    echo "Preflight stopt: atomaire database-restore faalt (iteratie $iteration, fase $RESTORE_PHASE, SQLSTATE $RESTORE_SQLSTATE); de versleutelde detailoutput wordt vernietigd." >&2
    exit 1
  fi

  if ! bash scripts/restore-supabase-storage-with-metadata.sh "$STORAGE_RESTORE_DIR" \
    >"$ITERATION_ROOT/storage-restore.json" 2>"$ITERATION_ROOT/storage-restore.log"; then
    STORAGE_PHASE="$(sed -n 's/^STORAGE_PHASE=\(metadata_capture\|physical_restore\|local_archive\|bucket_read\|bucket_create\|bucket_update\|object_resume_check\|object_upload\|object_verify\|metadata_reconcile\)$/\1/p' "$ITERATION_ROOT/storage-restore.log" | tail -n 1)"
    STORAGE_HTTP_STATUS="$(sed -n 's/^STORAGE_HTTP_STATUS=\([1-5][0-9][0-9]\|unknown\)$/\1/p' "$ITERATION_ROOT/storage-restore.log" | tail -n 1)"
    STORAGE_PHASE="${STORAGE_PHASE:-local_archive}"
    STORAGE_HTTP_STATUS="${STORAGE_HTTP_STATUS:-unknown}"
    python3 - "$EVIDENCE_DIR/storage-diagnostic.json" "$iteration" "$STORAGE_PHASE" "$STORAGE_HTTP_STATUS" <<'PY'
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

path, iteration, phase, http_status = sys.argv[1:]
allowed_phases = {
    "metadata_capture", "physical_restore", "local_archive", "bucket_read", "bucket_create",
    "bucket_update", "object_resume_check", "object_upload", "object_verify", "metadata_reconcile",
}
if phase not in allowed_phases:
    phase = "unknown"
if http_status != "unknown" and not re.fullmatch(r"[1-5][0-9]{2}", http_status):
    http_status = "unknown"
pathlib.Path(path).write_text(json.dumps({
    "schema_version": 1,
    "status": "storage-restore-failed",
    "created_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "iteration": int(iteration),
    "phase": phase,
    "http_status": http_status,
    "contains_bucket_or_object_names": False,
}, indent=2) + "\n")
PY
    echo "Preflight stopt: fysieke Storage-restore/verificatie faalt (iteratie $iteration, fase $STORAGE_PHASE, HTTP $STORAGE_HTTP_STATUS); de versleutelde detailoutput wordt vernietigd." >&2
    exit 1
  fi

  TARGET_VALIDATION_PATH="$ITERATION_ROOT/target-validation.json"
  RESTORE_EVIDENCE_PATH="$ITERATION_ROOT/restore-verification.json"
  psql "$TARGET_DB_URL" -X -qAt -v ON_ERROR_STOP=1 \
    -f scripts/create-backup-validation.sql >"$TARGET_VALIDATION_PATH" 2>"$ITERATION_ROOT/validation.log"
  if ! node scripts/verify-supabase-restore.mjs \
    --source "$RESTORE_WORKDIR/database-validation.restore.json" \
    --target "$TARGET_VALIDATION_PATH" \
    --storage-manifest "$STORAGE_RESTORE_DIR/storage-manifest.json" \
    >"$RESTORE_EVIDENCE_PATH" 2>"$ITERATION_ROOT/verification.log"; then
    VALIDATION_CATEGORY="$(sed -n 's/^VALIDATION_CATEGORY=\(contract\|postgres_major\|count_auth_users\|count_auth_identities\|count_storage_buckets\|count_storage_objects\|count_storage_by_bucket\|count_critical_public\|content_auth_users\|content_auth_identities\|content_storage_buckets\|content_storage_objects\|content_critical_public\|policies\|triggers\|extensions\|storage_manifest\|unknown\)$/\1/p' "$ITERATION_ROOT/verification.log" | tail -n 1)"
    VALIDATION_CATEGORY="${VALIDATION_CATEGORY:-unknown}"
    python3 - "$EVIDENCE_DIR/validation-diagnostic.json" "$iteration" "$VALIDATION_CATEGORY" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

path, iteration, category = sys.argv[1:]
allowed_categories = {
    "contract", "postgres_major", "count_auth_users", "count_auth_identities",
    "count_storage_buckets", "count_storage_objects", "count_storage_by_bucket",
    "count_critical_public", "content_auth_users", "content_auth_identities",
    "content_storage_buckets", "content_storage_objects", "content_critical_public",
    "policies", "triggers", "extensions", "storage_manifest", "unknown",
}
if category not in allowed_categories:
    category = "unknown"
pathlib.Path(path).write_text(json.dumps({
    "schema_version": 1,
    "status": "restore-validation-failed",
    "created_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "iteration": int(iteration),
    "category": category,
    "contains_hashes_counts_bucket_or_object_names_or_values": False,
}, indent=2) + "\n")
PY
    echo "Preflight stopt: inhoudelijke restorevalidatie faalt (iteratie $iteration, categorie $VALIDATION_CATEGORY); de versleutelde detailoutput wordt vernietigd." >&2
    exit 1
  fi

  stop_stack
done

cmp --silent \
  "$PREFLIGHT_ROOT/iteration-1/restore-verification.json" \
  "$PREFLIGHT_ROOT/iteration-2/restore-verification.json" || {
  echo "Preflight stopt: de twee schone restore-uitkomsten zijn niet reproduceerbaar." >&2
  exit 1
}

node --input-type=module - <<'NODE'
import { readFile, writeFile } from "node:fs/promises";

const root = process.env.PREFLIGHT_ROOT;
const marker = JSON.parse(await readFile(process.env.MARKER_PATH, "utf8"));
const evidence = JSON.parse(await readFile(`${root}/iteration-2/restore-verification.json`, "utf8"));
const dryRun = JSON.parse(await readFile(`${root}/storage-dry-run.json`, "utf8"));
const report = {
  schema_version: 1,
  status: "go-for-managed-review",
  created_utc: new Date().toISOString(),
  commit_sha: process.env.GITHUB_SHA,
  backup_marker_key: process.env.BACKUP_MARKER_KEY,
  backup_created_utc: marker.created_utc,
  database_sha256: marker.database.sha256,
  storage_sha256: marker.storage.sha256,
  encrypted_runner_volume: true,
  clean_restore_iterations: 2,
  postgres_major: evidence.postgres_major,
  storage_dry_run: dryRun.dry_run === true,
  auth_users: evidence.auth_users,
  auth_identities: evidence.auth_identities,
  storage_buckets: evidence.storage_buckets,
  storage_objects: evidence.storage_objects,
  storage_total_bytes: evidence.storage_total_bytes,
  content_hashes_verified: evidence.content_hashes_verified,
  policy_count: evidence.policy_count,
  trigger_count: evidence.trigger_count,
  critical_public_counts: evidence.critical_public_counts,
  source_extensions: evidence.source_extensions,
  physical_objects_redownloaded_and_hashed: true,
  managed_supabase_differences_remaining: [
    "Auth-providerconfiguratie en secretwaarden worden niet uit het archief hersteld",
    "functionele Auth/RLS/app-smokes vereisen een aangewezen canary en een managed doel",
    "Supabase Cloud serviceconfiguratie kan lokaal afwijken",
  ],
};
await writeFile(`${root}/go-no-go.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
NODE

echo "Kosteloze restorepreflight groen: twee schone PG17/Supabase-restores zijn inhoudelijk gelijk."
