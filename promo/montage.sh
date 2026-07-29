#!/usr/bin/env bash
#
# promo/montage.sh — bouwt de eindvideo uit de opnames en de overlays.
#
#   bash promo/montage.sh
#
# Vereist: ffmpeg + ffprobe (brew install ffmpeg)
# Invoer:  promo/opnames/<id>.webm        (uit opname.spec.ts)
#          promo/overlays/<id>.png        (uit maak-overlays.mjs)
#          promo/overlays/plan.txt        (volgorde + doelduur per scène)
# Uitvoer: promo/uit/promo-16x9.mp4       (master, 1920×1080, 30 fps)
#          promo/uit/promo-4x5.mp4        (LinkedIn-variant, 1080×1350)
#
# Optioneel: PROMO_MUZIEK=/pad/naar/track.mp3 bash promo/montage.sh
#
# Kernidee: een scène die langer duurt dan zijn doelduur wordt versneld in
# plaats van weggeknipt. Zo blijft de echte wachttijd van het AI-antwoord
# zichtbaar (eerlijk) zonder dat de video stilvalt.

set -euo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPNAMES="$HIER/opnames"
OVERLAYS="$HIER/overlays"
WERK="$HIER/.werk"
UIT="$HIER/uit"
INK="0x171A28"
MAX_VERSNELLING="3.0"

# ffmpeg/ffprobe: systeeminstallatie (brew) of de npm-pakketten ffmpeg-static /
# ffprobe-static. In dat laatste geval:
#   export FFMPEG=$(node -p "require('ffmpeg-static')")
#   export FFPROBE=$(node -p "require('ffprobe-static').path")
FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"
command -v "$FFMPEG"  >/dev/null || { echo "ffmpeg ontbreekt — zie promo/README.md"; exit 1; }
command -v "$FFPROBE" >/dev/null || { echo "ffprobe ontbreekt — zie promo/README.md"; exit 1; }
[ -f "$OVERLAYS/plan.txt" ] || { echo "promo/overlays/plan.txt ontbreekt — draai eerst: node promo/maak-overlays.mjs"; exit 1; }

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
    echt=$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$bron")
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
  totaal=$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$WERK/master-stil.mp4")
  fade=$(awk -v t="$totaal" 'BEGIN{printf "%.3f", (t-2.5)}')
  "$FFMPEG" -nostdin -y -loglevel error -i "$WERK/master-stil.mp4" -i "$PROMO_MUZIEK" \
    -filter_complex "[1:a]volume=0.22,afade=t=in:st=0:d=1.5,afade=t=out:st=${fade}:d=2.5[a]" \
    -map 0:v -map "[a]" -shortest -c:v copy -c:a aac -b:a 160k "$MASTER"
  echo "› muziek toegevoegd"
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
