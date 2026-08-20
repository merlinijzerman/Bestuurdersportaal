#!/usr/bin/env bash

# Restore physical Supabase Storage bytes without losing the owner/metadata
# rows that were already recovered by the database restore. The private
# snapshot deliberately remains in the target database after an interrupted
# upload so a retry can still reconcile against the original values.

set -Eeuo pipefail
umask 077

usage() {
  echo "Gebruik: TARGET_DB_URL=... TARGET_PROJECT_REF=... TARGET_SUPABASE_URL=... TARGET_SUPABASE_ADMIN_KEY=... $0 <uitgepakte-storage-map> [restore-flags]" >&2
  exit 2
}

INPUT_DIR="${1:-}"
[ -n "$INPUT_DIR" ] || usage
shift
[ -s "$INPUT_DIR/storage-manifest.json" ] || {
  echo "Storage-restore stopt: storage-manifest.json ontbreekt." >&2
  exit 1
}

: "${TARGET_DB_URL:?TARGET_DB_URL ontbreekt}"
: "${TARGET_PROJECT_REF:?TARGET_PROJECT_REF ontbreekt}"
: "${TARGET_SUPABASE_URL:?TARGET_SUPABASE_URL ontbreekt}"
if [ -n "${TARGET_SUPABASE_ADMIN_KEY:-}" ] && \
   [ -n "${TARGET_SUPABASE_SERVICE_ROLE_KEY:-}" ] && \
   [ "$TARGET_SUPABASE_ADMIN_KEY" != "$TARGET_SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "Storage-restore stopt: admin- en legacy service-role-input verschillen." >&2
  exit 1
fi
TARGET_SUPABASE_ADMIN_KEY="${TARGET_SUPABASE_ADMIN_KEY:-${TARGET_SUPABASE_SERVICE_ROLE_KEY:-}}"
: "${TARGET_SUPABASE_ADMIN_KEY:?TARGET_SUPABASE_ADMIN_KEY ontbreekt}"
export TARGET_SUPABASE_ADMIN_KEY

SOURCE_PROJECT_REF="$(node --input-type=module - "$INPUT_DIR/storage-manifest.json" <<'NODE'
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(process.argv[2], "utf8"));
if (typeof manifest.source_project !== "string" || !manifest.source_project) {
  throw new Error("source_project ontbreekt in storage-manifest.json");
}
process.stdout.write(manifest.source_project);
NODE
)"

[[ "$SOURCE_PROJECT_REF" =~ ^[a-z]{20}$ ]] || {
  echo "Storage-restore stopt: source_project heeft niet het verwachte formaat." >&2
  exit 1
}
if [ "$TARGET_PROJECT_REF" != "local" ]; then
  [[ "$TARGET_PROJECT_REF" =~ ^[a-z]{20}$ ]] || {
    echo "Storage-restore stopt: TARGET_PROJECT_REF heeft niet het verwachte formaat." >&2
    exit 1
  }
  [ "$SOURCE_PROJECT_REF" != "$TARGET_PROJECT_REF" ] || {
    echo "Storage-restore stopt: bron- en doelproject zijn gelijk." >&2
    exit 1
  }
  case "$TARGET_SUPABASE_URL" in
    *"$TARGET_PROJECT_REF"*) ;;
    *)
      echo "Storage-restore stopt: TARGET_SUPABASE_URL verwijst niet aantoonbaar naar TARGET_PROJECT_REF." >&2
      exit 1
      ;;
  esac
  python3 - "$TARGET_DB_URL" "$TARGET_PROJECT_REF" <<'PY'
from urllib.parse import urlsplit
import sys

url, project_ref = sys.argv[1:]
parsed = urlsplit(url)
if project_ref not in (parsed.hostname or "") and project_ref not in (parsed.username or ""):
    raise SystemExit("Storage-restore stopt: TARGET_DB_URL verwijst niet aantoonbaar naar TARGET_PROJECT_REF.")
PY
fi

echo "STORAGE_PHASE=metadata_capture" >&2
SNAPSHOT_STATE="$(psql "$TARGET_DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "
  select concat_ws(':',
    (to_regnamespace('bestuurdersportaal_restore_private') is not null)::integer,
    (to_regclass('bestuurdersportaal_restore_private.snapshot_state') is not null)::integer,
    (to_regclass('bestuurdersportaal_restore_private.storage_objects_metadata') is not null)::integer
  );
")"

case "$SNAPSHOT_STATE" in
  0:0:0)
    psql "$TARGET_DB_URL" -X -q -v ON_ERROR_STOP=1 \
      -v source_project_ref="$SOURCE_PROJECT_REF" \
      -v target_project_ref="$TARGET_PROJECT_REF" \
      -f scripts/capture-supabase-storage-metadata.sql >/dev/null
    ;;
  1:1:1)
    SNAPSHOT_VALID="$(psql "$TARGET_DB_URL" -X -qAt -v ON_ERROR_STOP=1 \
      -v source_project_ref="$SOURCE_PROJECT_REF" \
      -v target_project_ref="$TARGET_PROJECT_REF" -c "
        select case when (
          select count(*) = 1
            and bool_and(source_project_ref = :'source_project_ref')
            and bool_and(target_project_ref = :'target_project_ref')
            and bool_and(object_count = (
              select count(*)
              from bestuurdersportaal_restore_private.storage_objects_metadata
            ))
            and not exists (
              select 1
              from storage.objects target
              full join bestuurdersportaal_restore_private.storage_objects_metadata source
                using (bucket_id, name)
              where target.bucket_id is null or source.bucket_id is null
            )
          from bestuurdersportaal_restore_private.snapshot_state
          where contract_version = 1
        ) then 'valid' else 'invalid' end;
      ")"
    [ "$SNAPSHOT_VALID" = "valid" ] || {
      echo "Storage-restore stopt: bewaarde metadata-snapshot hoort niet aantoonbaar bij deze restore." >&2
      exit 1
    }
    ;;
  *)
    echo "Storage-restore stopt: private metadata-snapshot is onvolledig of botst met een bestaande schema-naam." >&2
    exit 1
    ;;
esac

echo "STORAGE_PHASE=physical_restore" >&2
STORAGE_RESULT="$(node scripts/restore-supabase-storage.mjs --input-dir "$INPUT_DIR" "$@")"

echo "STORAGE_PHASE=metadata_reconcile" >&2
psql "$TARGET_DB_URL" -X -q -v ON_ERROR_STOP=1 \
  -v source_project_ref="$SOURCE_PROJECT_REF" \
  -v target_project_ref="$TARGET_PROJECT_REF" \
  -f scripts/reconcile-supabase-storage-metadata.sql >/dev/null

printf '%s\n' "$STORAGE_RESULT"
