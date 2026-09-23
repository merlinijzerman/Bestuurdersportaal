#!/usr/bin/env bash
# ============================================================================
#  #440 — herbouwt de verwachte stand en het driftscript uit de repo.
# ----------------------------------------------------------------------------
#  Draai dit opnieuw na ELKE migratie die de catalogus verandert; anders meet
#  het driftscript tegen een verouderde verwachting en meldt het drift die er
#  niet is (of erger: geen drift die er wél is).
#
#  Vereist een EPHEMERE referentie-DB die met scripts/testdb-apply-migrations.sh
#  uit supabase/migrations/ is opgebouwd. NOOIT een live omgeving als
#  referentie: dan meet je de werkelijkheid tegen zichzelf.
#
#  Gebruik:
#    bash scripts/start-ephemeral-supabase.sh
#    TEST_DATABASE_URL='postgresql://…' bash scripts/testdb-apply-migrations.sh
#    TEST_DATABASE_URL='postgresql://…' bash scripts/drift/genereer.sh
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

DB_URL="${TEST_DATABASE_URL:-${DATABASE_URL:-}}"
[ -n "$DB_URL" ] || { echo "FOUT: TEST_DATABASE_URL of DATABASE_URL vereist." >&2; exit 1; }

# Veiligheidsslot: de referentie mag nooit een omgeving met een echte host zijn.
if psql "$DB_URL" -tAc "select 1 from public.tenant_domains where host like '%bestuurdersportaal.com' limit 1" 2>/dev/null | grep -q 1; then
  echo "FOUT: deze database draagt een tenant-host en is dus geen wegwerp-referentie." >&2
  exit 1
fi

echo "→ vingerafdrukken meten op de referentie-DB"
psql "$DB_URL" -tAF$'\t' -f scripts/drift/vingerafdruk.sql \
  | python3 scripts/drift/genereer-verwachte-stand.py

echo "→ driftscript bouwen"
python3 scripts/drift/bouw-driftscript.py

echo "KLAAR. Gegenereerd:"
echo "  supabase/checks/440-verwachte-stand.generated.tsv"
echo "  supabase/checks/440-migraties-zonder-kenmerk.generated.tsv"
echo "  supabase/checks/2026_09_23_440_driftinventarisatie.generated.sql"
