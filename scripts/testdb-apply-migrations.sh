#!/usr/bin/env bash
# ============================================================================
#  Test-DB migratie-apply — psql-toepassing van supabase/migrations/ (T5).
# ----------------------------------------------------------------------------
#  Achtergrond (besluit 0046): de repo-migraties dragen GEEN 14-cijferige
#  Supabase-CLI-timestamp in hun bestandsnaam (ze heten `2026_MM_DD_naam.sql`,
#  soms met intra-dag-lettersuffix `…20d`, `…20e`, `…20g`). De CLI-migratie-
#  tracker (`supabase db push`) verwacht dat timestampformaat en zou ze
#  overslaan. Daarom passen we ze deterministisch met psql toe, in
#  gesorteerde bestandsnaamvolgorde — die volgorde IS de bedoelde chronologie
#  (datumprefix + bewuste lettersuffix voor intra-dag-ordening).
#
#  Wat wél/niet wordt toegepast:
#    • WEL : supabase/migrations/*.sql, alfabetisch gesorteerd (= chronologisch).
#    • NIET: *_ROLLBACK.sql (terugdraai-scripts, geen forward-migratie).
#    • NIET: supabase/checks/*   (dat zijn de testsuites zelf, niet het schema).
#
#  Draait tegen een EPHEMERE test-DB (Supabase CLI in CI, of een lokale
#  wegwerp-DB). NOOIT tegen productie: elke migratie muteert het schema.
#
#  DB-URL via de omgeving (voorkeursvolgorde):
#     TEST_DATABASE_URL  — aparte, wegwerpbare test-DB (aanbevolen)
#     DATABASE_URL       — fallback
#
#  Gebruik:  TEST_DATABASE_URL='postgresql://…' bash scripts/testdb-apply-migrations.sh
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL="${TEST_DATABASE_URL:-${DATABASE_URL:-}}"
MIGRATIE_DIR="supabase/migrations"

if [ -z "$DB_URL" ]; then
  echo "FOUT: geen TEST_DATABASE_URL/DATABASE_URL gezet — geen doel-DB om migraties op toe te passen." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "FOUT: psql niet gevonden op PATH." >&2
  exit 1
fi

if [ ! -d "$MIGRATIE_DIR" ]; then
  echo "FOUT: migratie-map '$MIGRATIE_DIR' niet gevonden." >&2
  exit 1
fi

# Verzamel de forward-migraties in gesorteerde (= chronologische) volgorde,
# met uitsluiting van de *_ROLLBACK.sql-terugdraaiscripts. LC_ALL=C forceert een
# deterministische byte-sort (geen locale-afhankelijke volgorde in CI vs lokaal).
mapfile -t MIGRATIES < <(find "$MIGRATIE_DIR" -maxdepth 1 -name '*.sql' ! -name '*_ROLLBACK.sql' | LC_ALL=C sort)

if [ "${#MIGRATIES[@]}" -eq 0 ]; then
  echo "FOUT: geen migratiebestanden gevonden in '$MIGRATIE_DIR'." >&2
  exit 1
fi

echo "Migraties toepassen op de test-DB (${#MIGRATIES[@]} bestanden, gesorteerd)…"
for f in "${MIGRATIES[@]}"; do
  echo "  › $(basename "$f")"
  # ON_ERROR_STOP: de eerste falende migratie breekt de hele apply af (fail-fast).
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo
echo "OK: alle ${#MIGRATIES[@]} forward-migraties toegepast (ROLLBACK-scripts en checks/ overgeslagen)."
