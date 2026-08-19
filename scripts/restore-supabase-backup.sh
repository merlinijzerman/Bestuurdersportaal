#!/usr/bin/env bash

# Fail-closed database restore for a backup produced by supabase-backup.yml.
# This script never chooses a target project and never restores over a source
# project. The caller must explicitly confirm a new/empty target.

set -Eeuo pipefail
umask 077

usage() {
  echo "Gebruik: TARGET_DB_URL=... TARGET_PROJECT_REF=... TARGET_IS_EMPTY_CONFIRMED=YES $0 backup.tar.gz" >&2
  exit 2
}

ARCHIVE_PATH="${1:-}"
[ -n "$ARCHIVE_PATH" ] || usage
[ -f "$ARCHIVE_PATH" ] || { echo "Back-uparchief bestaat niet: $ARCHIVE_PATH" >&2; exit 1; }

: "${TARGET_DB_URL:?TARGET_DB_URL ontbreekt}"
: "${TARGET_PROJECT_REF:?TARGET_PROJECT_REF ontbreekt}"
: "${TARGET_IS_EMPTY_CONFIRMED:?TARGET_IS_EMPTY_CONFIRMED moet YES zijn}"
[ "$TARGET_IS_EMPTY_CONFIRMED" = "YES" ] || {
  echo "Restore stopt: TARGET_IS_EMPTY_CONFIRMED is niet YES." >&2
  exit 1
}

CHECKSUM_PATH="$ARCHIVE_PATH.sha256"
[ -f "$CHECKSUM_PATH" ] || { echo "Checksum-bestand ontbreekt: $CHECKSUM_PATH" >&2; exit 1; }
echo "RESTORE_PHASE=archive_integrity"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$(dirname "$ARCHIVE_PATH")" && sha256sum -c "$(basename "$CHECKSUM_PATH")")
else
  EXPECTED_HASH="$(awk '{print $1}' "$CHECKSUM_PATH")"
  ACTUAL_HASH="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
  [ "$EXPECTED_HASH" = "$ACTUAL_HASH" ] || { echo "Checksum wijkt af." >&2; exit 1; }
fi

WORKDIR="${RESTORE_WORKDIR:-$(mktemp -d "${TMPDIR:-/tmp}/bestuurdersportaal-restore.XXXXXX")}"
mkdir -p "$WORKDIR"
chmod 700 "$WORKDIR"
[ -z "$(find "$WORKDIR" -mindepth 1 -maxdepth 1 -print -quit)" ] || {
  echo "Restore stopt: RESTORE_WORKDIR moet leeg zijn: $WORKDIR" >&2
  exit 1
}

echo "RESTORE_PHASE=archive_safety"
python3 - "$ARCHIVE_PATH" <<'PY'
import subprocess
import sys
import tarfile

archive = sys.argv[1]
listing = subprocess.check_output(["tar", "-tzf", archive], text=True)
for raw_name in listing.splitlines():
    name = raw_name.rstrip("/")
    if not name or name.startswith("/") or name == ".." or name.startswith("../") or "/../" in name:
        raise SystemExit(f"Onveilig pad in archief: {raw_name}")

with tarfile.open(archive, "r:gz") as handle:
    for member in handle:
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"Onveilig niet-regulier bestand in archief: {member.name}")
PY

echo "RESTORE_PHASE=archive_extract"
tar -xzf "$ARCHIVE_PATH" -C "$WORKDIR"
for file in roles.sql schema.sql data.sql managed-customizations.sql database-validation.json metadata.txt; do
  [ -s "$WORKDIR/$file" ] || { echo "Verplicht restorebestand ontbreekt of is leeg: $file" >&2; exit 1; }
done

echo "RESTORE_PHASE=restore_contract"
RESTORE_CONTRACT_VERSION="$(sed -n 's/^restore_contract_version=//p' "$WORKDIR/metadata.txt" | head -n 1)"
RESTORE_CONTRACT_VERSION="${RESTORE_CONTRACT_VERSION:-1}"
case "$RESTORE_CONTRACT_VERSION" in
  1) echo "Legacy restorecontract 1: redundante auth-data.sql/storage-data.sql worden bewust niet gebruikt." ;;
  2)
    [ -s "$WORKDIR/managed-customizations-manifest.json" ] || {
      echo "Restorecontract 2 mist managed-customizations-manifest.json." >&2
      exit 1
    }
    ;;
  *) echo "Onbekende restore_contract_version: $RESTORE_CONTRACT_VERSION" >&2; exit 1 ;;
esac

SOURCE_PROJECT_REF="$(sed -n 's/^source_project=//p' "$WORKDIR/metadata.txt" | head -n 1)"
[ -n "$SOURCE_PROJECT_REF" ] || { echo "source_project ontbreekt in metadata.txt" >&2; exit 1; }
[ "$SOURCE_PROJECT_REF" != "$TARGET_PROJECT_REF" ] || {
  echo "Restore stopt: bron- en doelproject zijn gelijk ($TARGET_PROJECT_REF)." >&2
  exit 1
}

