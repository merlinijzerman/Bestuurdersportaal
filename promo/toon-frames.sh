#!/usr/bin/env bash
#
# promo/toon-frames.sh — maakt per opname een contactvel met tijdstempels.
#
#   bash promo/toon-frames.sh            → alle opnames, 1 frame per seconde
#   INTERVAL=2 bash promo/toon-frames.sh → 1 frame per 2 seconden
#
# Waarvoor: de fragmenttijden (van/tot) in promo-teksten.json horen bij een
# specifieke opname. Neem je opnieuw op, dan verschuiven ze. Met dit contactvel
# lees je in één blik af op welke seconde welk beeld staat, zodat je van/tot
# kunt bijstellen zonder de video steeds opnieuw te renderen.
#
# Uitvoer: promo/frames/<opname>-contact.jpg

set -euo pipefail
export LC_ALL=C

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FFMPEG="${FFMPEG:-ffmpeg}"
command -v "$FFMPEG" >/dev/null || { echo "ffmpeg ontbreekt — zie promo/README.md"; exit 1; }

INTERVAL="${INTERVAL:-1}"
KOLOMMEN="${KOLOMMEN:-4}"
UIT="$HIER/frames"; mkdir -p "$UIT"

schoon=1
for bron in "$HIER"/opnames/*.webm; do
  [ -e "$bron" ] || { echo "Geen opnames gevonden in promo/opnames/"; exit 1; }
  schoon=0
  naam=$(basename "$bron" .webm)
  doel="$UIT/${naam}-contact.jpg"
  echo "› $naam"
  "$FFMPEG" -nostdin -y -loglevel error -i "$bron" \
    -vf "fps=1/${INTERVAL},scale=640:-1,\
drawtext=text='%{pts\\:hms}':x=8:y=8:fontsize=26:fontcolor=yellow:box=1:boxcolor=black@0.75,\
tile=${KOLOMMEN}x100:padding=4:color=0x171A28" \
    -frames:v 1 -q:v 3 "$doel" 2>/dev/null || true
  [ -f "$doel" ] && echo "  → $doel"
done
[ "$schoon" = "1" ] && echo "Geen opnames gevonden."

cat <<'UITLEG'

Aflezen en bijstellen:
  1. Open het contactvel; de gele tijd linksboven elke tegel is de seconde in
     de opname.
  2. Kies per scène de momenten die de boodschap dragen (meestal 2–3 stuks van
     2,5–3,5 seconden).
  3. Zet die als "van"/"tot" in promo-teksten.json onder de betreffende scène.
  4. "zoom" bepaalt hoever je inzoomt (1.0 = volledig beeld, 1.5 = ruim
     anderhalf keer), "cx"/"cy" het middelpunt als fractie (0.5 = midden).
     Vuistregel: zet cy LAGER dan het inhoudelijke midden, dan landt de inhoud
     in de bovenste helft en blijft hij vrij van de tekstbalk onderin.
UITLEG
