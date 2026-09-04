#!/usr/bin/env bash
# ============================================================================
#  Test-DB schema-opbouw — baseline + migraties via psql (T5).
# ----------------------------------------------------------------------------
#  Achtergrond (besluit 0046): de repo-migraties dragen GEEN 14-cijferige
#  Supabase-CLI-timestamp in hun bestandsnaam (ze heten `2026_MM_DD_naam.sql`,
#  soms met intra-dag-lettersuffix `…20d`, `…20e`, `…20g`). De CLI-migratie-
#  tracker (`supabase db push`) verwacht dat timestampformaat en zou ze
#  overslaan. De oude `schema.sql` is documentatie en niet zelfstandig
#  replaybaar. Daarom bouwen we vanaf de gecontroleerde, schema-only dump van
#  Preview en passen we alleen migraties ná het vastgelegde cutoff-bestand toe.
#
#  Wat wél/niet wordt toegepast:
#    • EERST: supabase/baseline/2026_08_14_preview_public.sql.
#    • DAN  : alleen migraties die alfabetisch NA BASELINE_CUTOFF vallen.
#    • NIET: supabase/checks/*   (dat zijn de testsuites zelf, niet het schema).
#
#  Sinds de mapherindeling (ontwerpnotitie migratieproces v2.1, fase 1) bevat
#  supabase/migrations/ UITSLUITEND echte forward-migraties. Terugdraai-scripts
#  staan in supabase/rollbacks/, omgevingsseeds in supabase/seeds/preview/ en
#  schema-seeds in supabase/seeds/schema/. De naamfilters die hier stonden zijn
#  daarmee overbodig: de mapindeling dwingt de invariant af in plaats van een
#  filterregel die iemand kan vergeten. De guard hieronder bewaakt dat.
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
ROLLBACK_DIR="supabase/rollbacks"
SEED_PREVIEW_DIR="supabase/seeds/preview"
SEED_SCHEMA_DIR="supabase/seeds/schema"
BASELINE="supabase/baseline/2026_08_14_preview_public.sql"
BASELINE_AUTH_HOOKS="supabase/baseline/2026_08_14_auth_hooks.sql"
BASELINE_STORAGE="supabase/baseline/2026_08_14_storage_custom.sql"
BASELINE_CUTOFF="2026_08_14_security_grant_hygiene_late_recreate.sql"

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

if [ ! -f "$BASELINE" ]; then
  echo "FOUT: baseline '$BASELINE' niet gevonden." >&2
  exit 1
fi

if [ ! -f "$BASELINE_AUTH_HOOKS" ]; then
  echo "FOUT: auth-hooks '$BASELINE_AUTH_HOOKS' niet gevonden." >&2
  exit 1
fi

if [ ! -f "$BASELINE_STORAGE" ]; then
  echo "FOUT: storage-baseline '$BASELINE_STORAGE' niet gevonden." >&2
  exit 1
fi

# Guard (fase 1, ontwerpnotitie migratieproces v2.1): migrations/ mag geen
# rollback- of seedbestand bevatten. Dit is de runtime-tegenhanger van de
# CI-check; hij faalt vroeg en met een bruikbare boodschap in plaats van een
# rollback halverwege de replay toe te passen.
ONGELDIG="$(find "$MIGRATIE_DIR" -maxdepth 1 -name '*.sql' \
  \( -name '*ROLLBACK*' -o -name '*seed*' \) | LC_ALL=C sort)"
if [ -n "$ONGELDIG" ]; then
  echo "FOUT: $MIGRATIE_DIR bevat rollback- of seedbestanden:" >&2
  echo "$ONGELDIG" | sed 's/^/  /' >&2
  echo "Verplaats ze naar $ROLLBACK_DIR, $SEED_PREVIEW_DIR of $SEED_SCHEMA_DIR." >&2
  exit 1
fi

# Verzamel alleen forward-migraties ná het baseline-cutoff. De while-vorm werkt
# zowel op macOS Bash 3.2 als op de nieuwere Bash van de CI-runner.
MIGRATIES=()
while IFS= read -r f; do
  naam="$(basename "$f")"
  if [[ "$naam" > "$BASELINE_CUTOFF" ]]; then
    MIGRATIES+=("$f")
  fi
done < <(find "$MIGRATIE_DIR" -maxdepth 1 -name '*.sql' | LC_ALL=C sort)

echo "Extensies voor de Preview-baseline gereedmaken…"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
create extension if not exists vector with schema public;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
SQL

echo "Gesquashte Preview-baseline toepassen op de test-DB…"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$BASELINE"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$BASELINE_AUTH_HOOKS"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$BASELINE_STORAGE"
echo "OK: baseline toegepast."
echo

# De Microsoft-migratie faalt bewust wanneer de aparte kluislogin niet vooraf
# is geprovisioneerd. Deze runner werkt uitsluitend op een ephemere test-DB, dus
# maakt hier een wachtwoordloze fixture met exact dezelfde minimale rolflags.
# Preview/Productie blijven een afzonderlijk, beheerd wachtwoord vereisen.
echo "Ephemere database-loginfixtures gereedmaken…"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'microsoft_vault') then
    create role microsoft_vault
      login
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls
      connection limit 5;
  end if;
  -- #311 T2 — de AI-gateway heeft dezelfde minimale loginvorm (security/AI-GATEWAY-RUNBOOK.md).
  if not exists (select 1 from pg_roles where rolname = 'ai_gateway') then
    create role ai_gateway
      login
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls
      connection limit 5;
  end if;
end
$$;
SQL
echo "OK: ephemere loginfixtures aanwezig."
echo

echo "Voorwaartse migraties ná $BASELINE_CUTOFF toepassen (${#MIGRATIES[@]} bestanden)…"
if [ "${#MIGRATIES[@]}" -gt 0 ]; then
  for f in "${MIGRATIES[@]}"; do
    echo "  › $(basename "$f")"
    # ON_ERROR_STOP: de eerste falende migratie breekt de apply af (fail-fast).
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  done
fi

echo
echo "OK: baseline + ${#MIGRATIES[@]} post-baseline-migraties toegepast (rollbacks/, seeds/ en checks/ liggen buiten migrations/)."
echo
echo "LET OP: de baseline is schema-only — er staan geen GEPUBLICEERDE requirement-"
echo "rijen, dus een migratie die I7-bevroren rijen row-DML't wordt hier stil groen"
echo "(P3-bevinding #168). Pas vóór de tranche-FRF de I7-fixture toe zodat het"
echo "bevroren pad wél geraakt wordt:"
echo "    psql \"\$DB\" -v ON_ERROR_STOP=1 -f scripts/testdb-i7-fixture.sql"
