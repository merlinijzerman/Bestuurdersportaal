#!/usr/bin/env bash
#
# promo/maak-muziek.sh — genereert een rustige bedtrack met ffmpeg.
#
#   bash promo/maak-muziek.sh              → promo/muziek-bed.mp3 (100 sec)
#   DUUR=120 bash promo/maak-muziek.sh     → langer
#   ARP=0 bash promo/maak-muziek.sh        → alleen akkoorden, geen beweging
#
# Waarom gegenereerd en niet gedownload: dan hoef je niets te regelen qua
# rechten. Twee lagen, zodat het niet als één lange toon aanvoelt:
#
#   1. een akkoordenbed van ZES akkoorden (Am–F–C–G–Em–Dm) die in elkaar
#      overvloeien — geen herhaling van vier, dus de lus is minder hoorbaar;
#   2. een heel zachte, trage beweging daarboven: acht tonen binnen een
#      kwart (geen octaafsprongen), elke ruim 2 seconden één stap, ver terug
#      in de mix. Bewust traag en smal: een snelle, springerige lijn (de
#      vorige versie deed 16 noten over een octaaf, elke 0,75s) klinkt al
#      snel onrustig/"zenuwachtig" in plaats van rustig.
#
# Het blijft bewust ingetogen: dit is een bed onder tekstoverlays, geen
# soundtrack. Voor de versie die naar buiten gaat is een gelicentieerde track
# (Epidemic Sound, Artlist, Musicbed) beter — let dan op een COMMERCIËLE
# licentie; "gratis voor persoonlijk gebruik" dekt een bedrijfs-LinkedIn niet.
#
# Daarna:  PROMO_MUZIEK=promo/muziek-bed.mp3 bash promo/montage.sh

set -euo pipefail
export LC_ALL=C

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FFMPEG="${FFMPEG:-ffmpeg}"
command -v "$FFMPEG" >/dev/null || { echo "ffmpeg ontbreekt — zie promo/README.md"; exit 1; }

DUUR="${DUUR:-100}"
ARP="${ARP:-1}"
UIT="$HIER/muziek-bed.mp3"
WERK="$HIER/.muziek"; rm -rf "$WERK"; mkdir -p "$WERK"

