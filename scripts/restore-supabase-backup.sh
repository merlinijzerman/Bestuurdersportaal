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

tar -xzf "$ARCHIVE_PATH" -C "$WORKDIR"
for file in roles.sql schema.sql data.sql auth-data.sql storage-data.sql managed-customizations.sql database-validation.json metadata.txt; do
  [ -s "$WORKDIR/$file" ] || { echo "Verplicht restorebestand ontbreekt of is leeg: $file" >&2; exit 1; }
done

SOURCE_PROJECT_REF="$(sed -n 's/^source_project=//p' "$WORKDIR/metadata.txt" | head -n 1)"
[ -n "$SOURCE_PROJECT_REF" ] || { echo "source_project ontbreekt in metadata.txt" >&2; exit 1; }
[ "$SOURCE_PROJECT_REF" != "$TARGET_PROJECT_REF" ] || {
  echo "Restore stopt: bron- en doelproject zijn gelijk ($TARGET_PROJECT_REF)." >&2
  exit 1
}

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

psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -Atc "select 1" >/dev/null

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Restore gestart: $STARTED_AT"
echo "Doelproject: $TARGET_PROJECT_REF"
echo "Bewijswerkmap: $WORKDIR"

restore_file() {
  local label="$1"
  local file="$2"
  local restore_role="${3:-}"
  echo "Restore: $label"
  if [ -n "$restore_role" ]; then
    case "$restore_role" in
      supabase_auth_admin|supabase_storage_admin) ;;
      *) echo "Restore stopt: niet-toegestane managed rol: $restore_role" >&2; exit 1 ;;
    esac
    psql "$TARGET_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
      -c "SET LOCAL ROLE $restore_role;" \
      -f "$WORKDIR/$file"
  else
    psql "$TARGET_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$WORKDIR/$file"
  fi
}

# The Supabase CLI data-only dump is the supported, combined restore source for
# public, Auth and Storage data. Prove those managed tables are present before
# the first target mutation; a partial dump must fail closed.
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
node scripts/prepare-supabase-managed-customizations.mjs \
  --input "$WORKDIR/managed-customizations.sql" \
  --output "$WORKDIR/managed-customizations.restore.sql"

# Follow Supabase's documented logical restore sequence in one transaction.
# session_replication_role=replica suppresses managed triggers while preserving
# the target project's managed schemas and ownership.
psql "$TARGET_DB_URL" \
  --single-transaction \
  -v ON_ERROR_STOP=1 \
  -f "$WORKDIR/roles.sql" \
  -f "$WORKDIR/schema.sql" \
  -c "SET session_replication_role = replica;" \
  -f "$WORKDIR/data.sql"

restore_file "managed Auth/Storage customizations" "managed-customizations.restore.sql"

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Restore database groen: $FINISHED_AT"
echo "Fysieke Storage-bestanden zijn nog niet naar het doelproject geüpload."
echo "Voer daarna uit: TARGET_SUPABASE_URL=... TARGET_SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-supabase-storage.mjs --input-dir <uitgepakte-storage-map>"
