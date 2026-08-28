#!/usr/bin/env bash
# ============================================================================
#  Nightly Preview-fidelity — uitsluitend read-only cataloguscontrole.
# ----------------------------------------------------------------------------
#  Deze runner gebruikt de bestaande vaste Preview, maar behandelt haar NOOIT
#  als test-DB: geen baseline, migraties, seeds of muterende regressies. De rol
#  drift_lezer kan geen fondsdata of storage-objecten lezen en heeft geen DDL- of
#  tabelrechten. PGOPTIONS forceert bovendien iedere sessie read-only.
# ============================================================================
set -Eeuo pipefail
cd "$(dirname "$0")/.."

: "${PREVIEW_DATABASE_URL:?preview_fidelity_config_missing}"
: "${EXPECTED_PREVIEW_REF:?preview_fidelity_config_missing}"

MOMENTOPNAME="supabase/checks/2026_08_19_drift_momentopname.sql"
VERWACHT="supabase/checks/drift-momentopname-verwacht.txt"
ACTUEEL="preview-fidelity-snapshot.txt"
VERSCHIL="preview-fidelity-diff.txt"
WERKMAP="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/preview-fidelity.XXXXXX")"
trap 'rm -rf "$WERKMAP"' EXIT

test -f "$MOMENTOPNAME" || { echo "FOUT: momentopname ontbreekt." >&2; exit 1; }
test -f "$VERWACHT" || { echo "FOUT: goedgekeurde verwachting ontbreekt." >&2; exit 1; }
command -v psql >/dev/null || { echo "FOUT: psql ontbreekt." >&2; exit 1; }

# Zelfs als de rol later per ongeluk ruimer wordt, weigert PostgreSQL mutaties
# in deze sessies. De catalogus- en bucketdefinitiequery's blijven toegestaan.
export PGOPTIONS="-c default_transaction_read_only=on"

echo "Read-only rol en doelrechten controleren…"
ROLSTAAT="$(psql "$PREVIEW_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
select concat_ws('|', current_user, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole)
from pg_roles where rolname = current_user;
SQL
)"
test "$ROLSTAAT" = "drift_lezer|f|f|f|f" || {
  echo "FOUT: Preview-fidelityrol ontbreekt of is te ruim." >&2
  exit 1
}

PUBLIC_GRANTS="$(psql "$PREVIEW_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
select count(*)
from information_schema.role_table_grants
where grantee = current_user and table_schema = 'public';
SQL
)"
test "$PUBLIC_GRANTS" = "0" || {
  echo "FOUT: Preview-fidelityrol heeft onverwachte public-tabelrechten." >&2
  exit 1
}

if psql "$PREVIEW_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
  -c "select 1 from public.profielen limit 1" >/dev/null 2>&1; then
  echo "FOUT: Preview-fidelityrol kan fondsdata lezen." >&2
  exit 1
fi
if psql "$PREVIEW_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
  -c "select 1 from storage.objects limit 1" >/dev/null 2>&1; then
  echo "FOUT: Preview-fidelityrol kan storage-objecten lezen." >&2
  exit 1
fi
if psql "$PREVIEW_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
  -c "insert into public.fondsen default values" >/dev/null 2>&1; then
  echo "FOUT: Preview-fidelityrol kan muteren." >&2
  exit 1
fi
echo "OK: rol is least-privilege en mutaties zijn fail-closed."

echo "Preview-catalogus ophalen…"
psql "$PREVIEW_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
  -f "$MOMENTOPNAME" > "$ACTUEEL"

REGELS="$(wc -l < "$ACTUEEL" | tr -d ' ')"
test "$REGELS" -ge 100 || {
  echo "FOUT: Preview-momentopname is onverwacht leeg of onvolledig." >&2
  exit 1
}

# Alleen omgevingsonafhankelijke categorieën vergelijken. Buckets en extensies
# mogen bewust afwijken tussen Preview en Productie; functies, policies, RLS,
# publications en browser-EXECUTE-rechten niet.
SCHEMA_CATEGORIEEN='^(functie|policy|rls|publication|execute)\|'
grep -E "$SCHEMA_CATEGORIEEN" "$VERWACHT" | LC_ALL=C sort > "$WERKMAP/verwacht.txt"
grep -E "$SCHEMA_CATEGORIEEN" "$ACTUEEL" | LC_ALL=C sort > "$WERKMAP/actueel.txt"

if ! diff -u "$WERKMAP/verwacht.txt" "$WERKMAP/actueel.txt" > "$VERSCHIL"; then
  echo "FOUT: Preview wijkt af van de goedgekeurde schema-/securitymomentopname." >&2
  echo "Bekijk het artefact preview-fidelity-diff; de console toont geen database-inhoud." >&2
  exit 1
fi
rm -f "$VERSCHIL"

echo "GROEN: Preview-fidelity is read-only en schema/security zijn conform."
echo "  Doel: Preview-project ${EXPECTED_PREVIEW_REF}"
echo "  Catalogusregels: ${REGELS}"
echo "  Fondsdata/storage-objecten: niet leesbaar"
echo "  DDL, seeds en muterende regressies: niet uitgevoerd"