echo "RESTORE_PHASE=target_safety"
python3 - "$TARGET_DB_URL" "$TARGET_PROJECT_REF" <<'PY'
from urllib.parse import urlsplit
import sys

url, project_ref = sys.argv[1:]
parsed = urlsplit(url)
host = parsed.hostname or ""
username = parsed.username or ""
if project_ref != "local" and project_ref not in host and project_ref not in username:
    raise SystemExit("TARGET_DB_URL verwijst niet aantoonbaar naar TARGET_PROJECT_REF")
PY

echo "RESTORE_PHASE=target_connection"
psql "$TARGET_DB_URL" -X -v ON_ERROR_STOP=1 -Atc "select 1" >/dev/null

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Restore gestart: $STARTED_AT"
echo "Doelproject: $TARGET_PROJECT_REF"
echo "Bewijswerkmap: $WORKDIR"

# The Supabase CLI data-only dump is the supported, combined restore source for
# public, Auth and Storage data. Prove those managed tables are present before
# the first target mutation; a partial dump must fail closed.
echo "RESTORE_PHASE=data_contract"
for required_copy in \
  'auth[^[:alnum:]_]+users' \
  'auth[^[:alnum:]_]+identities' \
  'storage[^[:alnum:]_]+buckets' \
  'storage[^[:alnum:]_]+objects'
do
  grep -Eiq "^COPY .*${required_copy}.* FROM stdin;$" "$WORKDIR/data.sql" || {
    echo "Restore stopt: data.sql mist vereiste COPY voor $required_copy." >&2
    exit 1
  }
done

# Older artifacts may contain psql chatter plus Supabase-owned functions and
# default RLS state. Prepare a restore-only copy that retains portable project
# policies/triggers, removes only recognized managed output, and rejects unknown
# psql status variants.
echo "RESTORE_PHASE=managed_customizations_prepare"
node scripts/prepare-supabase-managed-customizations.mjs \
  --input "$WORKDIR/managed-customizations.sql" \
  --output "$WORKDIR/managed-customizations.restore.sql" \
  --manifest "$WORKDIR/managed-customizations.restore-manifest.json"

if [ "$RESTORE_CONTRACT_VERSION" = "2" ]; then
  node --input-type=module - \
    "$WORKDIR/managed-customizations-manifest.json" \
    "$WORKDIR/managed-customizations.restore-manifest.json" <<'NODE'
  import { readFile } from "node:fs/promises";

  const [expectedPath, actualPath] = process.argv.slice(2);
  const expected = JSON.parse(await readFile(expectedPath, "utf8"));
  const actual = JSON.parse(await readFile(actualPath, "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Managed-customizations manifest wijkt af van de voorbereide SQL");
  }
NODE
fi

echo "RESTORE_PHASE=validation_json"
VALIDATION_RESTORE_PATH="$WORKDIR/database-validation.restore.json"
node scripts/normalize-supabase-validation-json.mjs \
  --input "$WORKDIR/database-validation.json" \
  --output "$VALIDATION_RESTORE_PATH"
python3 - "$VALIDATION_RESTORE_PATH" "$RESTORE_CONTRACT_VERSION" <<'PY'
import json
import pathlib
import sys

validation = json.loads(pathlib.Path(sys.argv[1]).read_text())
contract_version = int(sys.argv[2])
manifest_version = validation.get("manifest_version")
if manifest_version not in {1, 2}:
    raise SystemExit("database-validation.json heeft een onbekende manifest_version")
if contract_version == 2 and manifest_version != 2:
    raise SystemExit("restorecontract 2 vereist database-validatiemanifest 2")
PY

# Follow Supabase's documented logical restore sequence in exactly one
# transaction. A failure in the portable Auth/Storage-customizations therefore
# rolls roles, schema and all data back as one atomic unit.
# session_replication_role=replica suppresses managed triggers during data load.
psql "$TARGET_DB_URL" \
  -X \
  --single-transaction \
  -v ON_ERROR_STOP=1 \
  -v VERBOSITY=sqlstate \
  -c '\echo RESTORE_PHASE=roles' \
  -f "$WORKDIR/roles.sql" \
  -c '\echo RESTORE_PHASE=schema' \
  -f "$WORKDIR/schema.sql" \
  -c '\echo RESTORE_PHASE=data' \
  -c "SET LOCAL session_replication_role = replica;" \
  -f "$WORKDIR/data.sql" \
  -c "SET LOCAL session_replication_role = origin;" \
  -c '\echo RESTORE_PHASE=managed_customizations' \
  -f "$WORKDIR/managed-customizations.restore.sql"

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Restore database groen: $FINISHED_AT"
echo "Fysieke Storage-bestanden zijn nog niet naar het doelproject geüpload."
echo "Voer daarna uit: TARGET_SUPABASE_URL=... TARGET_SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-supabase-storage.mjs --input-dir <uitgepakte-storage-map>"
