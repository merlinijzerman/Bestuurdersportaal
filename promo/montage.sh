#!/usr/bin/env bash
#
# promo/montage.sh — bouwt de eindvideo uit de opnames en de overlays.
#
#   bash promo/montage.sh
#
# Vereist: ffmpeg (brew install ffmpeg, of het npm-pakket ffmpeg-static)
# Invoer:  promo/opnames/<id>.webm        (uit opname.spec.ts)
#          promo/overlays/<id>.png        (uit maak-overlays.mjs)
#          promo/overlays/plan.txt        (volgorde + doelduur per scène)
# Uitvoer: promo/uit/promo-16x9.mp4       (master, 1920×1080, 30 fps)
#          promo/uit/promo-4x5.mp4        (LinkedIn-variant, 1080×1350)
#
# Optioneel: PROMO_MUZIEK=/pad/naar/track.mp3 bash promo/montage.sh
#            De track wordt op een vast bedniveau gezet (piek -26 dBFS), zodat
#            een luide commerciële track en een zachte gegenereerde bed allebei
#            even onopvallend uitkomen. Fijnregelen met PROMO_MUZIEK_PIEK
#            (bv. -22 = luider) of PROMO_MUZIEK_VOLUME (default 1.0).
#            Geen track? Maak er een: bash promo/maak-muziek.sh
#
# Kernidee: een scène die langer duurt dan zijn doelduur wordt versneld in
# plaats van weggeknipt. Zo blijft de echte wachttijd van het AI-antwoord
# zichtbaar (eerlijk) zonder dat de video stilvalt.

set -euo pipefail

# Op een Nederlandse locale print awk decimalen met een komma (4,550). ffmpeg
# leest die komma als scheidingsteken tússen filters en breekt af op een
# onbegrijpelijke parse-fout. Forceer daarom de C-locale voor dit script.
export LC_ALL=C

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPNAMES="$HIER/opnames"
OVERLAYS="$HIER/overlays"
WERK="$HIER/.werk"
UIT="$HIER/uit"
INK="0x171A28"
MAX_VERSNELLING="2.5"

# ffmpeg: systeeminstallatie (brew) of het npm-pakket ffmpeg-static:
#   export FFMPEG=$(node -p "require('ffmpeg-static')")
# ffprobe is OPTIONEEL. Zet FFPROBE als je een werkende hebt; zo niet, dan meet
# het script de clipduur met ffmpeg zelf. (ffprobe-static levert op Apple
# Silicon een x86-binary die niet draait — vandaar de terugval.)
FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-}"
command -v "$FFMPEG" >/dev/null || { echo "ffmpeg ontbreekt — zie promo/README.md"; exit 1; }

# Duur van een mediabestand in seconden. Probeert ffprobe; valt anders terug op
# ffmpeg, dat het bestand doordecodeert en de eindtijd rapporteert.
duur_van() {
  local f="$1" d=""
  if [ -n "$FFPROBE" ]; then
    d=$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null || true)
  fi
  if [ -z "$d" ] || [ "$d" = "N/A" ]; then
    d=$("$FFMPEG" -nostdin -i "$f" -f null - 2>&1 | awk '
      { n = split($0, a, "time="); if (n > 1) { split(a[n], b, " "); t = b[1] } }
      END { split(t, p, ":"); printf "%.3f", p[1]*3600 + p[2]*60 + p[3] }')
  fi
  printf "%s" "$d"
}
[ -f "$OVERLAYS/plan.txt" ] || { echo "promo/overlays/plan.txt ontbreekt — draai eerst: node promo/maak-overlays.mjs"; exit 1; }

