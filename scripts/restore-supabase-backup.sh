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
  echo "Restore: $label"
  psql "$TARGET_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$WORKDIR/$file"
}

# pg_dump --disable-triggers emits ALTER TABLE ... TRIGGER ALL statements.
# Supabase intentionally keeps managed Auth/Storage table ownership on its
# service roles, so a normal project postgres connection cannot execute those
# statements. Prepare a restore-only copy that removes exactly those generated
# toggles and refuses any unexpected trigger DDL. The original evidence remains
# untouched. Future dumps no longer request --disable-triggers, and therefore
# pass through this preparation byte-for-byte.
node scripts/prepare-supabase-managed-data-restore.mjs \
  --schema auth \
  --input "$WORKDIR/auth-data.sql" \
  --output "$WORKDIR/auth-data.restore.sql"
node scripts/prepare-supabase-managed-data-restore.mjs \
  --schema storage \
  --input "$WORKDIR/storage-data.sql" \
  --output "$WORKDIR/storage-data.restore.sql"

# Managed schemas already exist in a new Supabase project. Auth data must be
# restored before public data because profielen and audit rows reference it.
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f "$WORKDIR/roles.sql"
restore_file "public schema" "schema.sql"
restore_file "Auth-data" "auth-data.restore.sql"
restore_file "Storage-metadata" "storage-data.restore.sql"
restore_file "public data" "data.sql"
restore_file "managed Auth/Storage customizations" "managed-customizations.sql"

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Restore database groen: $FINISHED_AT"
echo "Fysieke Storage-bestanden zijn nog niet naar het doelproject geüpload."
echo "Voer daarna uit: TARGET_SUPABASE_URL=... TARGET_SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-supabase-storage.mjs --input-dir <uitgepakte-storage-map>"
