#!/usr/bin/env bash
# ============================================================================
# R1b — volledige draaiboekcyclus, UITSLUITEND lokaal (PR0-wegwerpdatabase).
# Doorloopt de echte ops-scripts in draaiboekvolgorde en eindigt in de
# beginstand: guard-negatieven → H4a → H4b (lock_timeout bij open write, dan
# opnieuw) → P1 → P2 → P5 → H → beginstand. Nooit op Preview/Productie.
#
#   bash tests/karakterisering/r1b-draaiboek-cyclus-lokaal.sh postgresql://postgres:postgres@127.0.0.1:54322/postgres
# Vereist `psql` in PATH (autocommit) en de stand: beide HNSW-indexen geldig + R1b-functie.
#
# Vangnet (EXIT-trap): bij ELKE fout wordt eerst de achtergrondschrijver
# beëindigd en uitgewacht, daarna de volledige index hersteld via fase H; lukt
# dat niet, dan eindigt het script met een expliciete INCIDENT-melding. De
# oorspronkelijke exitcode blijft altijd behouden.
# Testhaak (alleen voor de faalpadproef): R1B_CYCLUS_FAAL_NA=open_write|P5
# laat het script op dat punt opzettelijk falen.
# ============================================================================
set -euo pipefail
DB="${1:?lokale database-URL vereist}"
case "$DB" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "r1b-cyclus weigert: alleen een loopback-URL" >&2; exit 2 ;;
esac
OPS=scripts/ops/r1b
CHECK=supabase/checks/2026_10_09_r1b_indexstand_readonly.sql
q() { psql "$DB" -X -q -v ON_ERROR_STOP=1 "$@"; }
stand() { psql "$DB" -X -A -t -F'|' -c "$(cat "$CHECK")" | awk -F'|' '{print "  volledig=" $1 " partieel=" $4 " ongeldig=" $7 " r1b_functie=" $9 " minstens_een=" $11}'; }
weigert() { # weigert <omschrijving> <verwachte tekst> <psql-args…>
  local oms="$1" tekst="$2"; shift 2
  local uit
  if uit="$(q "$@" 2>&1)"; then echo "FOUT: $oms werd NIET geweigerd" >&2; exit 1; fi
  grep -q "$tekst" <<<"$uit" || { echo "FOUT: $oms weigerde om een andere reden: $uit" >&2; exit 1; }
  echo "OK  weigert: $oms"
}
ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
HOUDER_APP=r1b_cyclus_houder
HOUDER=""
faalhaak() { if [ "${R1B_CYCLUS_FAAL_NA:-}" = "$1" ]; then echo "TESTHAAK: opzettelijke fout na '$1'" >&2; return 97; fi; }

vangnet() {
  local rc=$?
  trap - EXIT
  set +e
  if [ "$rc" -ne 0 ]; then
    echo "== VANGNET (oorspronkelijke exitcode $rc)" >&2
    # 1. De schrijver eerst: backend beëindigen, client uitwachten.
    psql "$DB" -X -q -A -t -c "select count(pg_catalog.pg_terminate_backend(pid)) from pg_catalog.pg_stat_activity where application_name = '$HOUDER_APP'" >&2
    if [ -n "$HOUDER" ]; then wait "$HOUDER" 2>/dev/null; fi
    local rest
    rest=$(psql "$DB" -X -A -t -c "select count(*) from pg_catalog.pg_stat_activity where application_name = '$HOUDER_APP'")
    echo "   resterende schrijverbackends: $rest" >&2
    # 2. Dan de volledige index: herstel via fase H als hij niet geldig is.
    local geldig
    geldig=$(psql "$DB" -X -A -t -c "select coalesce((select i.indisvalid and i.indisready from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid = i.indexrelid where c.relname = 'idx_chunks_embedding' and i.indrelid = 'public.document_chunks'::regclass), false)")
    if [ "$geldig" != "t" ]; then
      echo "   volledige index niet geldig ⇒ fase H" >&2
      if ! psql "$DB" -X -q -v ON_ERROR_STOP=1 -v doelomgeving=lokaal -v fase=H -f "$OPS/h-volledige-index-herstel.psql" >&2; then
        echo "INCIDENT: herstel van de volledige index MISLUKT; stand:" >&2; stand >&2
        exit "$rc"
      fi
    fi
    echo "   stand na vangnet:" >&2; stand >&2
  fi
  exit "$rc"
}
trap vangnet EXIT

echo "== beginstand"; stand

