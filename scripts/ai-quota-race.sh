#!/usr/bin/env bash
# ============================================================================
#  Race-test AI-quotum (besluit 0180) — ECHTE gelijktijdigheid, twee verbindingen
# ----------------------------------------------------------------------------
#  WAAROM DIT EEN APART SCRIPT IS
#    De acceptatiematrix eist: "parallelle laatste twee acties bij nog één plek
#    → exact één toegestaan, geen race-overschrijding". Dat is NIET te bewijzen
#    met twee sessies binnen één transactieblok in een psql-script: die draaien
#    per definitie na elkaar en zouden groen meten terwijl de code lek is.
#    Hier draaien twee ONAFHANKELIJKE psql-processen, uitgelijnd op een gedeeld
#    starttijdstip, zodat ze de reservering werkelijk tegelijk proberen.
#
#  WAT HET BEWIJST
#    Met nog precies één vrije plek in het platformquotum mag exact één van de
#    twee slagen, en moet de eindstand gelijk zijn aan het quotum — niet één
#    hoger. Zonder de advisory lock in fn_ai_reserveer_intern lezen beide
#    processen dezelfde stand en reserveren ze allebei; deze test valt dan om.
#
#  ⚠ UITSLUITEND TEGEN EEN WEGWERPBARE TEST-DB
#    ai_verbruik_log is append-only: wat deze test schrijft is NIET te
#    verwijderen. Draaien tegen Preview of Productie vervuilt de teller
#    permanent (zelfde afweging als OP-VB2). Het script weigert daarom te
#    starten tenzij AI_QUOTA_RACE_TESTDB=1 is gezet én het verbruikslog leeg is.
#
#  Gebruik:
#    TEST_DATABASE_URL='postgresql://…' AI_QUOTA_RACE_TESTDB=1 \
#      bash scripts/ai-quota-race.sh
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL="${TEST_DATABASE_URL:-${DATABASE_URL:-}}"

if [ -z "$DB_URL" ]; then
  echo "FOUT: geen TEST_DATABASE_URL/DATABASE_URL gezet." >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "FOUT: psql niet gevonden op PATH." >&2
  exit 1
fi
if [ "${AI_QUOTA_RACE_TESTDB:-}" != "1" ]; then
  echo "GEWEIGERD: zet AI_QUOTA_RACE_TESTDB=1 om te bevestigen dat dit een wegwerpbare DB is." >&2
  echo "           Deze test schrijft in het APPEND-ONLY verbruikslog; dat is niet terug te draaien." >&2
  exit 1
fi

BESTAAND=$(psql "$DB_URL" -tAc "select count(*) from public.ai_verbruik_log;")
if [ "$BESTAAND" != "0" ]; then
  echo "GEWEIGERD: ai_verbruik_log bevat al $BESTAAND regels — dit lijkt geen verse test-DB." >&2
  echo "           Draai deze test nooit tegen Preview of Productie." >&2
  exit 1
fi

FONDS='dddddddd-0000-4000-8000-000000000001'
echo "[1/4] Testfonds en quota klaarzetten…"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 <<SQL
insert into public.fondsen (id, naam, slug)
values ('${FONDS}','Racetest','xrace')
on conflict (id) do nothing;

-- Ruim op elk niveau, behalve globaal: daar laten we exact ÉÉN plek vrij.
select public.fn_ai_quota_wijzigen('gebruiker_maand', 1000, null);
select public.fn_ai_quota_wijzigen('fonds_maand',     1000, null);
select public.fn_ai_quota_wijzigen('ocr_fonds_maand', 1000, null);
select public.fn_ai_quota_wijzigen('globaal_maand',      1, null);
SQL

# Gedeeld starttijdstip: beide processen slapen tot exact hetzelfde moment en
# vallen dan tegelijk de preflight binnen.
START=$(psql "$DB_URL" -tAc "select (clock_timestamp() + interval '3 seconds')::text;")

race_poging() {
  local sleutel="$1"
  psql "$DB_URL" -tAc "
    select pg_sleep(greatest(0, extract(epoch from ('${START}'::timestamptz - clock_timestamp()))));
    select (public.fn_ai_preflight_systeem(
      'document_ingest','${FONDS}','anthropic','claude-sonnet-4-5',0,'${sleutel}','vf',false
    )->>'toegestaan');
  " | tr -d '[:space:]'
}

echo "[2/4] Twee onafhankelijke verbindingen, uitgelijnd op ${START}…"
race_poging "race-a" > /tmp/ai-race-a.$$ &
PID_A=$!
race_poging "race-b" > /tmp/ai-race-b.$$ &
PID_B=$!
wait "$PID_A" "$PID_B"

UITKOMST_A=$(cat /tmp/ai-race-a.$$)
UITKOMST_B=$(cat /tmp/ai-race-b.$$)
rm -f /tmp/ai-race-a.$$ /tmp/ai-race-b.$$

echo "[3/4] Uitkomsten: A=${UITKOMST_A} B=${UITKOMST_B}"

echo "[4/4] Eindstand toetsen…"
GEBOEKT=$(psql "$DB_URL" -tAc \
  "select coalesce(sum(ai_acties),0) from public.ai_verbruik_log
    where maand = (date_trunc('month',(now() at time zone 'UTC')))::date;")

FOUT=0
# Exact één van de twee mag geslaagd zijn.
if [ "${UITKOMST_A}${UITKOMST_B}" != "truefalse" ] && [ "${UITKOMST_A}${UITKOMST_B}" != "falsetrue" ]; then
  echo "RACE-TEST FAALT: verwacht exact één 'true', kreeg A=${UITKOMST_A} B=${UITKOMST_B}." >&2
  FOUT=1
fi
# En de teller mag het quotum niet zijn gepasseerd.
if [ "$GEBOEKT" != "1" ]; then
  echo "RACE-TEST FAALT: quotum is 1, maar er staan ${GEBOEKT} AI-acties geboekt (race-overschrijding)." >&2
  FOUT=1
fi

if [ "$FOUT" -ne 0 ]; then
  exit 1
fi

echo
echo "RACE-TEST GROEN: bij één vrije plek slaagde exact één van twee gelijktijdige"
echo "verzoeken en staat de teller op ${GEBOEKT} — geen race-overschrijding."
