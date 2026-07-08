#!/usr/bin/env bash
# ============================================================================
#  T3 — Negatieve cross-tenant RLS-testrunner (controlekader, v0.4 §14 punt 7)
# ----------------------------------------------------------------------------
#  Draait supabase/checks/2026_07_08_t3_cross_tenant.sql via psql tegen een
#  test-database. DEEL 1 (structureel) faalt zodra een tenant-schrijf-policy
#  geen WITH CHECK heeft of een audit-log de append-only-trigger mist; DEEL 2
#  (gedrag) bewijst dat cross-tenant schrijfpogingen door RLS worden geweigerd.
#  Elke overtreding → `raise exception` → psql exit <> 0 → deze runner faalt.
#
#  DB-URL via de omgeving (in volgorde van voorkeur):
#     TEST_DATABASE_URL   — aparte, wegwerpbare test-DB (aanbevolen; DEEL 2 seedt
#                           en rolt terug, maar draai NOOIT tegen productie)
#     DATABASE_URL        — fallback
#
#  Gebruik lokaal:  TEST_DATABASE_URL='postgresql://…' bash scripts/rls-cross-tenant-test.sh
#  In CI: zie .github/workflows/rls-cross-tenant.yml (non-blocking tot T5).
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL="${TEST_DATABASE_URL:-${DATABASE_URL:-}}"
SQL="supabase/checks/2026_07_08_t3_cross_tenant.sql"

if [ -z "$DB_URL" ]; then
  echo "OVERGESLAGEN: geen TEST_DATABASE_URL/DATABASE_URL gezet."
  echo "  Zet een wegwerpbare test-DB-URL om de cross-tenant RLS-suite te draaien."
  # Exit 0: afwezigheid van een test-DB mag de commit/CI (nog) niet blokkeren (T5).
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "OVERGESLAGEN: psql niet gevonden op PATH."
  exit 0
fi

echo "T3 cross-tenant RLS-suite draaien tegen de test-DB…"
# ON_ERROR_STOP staat ook in het script; hier extra als vangnet.
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL"
echo
echo "OK: T3 cross-tenant RLS-suite groen (geen lek, append-only intact)."