echo "== 1. guard-negatieven (vóór enige DDL)"
weigert "P1 zonder -v doelomgeving" "doelomgeving=lokaal|preview|productie ontbreekt" -v fase=P1 -f "$OPS/p1-partiele-index-concurrent.psql"
weigert "P1 met doel productie op lokale DB" "doel productie, maar de tenantdomeinen passen niet" -v doelomgeving=productie -v fase=P1 -f "$OPS/p1-partiele-index-concurrent.psql"
weigert "P1 op onverwachte stand (partiële index bestaat al)" "R1B-GUARD P1" -v doelomgeving=lokaal -v fase=P1 -f "$OPS/p1-partiele-index-concurrent.psql"
weigert "H4b terwijl de R1b-functie nog bestaat" "R1B-GUARD H4b" -v doelomgeving=lokaal -v fase=H4b -f "$OPS/h4b-partiele-index-verwijderen.psql"
weigert "P5 met onbekende fase" "fase X onbekend" -v doelomgeving=lokaal -v fase=X -f "$OPS/p5-cutover-volledige-index-verwijderen.psql"
echo "== 2. H4a — transactionele rollback: alleen de functie"
q -f supabase/rollbacks/2026_10_08_r1b_hybride_begrensd_ROLLBACK.sql; stand

echo "== 3. H4b met een OPEN schrijftransactie: moet op lock_timeout afbreken, niet blijven wachten"
HOUDER_DB="$DB?application_name=$HOUDER_APP"
psql "$HOUDER_DB" -X -q -c "begin; insert into public.document_chunks (document_id, tekst, chunk_index, embedding)
  select document_id, tekst, 990000, embedding from public.document_chunks where bibliotheek = 'generiek' and embedding is not null limit 1;
  select pg_sleep(20); rollback;" >/dev/null 2>&1 &
HOUDER=$!
sleep 2
faalhaak open_write
t0=$(ms)
weigert "H4b tijdens een open write" "lock timeout" -v doelomgeving=lokaal -v fase=H4b -f "$OPS/h4b-partiele-index-verwijderen.psql"
echo "    afgebroken na $(( $(ms) - t0 )) ms (lock_timeout 5 s)"
wait "$HOUDER" || true
HOUDER=""
stand
echo "== 3b. H4b opnieuw, zonder blokkade"
t0=$(ms); q -v doelomgeving=lokaal -v fase=H4b -f "$OPS/h4b-partiele-index-verwijderen.psql"; echo "    $(( $(ms) - t0 )) ms"; stand

echo "== 3c. P2 zonder P1 op een GEVULDE tabel: migratie moet weigeren (bouwt zelf niets)"
weigert "P2 zonder P1 (gevulde tabel)" "partiële index ontbreekt; voer eerst P1 uit" -f supabase/migrations/2026_10_08_r1b_hybride_begrensd.sql
stand

echo "== 4. P1 — partiële index concurrent (serieel)"
t0=$(ms); q -v doelomgeving=lokaal -v fase=P1 -f "$OPS/p1-partiele-index-concurrent.psql"; echo "    $(( $(ms) - t0 )) ms"; stand

echo "== 5. P2 — migratie (bouwt niets; grendels eisen de P1-index)"
# Exitstatus van de migratie blijft leidend; pas daarna de uitvoer filteren.
mig_uit="$(q -f supabase/migrations/2026_10_08_r1b_hybride_begrensd.sql 2>&1)" || { echo "$mig_uit" >&2; echo "FOUT: P2-migratie faalde" >&2; exit 1; }
grep -v "already exists, skipping" <<<"$mig_uit" || true
stand

echo "== 6. P5 — cutover: volledige index concurrent weg"
t0=$(ms); q -v doelomgeving=lokaal -v fase=P5 -f "$OPS/p5-cutover-volledige-index-verwijderen.psql"; echo "    $(( $(ms) - t0 )) ms"; stand
weigert "H4a-rollback in de single-index-stand" "volledige HNSW-index ontbreekt of is ongeldig" -f supabase/rollbacks/2026_10_08_r1b_hybride_begrensd_ROLLBACK.sql
faalhaak P5

echo "== 7. H — herstel volledige index (serieel)"
t0=$(ms); q -v doelomgeving=lokaal -v fase=H -f "$OPS/h-volledige-index-herstel.psql"; echo "    $(( $(ms) - t0 )) ms"; stand
echo "== eindstand gelijk aan beginstand (beide geldig, functie aanwezig)"