# Verouderingscontrole: monteren op oude beelden is de makkelijkste manier om
# jezelf voor de gek te houden — je ziet een nieuwe video met de oude fouten.
nieuwste=$(ls -t "$OPNAMES"/*.webm 2>/dev/null | head -1 || true)
if [ -n "${nieuwste:-}" ] && { [ "$HIER/scenes.ts" -nt "$nieuwste" ] || [ "$HIER/opname.spec.ts" -nt "$nieuwste" ]; }; then
  echo
  echo "  ⚠  LET OP: scenes.ts of opname.spec.ts is gewijzigd ná de laatste opname."
  echo "     Deze montage gebruikt dus verouderde beelden. Draai eerst opnieuw:"
  echo "       npx playwright test --config=promo/playwright.config.ts"
  echo
fi

rm -rf "$WERK"; mkdir -p "$WERK" "$UIT"
CONCAT="$WERK/concat.txt"; : > "$CONCAT"

rond() { awk -v v="$1" 'BEGIN{printf "%.3f", v}'; }

while IFS='|' read -r type id doel; do
  [ -z "${type:-}" ] && continue
  png="$OVERLAYS/$id.png"
  uitbestand="$WERK/$id.mp4"

  if [ "$type" = "kaart" ]; then
    fade_uit=$(awk -v d="$doel" 'BEGIN{printf "%.3f", (d-0.45)}')
    "$FFMPEG" -nostdin -y -loglevel error -loop 1 -t "$doel" -i "$png" \
      -vf "scale=1920:1080,fps=30,fade=t=in:st=0:d=0.45,fade=t=out:st=${fade_uit}:d=0.45,format=yuv420p" \
      -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p "$uitbestand"
    echo "  kaart   $id  (${doel}s)"

  else
    bron="$OPNAMES/$id.webm"
    if [ ! -f "$bron" ]; then
      echo "  ! overgeslagen: $id (geen opname — zie promo/opnames/opname-log.json)"
      continue
    fi
    echt=$(duur_van "$bron")
    factor=$(awk -v e="$echt" -v d="$doel" -v m="$MAX_VERSNELLING" \
      'BEGIN{f=e/d; if(f<1.02)f=1; if(f>m)f=m; printf "%.4f", f}')
    duur=$(awk -v e="$echt" -v f="$factor" 'BEGIN{printf "%.3f", e/f}')
    fade_uit=$(awk -v d="$duur" 'BEGIN{printf "%.3f", (d-0.35)}')

    "$FFMPEG" -nostdin -y -loglevel error -i "$bron" -i "$png" -filter_complex "\
[0:v]scale=1920:1080:flags=lanczos,setpts=PTS/${factor},fps=30[v];\
[v][1:v]overlay=0:0:format=auto,fade=t=in:st=0:d=0.35,fade=t=out:st=${fade_uit}:d=0.35,format=yuv420p[o]" \
      -map "[o]" -an -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p "$uitbestand"
    printf "  opname  %s  (%ss opgenomen → %ss, ×%s)\n" "$id" "$(rond "$echt")" "$duur" "$factor"
  fi

  echo "file '$uitbestand'" >> "$CONCAT"
done < "$OVERLAYS/plan.txt"

[ -s "$CONCAT" ] || { echo "Geen bruikbare scènes gevonden."; exit 1; }

echo "› samenvoegen"
"$FFMPEG" -nostdin -y -loglevel error -f concat -safe 0 -i "$CONCAT" -c copy "$WERK/master-stil.mp4"

MASTER="$UIT/promo-16x9.mp4"
if [ -n "${PROMO_MUZIEK:-}" ] && [ -f "${PROMO_MUZIEK}" ]; then
  totaal=$(duur_van "$WERK/master-stil.mp4")
  fade=$(awk -v t="$totaal" 'BEGIN{printf "%.3f", (t-2.5)}')

  # Niveau: meet de piek van de track en pas één statische versterking toe naar
  # een vast bedniveau. Bewust geen loudnorm — dat is dynamisch en tilt bij een
  # zachte track de ruisvloer mee op (hoorbaar als een windachtige ruis).
  piek=$("$FFMPEG" -nostdin -hide_banner -i "$PROMO_MUZIEK" -af volumedetect -f null - 2>&1 \
    | awk -F': ' '/max_volume/{gsub(/ dB/,"",$2); print $2}')
  gain=$(awk -v p="${piek:--6}" -v doel="${PROMO_MUZIEK_PIEK:--26}" 'BEGIN{printf "%.2f", doel - p}')
  echo "› muziek: piek ${piek:-?} dB → ${gain} dB (doel ${PROMO_MUZIEK_PIEK:--26} dB)"

  "$FFMPEG" -nostdin -y -loglevel error -i "$WERK/master-stil.mp4" -i "$PROMO_MUZIEK" \
    -filter_complex "[1:a]volume=${gain}dB,volume=${PROMO_MUZIEK_VOLUME:-1.0},\
afade=t=in:st=0:d=1.5,afade=t=out:st=${fade}:d=2.5[a]" \
    -map 0:v -map "[a]" -shortest -c:v copy -c:a aac -b:a 160k "$MASTER"
else
  cp "$WERK/master-stil.mp4" "$MASTER"
fi

echo "› LinkedIn-variant (4:5)"
"$FFMPEG" -nostdin -y -loglevel error -i "$MASTER" \
  -vf "scale=1080:-2,pad=1080:1350:0:(1350-ih)/2:color=${INK}" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p ${PROMO_MUZIEK:+-c:a copy} "$UIT/promo-4x5.mp4"

echo
echo "Klaar:"
ls -lh "$UIT" | awk 'NR>1 {print "  " $9 "  " $5}'