# ── Laag 1: akkoordenbed ────────────────────────────────────────────────────
AKKOORDEN=(
  "110.00 261.63 329.63"   # Am
  " 87.31 220.00 261.63"   # F
  "130.81 329.63 392.00"   # C
  " 98.00 246.94 293.66"   # G
  " 82.41 246.94 329.63"   # Em
  " 73.42 220.00 293.66"   # Dm
)
N=${#AKKOORDEN[@]}
OVER=5
LEN=$(awk -v d="$DUUR" -v n="$N" -v o="$OVER" 'BEGIN{printf "%d", (d + (n-1)*o)/n + 2}')

echo "› akkoordenbed (${N} akkoorden van ${LEN}s)"
i=0
for akkoord in "${AKKOORDEN[@]}"; do
  read -r t1 t2 t3 <<< "$akkoord"
  uit_st=$(awk -v l="$LEN" 'BEGIN{printf "%.2f", l-3}')
  "$FFMPEG" -nostdin -y -loglevel error \
    -f lavfi -i "sine=frequency=${t1}:duration=${LEN}:sample_rate=44100" \
    -f lavfi -i "sine=frequency=${t2}:duration=${LEN}:sample_rate=44100" \
    -f lavfi -i "sine=frequency=${t3}:duration=${LEN}:sample_rate=44100" \
    -filter_complex "\
[0:a]volume=0.55[a0];[1:a]volume=0.28[a1];[2:a]volume=0.20[a2];\
[a0][a1][a2]amix=inputs=3:normalize=0,\
lowpass=f=900,\
tremolo=f=0.13:d=0.09,\
afade=t=in:st=0:d=3,afade=t=out:st=${uit_st}:d=3[out]" \
    -map "[out]" -ac 2 -ar 44100 "$WERK/akkoord$i.wav"
  i=$((i + 1))
done

# Aan elkaar vloeien.
inputs=(); for ((k=0;k<N;k++)); do inputs+=(-i "$WERK/akkoord$k.wav"); done
graph="[0:a][1:a]acrossfade=d=${OVER}:c1=tri:c2=tri[x1]"
for ((k=2;k<N;k++)); do
  graph="${graph};[x$((k-1))][${k}:a]acrossfade=d=${OVER}:c1=tri:c2=tri[x${k}]"
done
graph="${graph};[x$((N-1))]atrim=0:${DUUR},asetpts=N/SR/TB[bed]"
"$FFMPEG" -nostdin -y -loglevel error "${inputs[@]}" \
  -filter_complex "$graph" -map "[bed]" -ac 2 -ar 44100 "$WERK/bed.wav"

# ── Laag 2: arpeggio ────────────────────────────────────────────────────────
if [ "$ARP" = "1" ]; then
  echo "› zachte melodische laag"
  # Acht tonen, smal bereik (kwart: C5–F5), rustig heen-en-weer — geen
  # oplopend/springend patroon. Traag tempo en lange overlap laten de tonen
  # in elkaar vloeien tot een zacht "ademen" in plaats van een tikkend loopje.
  NOTEN=(523.25 587.33 659.25 698.46 659.25 587.33 523.25 493.88)
  STAP=2.2           # seconden tussen twee noten — traag
  NOOTLEN=3.6        # ruime overlap, geen "pluk"-ritme meer hoorbaar

  ninputs=(); nfilters=""; nmix=""
  j=0
  for f in "${NOTEN[@]}"; do
    ninputs+=(-f lavfi -i "sine=frequency=${f}:duration=${NOOTLEN}:sample_rate=44100")
    vertraging=$(awk -v j="$j" -v s="$STAP" 'BEGIN{printf "%d", j*s*1000}')
    # Aanslag + exponentiële uitdemping = pluk-achtig, geen orgeltoon.
    nfilters="${nfilters}[${j}:a]afade=t=in:st=0:d=0.012,afade=t=out:st=0.05:d=$(awk -v n="$NOOTLEN" 'BEGIN{printf "%.2f", n-0.05}'):curve=exp,adelay=${vertraging}|${vertraging}[n${j}];"
    nmix="${nmix}[n${j}]"
    j=$((j + 1))
  done
  patroon=$(awk -v j="$j" -v s="$STAP" 'BEGIN{printf "%.2f", j*s}')
  "$FFMPEG" -nostdin -y -loglevel error "${ninputs[@]}" \
    -filter_complex "${nfilters}${nmix}amix=inputs=${j}:normalize=0,\
lowpass=f=1600,\
atrim=0:${patroon},asetpts=N/SR/TB,volume=0.12[arp]" \
    -map "[arp]" -ac 2 -ar 44100 "$WERK/arp.wav"

  "$FFMPEG" -nostdin -y -loglevel error \
    -i "$WERK/bed.wav" -stream_loop -1 -i "$WERK/arp.wav" \
    -filter_complex "[1:a]atrim=0:${DUUR},asetpts=N/SR/TB,volume=0.40[a1];\
[0:a][a1]amix=inputs=2:normalize=0:duration=first[m]" \
    -map "[m]" -ac 2 -ar 44100 "$WERK/mix.wav"
else
  cp "$WERK/bed.wav" "$WERK/mix.wav"
fi

# ── Afwerken ────────────────────────────────────────────────────────────────
# Bewust GEEN loudnorm: dat is een dynamisch, eenpass-algoritme dat een heel
# zacht signaal ver moet optillen en daarbij de ruisvloer meeneemt — precies de
# "wind" die je hoort. In plaats daarvan meten we de piek en passen we één
# exacte, statische versterking toe. Deterministisch en artefactvrij.
# De banddoorlaat erboven en eronder haalt weg wat er sowieso niet hoort te
# zijn: rommel onder 40 Hz en alles boven 3,5 kHz.
echo "› niveau meten"
PIEK=$("$FFMPEG" -nostdin -hide_banner -i "$WERK/mix.wav" -af volumedetect -f null - 2>&1 \
  | awk -F': ' '/max_volume/{gsub(/ dB/,"",$2); print $2}')
GAIN=$(awk -v p="${PIEK:--20}" 'BEGIN{printf "%.2f", -3.0 - p}')
echo "  piek ${PIEK} dB → +${GAIN} dB"

fade_uit=$(awk -v d="$DUUR" 'BEGIN{printf "%.2f", d-4}')
"$FFMPEG" -nostdin -y -loglevel error -i "$WERK/mix.wav" \
  -af "highpass=f=40,lowpass=f=3500,volume=${GAIN}dB,\
afade=t=in:st=0:d=3,afade=t=out:st=${fade_uit}:d=4" \
  -c:a libmp3lame -q:a 2 "$UIT"

rm -rf "$WERK"
echo "✓ $UIT (${DUUR}s)"
echo
echo "Beluisteren:   open $UIT"
echo "Zonder arpeggio: ARP=0 bash promo/maak-muziek.sh"
echo "Meemonteren:   PROMO_MUZIEK=promo/muziek-bed.mp3 bash promo/montage.sh"
