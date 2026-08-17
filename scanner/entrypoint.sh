#!/bin/sh
# =============================================================================
#  scanner/entrypoint.sh — start clamd en daarna de HTTP-laag.
# -----------------------------------------------------------------------------
#  clamd laadt de volledige signatureset in het geheugen (1,5–2,5 GB) en dat
#  duurt tientallen seconden. Bij een warme instance betaal je die prijs één
#  keer; door scale-to-zero kan dat bij laag volume echter vrijwel elke scan
#  zijn. De HTTP-laag wacht daarom expliciet tot de socket er is en meldt zich
#  pas dan gezond — zo krijgt de beheerworker nooit een verdict van een daemon
#  die zijn database nog niet volledig heeft geladen.
# =============================================================================
set -eu

SOCKET=/tmp/clamd/clamd.sock
mkdir -p /tmp/clamd
rm -f "$SOCKET"

echo '{"tag":"scanner","fase":"clamd-start"}'
clamd --config-file=/etc/clamav/clamd.conf &
CLAMD_PID=$!

# Wachten tot de socket bestaat. Geen vaste sleep: de laadtijd verschilt per
# instance en per signatureset. De bovengrens is ruim, maar eindig — hangt clamd
# vast, dan sterft de container zichtbaar in plaats van stil onbruikbaar te zijn.
WACHT=0
while [ ! -S "$SOCKET" ]; do
  if ! kill -0 "$CLAMD_PID" 2>/dev/null; then
    echo '{"tag":"scanner","fase":"clamd-gestorven"}' >&2
    exit 1
  fi
  if [ "$WACHT" -ge 180 ]; then
    echo '{"tag":"scanner","fase":"clamd-timeout"}' >&2
    exit 1
  fi
  sleep 1
  WACHT=$((WACHT + 1))
done
echo "{\"tag\":\"scanner\",\"fase\":\"clamd-gereed\",\"laadtijd_s\":$WACHT}"

# Start ook de HTTP-laag als kind van deze PID-1-shell. Zo kan dezelfde ouder
# beide processen bewaken en opruimen. `wait` vanuit een achtergrond-subshell is
# hier bewust niet bruikbaar: die subshell is niet de ouder van clamd en kan dus
# niet betrouwbaar op diens PID wachten.
node /app/src/server.mjs &
HTTP_PID=$!

stop_kinderen() {
  trap - TERM INT
  kill -TERM "$HTTP_PID" 2>/dev/null || true
  kill -TERM "$CLAMD_PID" 2>/dev/null || true
  wait "$HTTP_PID" 2>/dev/null || true
  wait "$CLAMD_PID" 2>/dev/null || true
}

# Vercel geeft bij scale-in SIGTERM en vervolgens een korte grace-periode. Geef
# die door aan beide kinderen en wacht tot ze echt gestopt zijn.
trap 'stop_kinderen; exit 0' TERM INT

# POSIX-sh heeft niet overal `wait -n`. Een korte kill-0-lus bewaakt daarom beide
# kinderen zonder shellspecifieke uitbreidingen. Sterft één proces onverwacht,
# dan stopt de andere mee en faalt de container zichtbaar.
while kill -0 "$CLAMD_PID" 2>/dev/null && kill -0 "$HTTP_PID" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$CLAMD_PID" 2>/dev/null; then
  echo '{"tag":"scanner","fase":"clamd-gestopt"}' >&2
else
  echo '{"tag":"scanner","fase":"http-gestopt"}' >&2
fi
stop_kinderen
exit 1
