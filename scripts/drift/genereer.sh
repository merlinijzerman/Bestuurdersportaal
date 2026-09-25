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

# Relatieve tempmap: sommige psql-opstellingen zien host-paden buiten de
# werkmap niet.
TMPQ=".440-gen.$$"
mkdir -p "$TMPQ"
trap 'rm -rf "$TMPQ"' EXIT

echo "→ vingerafdrukken meten op de referentie-DB"
psql "$DB_URL" -tAF$'\t' -f scripts/drift/vingerafdruk.sql \
  | python3 scripts/drift/genereer-verwachte-stand.py

echo "→ gedropte objecten verzamelen en filteren"
# Twee passes: eerst de kandidaten, dan natrekken welke na de VOLLEDIGE keten
# nog bestaan (drop-gevolgd-door-create), en die uitsluiten. Zonder die tweede
# pass meldt de afwezigheidscontrole valse bevindingen op een omgeving waar
# alles correct is toegepast — gemeten: 8 van de 16.
python3 scripts/drift/verzamel-drops.py >/dev/null
python3 - > "$TMPQ/aanwezig.sql" <<'PYQ'
import io
uit = []
for r in io.open("supabase/checks/440-afwezig-kandidaten.generated.tsv", encoding="utf-8"):
    r = r.strip()
    if not r:
        continue
    soort, obj = r.split("\t")
    fn = "to_regprocedure" if soort == "FUNC" else "to_regclass"
    uit.append(f"select '{obj}' where {fn}('{obj}') is not null")
io.open("/dev/stdout", "w", encoding="utf-8").write(" union all ".join(uit) + ";\n")
PYQ
psql "$DB_URL" -tA -f "$TMPQ/aanwezig.sql" > "$TMPQ/aanwezig.txt" 2>/dev/null || true
python3 scripts/drift/verzamel-drops.py "$TMPQ/aanwezig.txt"

echo "→ driftscript bouwen"
python3 scripts/drift/bouw-driftscript.py

echo "KLAAR. Gegenereerd:"
echo "  supabase/checks/440-verwachte-stand.generated.tsv"
echo "  supabase/checks/440-migraties-zonder-kenmerk.generated.tsv"
echo "  supabase/checks/440-afwezig-verwacht.generated.tsv"
echo "  supabase/checks/2026_09_23_440_driftinventarisatie.generated.sql"
echo "  supabase/checks/2026_09_23_440_driftinventarisatie_productie.generated.sql"
echo
echo "LET OP: draai scripts/drift/historische-vormen.sh op een VERSE wegwerp-DB"
echo "        om 440-historische-vormen.generated.tsv bij te werken; die bevat"
echo "        de duiding 'doel draagt nog de vorm van <migratie>'."
