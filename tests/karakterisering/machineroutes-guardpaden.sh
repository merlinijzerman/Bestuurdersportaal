#!/usr/bin/env bash
# ============================================================================
#  Karakterisering van de GUARDPADEN van de zeven machineroutes (W5b, PR 1).
# ----------------------------------------------------------------------------
#  WAAROM DIT NAAST HET BESTAANDE HARNAS STAAT
#  tests/karakterisering/run.mjs karakteriseert TENANT-routes: het bouwt een
#  sessie, een profiel en een fonds, en heeft daar een database voor nodig. Een
#  machineroute heeft geen van drieën. Zijn poort is een env-variabele en een
#  bearer, en beide takken keren terug VÓÓR createServiceSupabase(). Dat maakt
#  ze zonder database meetbaar — en dat is precies de winst: het pad dat W5b
#  verplaatst, is het pad dat hier wordt vastgelegd.
#
#  Wat NIET gedekt is: het geautoriseerde pad. Dat doet echt werk (queues,
#  storage, LLM) en is niet deterministisch te snapshotten. De wrapper raakt dat
#  pad ook niet aan — hij geeft de Response van de handler ongewijzigd door, wat
#  platform/lib/machine-route-wrapper.sanity.ts apart bewijst. Deze afbakening
#  staat hier expliciet: een harnas dat niet zegt wat het NIET meet, suggereert
#  meer dekking dan het heeft.
#
#  TWEE SCENARIO'S, en elk krijgt zijn eigen serverproces op zijn eigen poort.
#  DEPLOY_TARGET wordt per request gelezen maar per proces gezet, dus één server
#  kan niet beide scenario's draaien. De eerste versie van dit script hergebruikte
#  één poort; de tweede server startte niet en de meting rapporteerde stilletjes
#  twee keer hetzelfde scenario als "identiek". Vandaar de identiteitscontrole
#  hieronder: elk scenario bewijst eerst dat het draait wat het denkt te draaien.
#
#  GEBRUIK
#    npm run build                                         # eerst bouwen
#    bash tests/karakterisering/machineroutes-guardpaden.sh --record
#    bash tests/karakterisering/machineroutes-guardpaden.sh --verify
#
#  Een verschil bij --verify is een FOUT, geen ruis. Werk de snapshot alleen bij
#  als het gedrag BEWUST is gewijzigd, en motiveer de diff in de PR.
# ============================================================================
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

MODUS="${1:---verify}"
SNAPSHOT="tests/karakterisering/__snapshots__/machineroutes-guardpaden.txt"
BASISPOORT="${KARAKTERISERING_POORT:-3131}"
UIT="$(mktemp)"

ROUTES=(
  "/api/aqlab/worker" "/api/internal/afschrift-worker" "/api/internal/ingest-worker"
  "/api/internal/semantische-extractie" "/api/platform/monitoring/snapshot"
  "/api/platform/healthz" "/api/healthz/ping"
)

opruimen() { pkill -9 -f "next start -p $BASISPOORT" 2>/dev/null || true
             pkill -9 -f "next start -p $((BASISPOORT + 1))" 2>/dev/null || true; }
trap opruimen EXIT

i=0
for SCENARIO in "skip" "onbevoegd"; do
  PORT=$((BASISPOORT + i)); i=$((i + 1))
  # "app" = de gedeelde surface (skip-tak); "beheer" = het project met de
  # service-role, waar de bearer-check aan de beurt komt.
  [ "$SCENARIO" = "skip" ] && DT="app" || DT="beheer"

  DEPLOY_TARGET="$DT" CRON_SECRET="" \
    NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-dummy-anon-key}" \
    SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-dummy-service-key}" \
    npx next start -p "$PORT" >"/tmp/machineroutes-$PORT.log" 2>&1 &
  # disown: anders meldt de shell bij het opruimen "Killed: 9" over de
  # achtergrondtaak, wat er in de uitvoer uitziet als een fout terwijl het
  # de bedoelde teardown is.
  disown

  for _ in $(seq 1 45); do
    curl -sf "http://127.0.0.1:$PORT/api/healthz/ping" >/dev/null 2>&1 && break
    sleep 1
  done

  # Identiteitscontrole — zie de kop. Zonder deze stap kan een niet-gestarte
  # server een vals "identiek" opleveren.
  IDENT="$(curl -s "http://127.0.0.1:$PORT/api/aqlab/worker" || echo FOUT)"
  case "$SCENARIO:$IDENT" in
    skip:*deploy_target=app*)          : ;;
    onbevoegd:*Niet\ geautoriseerd*)   : ;;
    *) echo "MEETFOUT: scenario '$SCENARIO' op poort $PORT gaf: $IDENT" >&2; exit 1 ;;
  esac

  for R in "${ROUTES[@]}"; do
    for M in GET POST; do
      LICHAAM="$(mktemp)"
      CODE="$(curl -s -o "$LICHAAM" -w '%{http_code}' -X "$M" "http://127.0.0.1:$PORT$R" || echo 000)"
      printf '%-10s %-4s %-46s %s  %s\n' "$SCENARIO" "$M" "$R" "$CODE" \
        "$(head -c 300 "$LICHAAM" | tr -d '\n')" >> "$UIT"
      rm -f "$LICHAAM"
    done
  done

  pkill -9 -f "next start -p $PORT" 2>/dev/null || true
  sleep 2
done

if [ "$MODUS" = "--record" ]; then
  mv "$UIT" "$SNAPSHOT"
  echo "Opgenomen: $SNAPSHOT ($(wc -l < "$SNAPSHOT" | tr -d ' ') regels)"
else
  if diff -u "$SNAPSHOT" "$UIT"; then
    echo "Guardpaden byte-identiek aan de snapshot."
  else
    echo "VERSCHIL in de guardpaden — dit is een fout, geen ruis." >&2
    rm -f "$UIT"; exit 1
  fi
  rm -f "$UIT"
fi
