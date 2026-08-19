#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

: "${TARGET_DB_URL:?TARGET_DB_URL ontbreekt}"
: "${SOURCE_PROJECT_REF:?SOURCE_PROJECT_REF ontbreekt}"
: "${TARGET_PROJECT_REF:?TARGET_PROJECT_REF ontbreekt}"
: "${BACKUP_MARKER_KEY:?BACKUP_MARKER_KEY ontbreekt}"
: "${DB_SHA256:?DB_SHA256 ontbreekt}"

ACTION="${1:-}"
case "$ACTION" in
  storage_restored|technical_verified|functional_verified|finalize) ;;
  *) echo "RESTORE_STATE_UPDATE_REJECTED:action" >&2; exit 2 ;;
esac

[[ "$SOURCE_PROJECT_REF" =~ ^[a-z]{20}$ ]] || { echo "RESTORE_STATE_UPDATE_REJECTED:source" >&2; exit 2; }
[[ "$TARGET_PROJECT_REF" =~ ^[a-z]{20}$ ]] || { echo "RESTORE_STATE_UPDATE_REJECTED:target" >&2; exit 2; }
[[ "$BACKUP_MARKER_KEY" =~ ^backup-status/[0-9]{4}/[0-9]{2}/[0-9]{2}/manifest-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z\.json$ ]] || {
  echo "RESTORE_STATE_UPDATE_REJECTED:marker" >&2
  exit 2
}
[[ "$DB_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "RESTORE_STATE_UPDATE_REJECTED:database_sha" >&2; exit 2; }

if [ "$ACTION" = "finalize" ]; then
  RESULT="$(psql "$TARGET_DB_URL" -X -Atq -v ON_ERROR_STOP=1 \
    -v "source_ref=$SOURCE_PROJECT_REF" \
    -v "target_ref=$TARGET_PROJECT_REF" \
    -v "marker_key=$BACKUP_MARKER_KEY" \
    -v "database_sha=$DB_SHA256" <<'SQL'
with matching as (
  select count(*)::int as n
    from bestuurdersportaal_managed_restore_private.resume_state
   where singleton
     and contract_version = 1
     and source_project_ref = :'source_ref'
     and target_project_ref = :'target_ref'
     and backup_marker_key = :'marker_key'
     and database_sha256 = :'database_sha'
     and phase = 'functional_verified'
), dropped as (
  select case when n = 1 then 1 else 0 end as ok from matching
)
select ok from dropped;
SQL
)"
  [ "$RESULT" = "1" ] || { echo "RESTORE_STATE_UPDATE_REJECTED:binding" >&2; exit 1; }
  psql "$TARGET_DB_URL" -X -q -v ON_ERROR_STOP=1 -c \
    'drop schema bestuurdersportaal_managed_restore_private cascade;' >/dev/null
  echo "RESTORE_STATE_FINALIZED"
  exit 0
fi

RESULT="$(psql "$TARGET_DB_URL" -X -Atq -v ON_ERROR_STOP=1 \
  -v "source_ref=$SOURCE_PROJECT_REF" \
  -v "target_ref=$TARGET_PROJECT_REF" \
  -v "marker_key=$BACKUP_MARKER_KEY" \
  -v "database_sha=$DB_SHA256" \
  -v "next_phase=$ACTION" <<'SQL'
with updated as (
  update bestuurdersportaal_managed_restore_private.resume_state
     set phase = :'next_phase', updated_at = now()
   where singleton
     and contract_version = 1
     and source_project_ref = :'source_ref'
     and target_project_ref = :'target_ref'
     and backup_marker_key = :'marker_key'
     and database_sha256 = :'database_sha'
     and case :'next_phase'
       when 'storage_restored' then phase in ('database_restored', 'storage_restored', 'technical_verified', 'functional_verified')
       when 'technical_verified' then phase in ('storage_restored', 'technical_verified', 'functional_verified')
       when 'functional_verified' then phase in ('technical_verified', 'functional_verified')
       else false
     end
  returning 1
)
select count(*) from updated;
SQL
)"
[ "$RESULT" = "1" ] || { echo "RESTORE_STATE_UPDATE_REJECTED:binding_or_order" >&2; exit 1; }
echo "RESTORE_STATE_PHASE=$ACTION"
