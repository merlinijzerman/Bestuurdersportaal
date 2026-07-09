#!/usr/bin/env bash
# ============================================================================
#  §15 cross-tenant testsuite — één orkestratie-entrypoint (increment T5).
# ----------------------------------------------------------------------------
#  Bundelt de VOLLEDIGE §15-matrix (T1–T14, beslisnotitie v0.4) tot één rood/
#  groen-uitkomst, zodat tenant-isolatie aantoonbaar en regressievast is vóór
#  de onboarding van fonds 2 (gate G2/T7). Dit is HET verplichte verificatie-
#  commando bij elke wijziging aan een tenant-pad (zie T3-RLS-CONTROLEKADER §7).
#
#  Wat draait, in volgorde (fail-fast — set -e):
#    [1] tsc --noEmit --skipLibCheck        — typecheck (CLAUDE.md-gate).
#    [2] app-laag §15-matrix (node:test)    — T1–T5, T8–T14 als benoemde tests,
#                                             incl. de negatieve controles.
#    [3] migraties → test-DB                — schema opbouwen (psql-apply).
#    [4] DB-laag §15-matrix (psql)          — T3+T4 write-isolatie + T6/T7
#                                             export/storage; elke "LEK:" → rood.
#
#  Negatieve controle (besluit 0046 §E, T3-kader §8): elk scenario bewijst dat
#  een geïntroduceerd lek de test ROOD maakt — app-laag via de meegeleverde
#  negatieve-controle-tests, DB-laag via het `raise exception 'LEK:…'`-patroon.
#  Zulke lek-varianten worden NOOIT naar main gecommit.
#
#  Test-DB (stap 3–4) vereist een wegwerpbare DB via de omgeving:
#     TEST_DATABASE_URL  (voorkeur)  of  DATABASE_URL  (fallback).
#  In CI levert `supabase start` die DB; daar staat XTENANT_REQUIRE_DB=1 zodat
#  het ontbreken van een DB de suite ROOD maakt (blokkerend). Lokaal zónder DB
#  draait alleen de app-laag (stap 1–2) en meldt de suite de DB-laag als
#  overgeslagen — handig voor een snelle pre-commit-check.
#
#  Gebruik lokaal (app-laag):     bash scripts/cross-tenant-ci.sh
#  Gebruik lokaal (volledig):     TEST_DATABASE_URL='postgresql://…' bash scripts/cross-tenant-ci.sh
#  In CI:                         zie .github/workflows/rls-cross-tenant.yml
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

SQL_T5="supabase/checks/2026_07_09_t5_export_storage.sql"
# Increment T6 — generieke contentlaag read-only + namespace-invariant. (Let op:
# de "T6-export"-regel hieronder is een §15-matrixlabel, niet dit increment.)
SQL_T6C="supabase/checks/2026_07_09_t6_generiek_readonly.sql"

echo "== [1/4] tsc --noEmit --skipLibCheck =="
./node_modules/.bin/tsc --noEmit --skipLibCheck
echo "OK: typecheck groen."
echo

echo "== [2/4] app-laag §15-matrix (node:test): T1–T5, T8–T14 =="
node --import tsx --test tests/cross-tenant/*.test.ts
echo "OK: app-laag §15-matrix groen (incl. negatieve controles)."
echo

DB_URL="${TEST_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  if [ "${XTENANT_REQUIRE_DB:-0}" = "1" ]; then
    echo "FOUT: XTENANT_REQUIRE_DB=1 maar geen TEST_DATABASE_URL/DATABASE_URL gezet." >&2
    echo "  De DB-laag (T3/T4/T6/T7) is verplicht in deze context en MOET draaien." >&2
    exit 1
  fi
  echo "== DB-laag (stap 3–4) OVERGESLAGEN: geen test-DB gezet =="
  echo "  Zet TEST_DATABASE_URL voor de volledige suite (T3/T4/T6/T7 onder échte RLS)."
  echo
  echo "GROEN (app-laag). LET OP: de DB-laag draaide niet — niet volledig in deze run."
  exit 0
fi

echo "== [3/4] migraties toepassen op de test-DB =="
bash scripts/testdb-apply-migrations.sh
echo

echo "== [4/4] DB-laag §15-matrix (psql) =="
echo "-- T3 (write-isolatie) + T4 (retrieval-fondsdiscipline T11–T14) --"
bash scripts/rls-cross-tenant-test.sh
echo
echo "-- T6/T7 (export + storage cross-tenant) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T5"
echo
echo "-- T6 (generieke contentlaag read-only + namespace-invariant) --"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_T6C"
echo

echo "============================================================================"
echo "GROEN: volledige §15 cross-tenant suite geslaagd (app-laag + DB-laag)."
echo "  T1–T4  host→fonds + fail-closed enforce      (app-laag)"
echo "  T5/T8  auditfonds server-side afgeleid        (app-laag guard + DB append-only)"
echo "  T9/T10 platform-routing surface-isolatie      (app-laag)"
echo "  T11–14 RAG-fondsdiscipline                     (app-laag + DB DEEL 2)"
echo "  T3-write / T6-export / T7-storage             (DB-laag onder échte RLS)"
echo "  T6-content generieke read-only + namespace    (DB-laag onder échte RLS)"
echo "============================================================================"
