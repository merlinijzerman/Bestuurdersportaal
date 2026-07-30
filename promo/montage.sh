#!/usr/bin/env bash
#
# promo/montage.sh — bouwt de eindvideo uit de opnames en de overlays.
#
#   bash promo/montage.sh
#
# Vereist: ffmpeg (of het npm-pakket ffmpeg-static, via FFMPEG=...)
# Invoer:  promo/opnames/<bron>.webm     (uit opname.spec.ts)
#          promo/overlays/<id>.png       (uit maak-overlays.mjs)
#          promo/overlays/plan.txt       (volgorde, doelduur, fragmenten)
# Uitvoer: promo/uit/promo-16x9.mp4      (master, 1920×1080, 30 fps)
#          promo/uit/promo-1x1.mp4       (1080×1080, feed)
#          promo/uit/promo-4x5.mp4       (1080×1350, LinkedIn)
#          promo/uit/promo-9x16.mp4      (1080×1920, stories/reels)
#
# Optioneel: PROMO_MUZIEK=/pad/naar/track.mp3 bash promo/montage.sh
#            Fijnregelen met PROMO_MUZIEK_PIEK (bv. -22 = luider) of
#            PROMO_MUZIEK_VOLUME (default 1.0).
#
# ── Kernidee (gewijzigd t.o.v. de eerste opzet) ─────────────────────────────
# Eerst werd een hele scèneopname versneld afgespeeld tot hij paste. Dat is
# geen montage maar compressie: je ziet nog steeds elke muisbeweging, elke
# laadtijd en elk irrelevant schermdeel — alleen sneller.
#
# Nu knipt het script per scène alleen de betekenisvolle FRAGMENTEN uit de
# opname (van/tot in promo-teksten.json) en zoomt het per fragment in op het
# schermdeel dat de boodschap draagt. Wat overblijft is kort, leesbaar en
# gericht. Versnellen gebeurt alleen nog als restcorrectie.

set -euo pipefail

# Op een Nederlandse locale print awk decimalen met een komma (4,550). ffmpeg
# leest die komma als scheidingsteken tússen filters en breekt af op een
# onbegrijpelijke parse-fout. Forceer daarom de C-locale voor dit script.
export LC_ALL=C

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPNAMES="$HIER/opnames"

# ── Twee opmaakvarianten ────────────────────────────────────────────────────
#   PROMO_LAYOUT=vol    (standaard) schermvullend, tekst in een balk onderin
#   PROMO_LAYOUT=kader  opname als venster op een rustige achtergrond
#
# In kaderopmaak wordt er niets afgesneden: de hele opname past in een venster
# van 1600×900, en de tekst staat bóven en ónder dat venster. Inzoomen gebeurt
# dan met vaste niveaus (fragmentenKader in promo-teksten.json) in plaats van
# met een uitsnede over het hele beeld.
LAYOUT="${PROMO_LAYOUT:-vol}"
if [ "$LAYOUT" = "verticaal" ]; then
  # Staand 1080×1920, gebouwd uit een APARTE opname bij 1080×1200. Geen
  # uitsnede uit de brede opname: het portaal is responsive, dus bij een smal
  # venster herschikt het zichzelf en wordt er niets afgesneden.
  OPNAMES="$HIER/opnames-9x16"
  OVERLAYS="$HIER/overlays-9x16"
  UIT="$HIER/uit-9x16"
  WERK="$HIER/.werk-9x16"
  FRW=1080; FRH=1200; VX=0; VY=440
  DOEK_B=1080; DOEK_H=1920
  PUSH="${PROMO_PUSH:-0}"
  # Twee soorten overgang, bewust verschillend:
  #
  #  TUSSEN SCÈNES een ruime overvloeier (0,50s). Dat is een hoofdstukwissel;
  #  de tekst is dan al uitgevloeid, dus alleen het beeld lost op.
  #
  #  BINNEN EEN SCÈNE vrijwel een harde snede (0,10s). Twee momenten uit
  #  hetzelfde portaal zijn allebei dichte interfacetekst; die in elkaar laten
  #  overvloeien geeft geen zachte overgang maar een veeg — tekst over tekst,
  #  en het oog leest dat als een haperende scroll. Een snede is hier juist
  #  rustiger, en is bovendien de normale montagegrammatica voor beats binnen
  #  één scène.
  FXF="${PROMO_FRAGMENT_OVERGANG:-0.10}"
  XF="${PROMO_OVERGANG:-0.50}"
elif [ "$LAYOUT" = "kader" ]; then
  OVERLAYS="$HIER/overlays-kader"
  UIT="$HIER/uit-kader"
  WERK="$HIER/.werk-kader"
  FRW=1568; FRH=882; VX=176; VY=100
  DOEK_B=1920; DOEK_H=1080
  PUSH="${PROMO_PUSH:-0}"                       # bewust geen push-in: rustig beeld
  FXF="${PROMO_FRAGMENT_OVERGANG:-0.12}"        # vrijwel harde cuts
  XF="${PROMO_OVERGANG:-0.25}"
else
  OVERLAYS="$HIER/overlays"
  UIT="$HIER/uit"
  WERK="$HIER/.werk"
  FRW=1920; FRH=1080; VX=0; VY=0
  DOEK_B=1920; DOEK_H=1080
  # Geen push-in meer: die zoomt gaandeweg 5% in en snijdt dus alsnog beeld weg.
  # De opdracht is nu juist "volledig in beeld" — de beweging komt van de
  # intekenende tekst en van wat er op het scherm zelf gebeurt.
  PUSH="${PROMO_PUSH:-0}"
  FXF="${PROMO_FRAGMENT_OVERGANG:-0.25}"
  XF="${PROMO_OVERGANG:-0.30}"
fi
INK="0x171A28"
MAX_VERSNELLING="${PROMO_MAX_VERSNELLING:-1.6}"

FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-}"
command -v "$FFMPEG" >/dev/null || { echo "ffmpeg ontbreekt — zie promo/README.md"; exit 1; }

# ── Kwaliteit ───────────────────────────────────────────────────────────────
# De keten codeert vier keer achter elkaar: fragment → scène → overgang →
# eindmontage. Elke generatie kost kwaliteit, dus de TUSSENSTAPPEN staan
# bewust hoog (crf 14 = praktisch verliesvrij). Alleen de laatste stap mag
# comprimeren. Kleurtags erbij zodat spelers niet zelf gaan gokken en de
# kleuren verschuiven.
KLEUR=(-color_primaries bt709 -color_trc bt709 -colorspace bt709)
ENC=(-c:v libx264 -preset medium -crf "${PROMO_CRF_TUSSEN:-14}" -pix_fmt yuv420p -r 30
     -video_track_timescale 30000 "${KLEUR[@]}")
ENC_EIND=(-c:v libx264 -preset medium -crf "${PROMO_CRF:-15}" -pix_fmt yuv420p -r 30
          -video_track_timescale 30000 "${KLEUR[@]}" -movflags +faststart)

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

rond() { awk -v v="$1" 'BEGIN{printf "%.2f", v}'; }

[ -f "$OVERLAYS/plan.txt" ] || { echo "promo/overlays/plan.txt ontbreekt — draai eerst: node promo/maak-overlays.mjs"; exit 1; }

# Verouderingscontrole: monteren op oude beelden is de makkelijkste manier om
# jezelf voor de gek te houden — je ziet een nieuwe video met de oude fouten.
nieuwste=$(ls -t "$OPNAMES"/*.webm 2>/dev/null | head -1 || true)
if [ -n "${nieuwste:-}" ] && [ "$HIER/scenes.ts" -nt "$nieuwste" ]; then
  echo
  echo "  ⚠  LET OP: scenes.ts is gewijzigd ná de laatste opname."
  echo "     Deze montage gebruikt verouderde beelden, en de fragmenttijden in"
  echo "     promo-teksten.json horen bij de OUDE opname. Neem opnieuw op en"
  echo "     herijk daarna de fragmenten met: bash promo/toon-frames.sh"
  echo
fi

rm -rf "$WERK"; mkdir -p "$WERK" "$UIT"
SCENES=()   # paden naar de gerenderde scènes, in volgorde

echo "› scènes bouwen"
while IFS= read -r regel; do
  [ -z "${regel// }" ] && continue
  IFS='|' read -r -a v <<< "$regel"
  type="${v[0]}"; id="${v[1]}"; doel="${v[2]}"
  png="$OVERLAYS/$id.png"
  uitbestand="$WERK/$id.mp4"

  # ── Dekkende kaarten (opening / slot) ────────────────────────────────────
  if [ "$type" = "kaart" ] || [ "$type" = "slot" ]; then
    "$FFMPEG" -nostdin -y -loglevel error -loop 1 -t "$doel" -i "$png" \
      -vf "scale=${DOEK_B}:${DOEK_H},fps=30,format=yuv420p,setsar=1" \
      "${ENC[@]}" "$uitbestand"
    printf "  %-6s %-16s %ss\n" "$type" "$id" "$doel"
    SCENES+=("$uitbestand")
    continue
  fi

  # ── Opnamescènes: fragmenten knippen, uitsnijden, aaneenzetten ───────────
  bronid="${v[3]}"
  bron="$OPNAMES/$bronid.webm"
  if [ ! -f "$bron" ]; then
    echo "  ! overgeslagen: $id (opname $bronid.webm ontbreekt)"
    continue
  fi
  bronduur=$(duur_van "$bron")

  FRAGS=()
  fnr=0
  for ((k=4; k<${#v[@]}; k++)); do
    IFS=':' read -r van tot zoom cx cy <<< "${v[$k]}"
    # van/tot allebei 0 = hele opname gebruiken (nog niet gekalibreerd)
    if awk -v a="$van" -v b="$tot" 'BEGIN{exit !(a==0 && b==0)}'; then
      van=0; tot="$bronduur"
      if awk -v d="$bronduur" -v doel="$doel" 'BEGIN{exit !(d > doel*1.5)}'; then
        echo "  ⚠  $id gebruikt de HELE opname (${bronduur}s) terwijl de streefduur ${doel}s is."
        echo "     Er zijn nog geen fragmenten gekozen. Deze scène wordt dus platgeslagen"
        echo "     versneld en dat ziet er gejaagd uit. Kies fragmenten:"
        echo "       bash promo/toon-frames.sh   → tijden aflezen"
        echo "       promo/promo-teksten.json    → van/tot invullen"
      fi
    fi
    # Buiten de opname vallen = duidelijk melden, niet stilzwijgend een zwart
    # of bevroren fragment produceren.
    if awk -v t="$tot" -v d="$bronduur" 'BEGIN{exit !(t > d + 0.05)}'; then
      echo "  ! $id fragment $((fnr+1)): tot=${tot}s valt buiten de opname (${bronduur}s) — bijgeknipt"
      tot="$bronduur"
    fi
    lengte=$(awk -v a="$van" -v b="$tot" 'BEGIN{printf "%.3f", b-a}')
    if awk -v l="$lengte" 'BEGIN{exit !(l <= 0.1)}'; then
      echo "  ! $id fragment $((fnr+1)): lengte ${lengte}s — overgeslagen"
      continue
    fi

    # Uitsnede berekenen in het referentievlak van de bron. Even afmetingen (h264).
    REF_B=$FRW; REF_H=$FRH
    read -r cw ch cxp cyp <<< "$(awk -v z="$zoom" -v cx="$cx" -v cy="$cy" -v rb="$REF_B" -v rh="$REF_H" 'BEGIN{
      if (z < 1) z = 1;
      w = int(rb/z); h = int(rh/z);
      w -= w % 2; h -= h % 2;
      x = int(cx*rb - w/2); y = int(cy*rh - h/2);
      if (x < 0) x = 0; if (y < 0) y = 0;
      if (x > rb-w) x = rb-w; if (y > rh-h) y = rh-h;
      printf "%d %d %d %d", w, h, x, y;
    }')"

    # Trage push-in over het fragment. Een stilstaande uitsnede oogt als een
    # screenshot; een paar procent langzaam inzoomen leest als camerabeweging
    # en houdt het beeld levend zonder de aandacht te trekken.
    if awk -v p="$PUSH" 'BEGIN{exit !(p > 0.0001)}'; then
      zmax=$(awk -v p="$PUSH" 'BEGIN{printf "%.4f", 1+p}')
      ztempo=$(awk -v p="$PUSH" -v l="$lengte" 'BEGIN{printf "%.6f", p/(l*30)}')
      beweging=",zoompan=z='min(${zmax}\\,1+${ztempo}*on)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${FRW}x${FRH}:fps=30"
    else
      beweging=""
    fi

    fragbestand="$WERK/$id-f$fnr.mp4"
    "$FFMPEG" -nostdin -y -loglevel error -i "$bron" -ss "$van" -t "$lengte" \
      -vf "scale=${REF_B}:${REF_H}:flags=lanczos,crop=${cw}:${ch}:${cxp}:${cyp},scale=${FRW}:${FRH}:flags=lanczos,fps=30${beweging},\
format=yuv420p,setsar=1" \
      -an "${ENC[@]}" "$fragbestand"
    FRAGS+=("$fragbestand")
    printf "    · fragment %d: %ss–%ss  (%ss, uitsnede ×%s + push-in)\n" \
      "$((fnr+1))" "$van" "$tot" "$(rond "$lengte")" "$zoom"
    fnr=$((fnr + 1))
  done

  if [ "$fnr" -eq 0 ]; then
    echo "  ! overgeslagen: $id (geen bruikbare fragmenten)"
    continue
  fi

  # Fragmenten aan elkaar met een korte overvloeier. Een harde snede binnen één
  # scène leest als een haperende opname; 0,25s is genoeg om het als montage te
  # laten lezen en te kort om traag te worden.
  ruw="$WERK/$id-ruw.mp4"
  if [ "${#FRAGS[@]}" -eq 1 ]; then
    cp "${FRAGS[0]}" "$ruw"
  else
    finv=(); ffilt=""; facc=""; fhuidig=""
    for i in "${!FRAGS[@]}"; do
      finv+=(-i "${FRAGS[$i]}")
      fd=$(duur_van "${FRAGS[$i]}")
      if [ "$i" -eq 0 ]; then facc="$fd"; fhuidig="[0:v]"; continue; fi
      foff=$(awk -v a="$facc" -v t="$FXF" 'BEGIN{printf "%.3f", a-t}')
      ffilt="${ffilt}${fhuidig}[$i:v]xfade=transition=fade:duration=${FXF}:offset=${foff}[fx$i];"
      facc=$(awk -v a="$facc" -v d="$fd" -v t="$FXF" 'BEGIN{printf "%.3f", a+d-t}')
      fhuidig="[fx$i]"
    done
    ffilt="${ffilt%;}"
    "$FFMPEG" -nostdin -y -loglevel error "${finv[@]}" -filter_complex "$ffilt" \
      -map "$fhuidig" -an "${ENC[@]}" "$ruw"
  fi
  echt=$(duur_van "$ruw")

  # Restcorrectie: alleen versnellen, nooit vertragen. De fragmenten bepalen
  # de inhoud; dit trekt de scène hooguit iets strakker naar de streefduur.
  factor=$(awk -v e="$echt" -v d="$doel" -v m="$MAX_VERSNELLING" \
    'BEGIN{f=e/d; if(f<1.03)f=1; if(f>m)f=m; printf "%.4f", f}')
  duur=$(awk -v e="$echt" -v f="$factor" 'BEGIN{printf "%.3f", e/f}')

  # Tekst laten binnenkomen in plaats van verschijnen: de onderregel vloeit in
  # over een halve seconde en schuift daarbij een klein stukje omhoog.
  #
  # Twee valkuilen die hier verwerkt zitten:
  #  - de PNG moet GELOOPT worden (-loop 1). Eén enkel frame heeft tijdstip 0,
  #    dus een fade die op 0,15s begint staat op dat frame permanent op alpha 0
  #    en de hele overlay blijft onzichtbaar.
  #  - komma's in de y-expressie moeten ontsnapt (\,), anders leest ffmpeg ze
  #    als scheidingsteken tussen filters.
  if [ "$LAYOUT" = "verticaal" ]; then
    # Drie lagen: vaste achtergrond (met venster, logo en voetnoot), daarop de
    # opname, en daar bovenop de tekst met een EIGEN in- en uitvloeier. Die
    # tekst is al weg vóór de scèneovergang begint en komt pas erna terug —
    # daardoor staan er tijdens een overvloeier nooit twee koppen tegelijk.
    tin="${PROMO_TEKST_IN:-0.35}"
    tuit=$(awk -v d="$duur" -v x="$XF" 'BEGIN{printf "%.3f", d - x - 0.15}')
    "$FFMPEG" -nostdin -y -loglevel error -i "$ruw" \
      -loop 1 -framerate 30 -t "$duur" -i "$png" \
      -loop 1 -framerate 30 -t "$duur" -i "$OVERLAYS/${id}-tekst.png" -filter_complex "\
[0:v]setpts=PTS/${factor},fps=30[v];\
[1:v][v]overlay=x=${VX}:y=${VY}:format=auto:shortest=1[onder];\
[2:v]format=rgba,fade=t=in:st=${tin}:d=0.45:alpha=1,fade=t=out:st=${tuit}:d=0.40:alpha=1[tekst];\
[onder][tekst]overlay=0:0:format=auto:shortest=1,format=yuv420p,setsar=1[o]" \
      -map "[o]" -an -shortest "${ENC[@]}" "$uitbestand"
  elif [ "$LAYOUT" = "kader" ]; then
    # De scène-PNG is hier de ACHTERGROND (dekkend, met schaduw en tekst); de
    # opname komt daar als venster bovenop. Het masker rondt de hoeken af.
    # Let op: zowel de PNG als het masker moeten gelooptd worden — één enkel
    # frame levert een stream op die na frame 1 stopt.
    "$FFMPEG" -nostdin -y -loglevel error -i "$ruw" \
      -loop 1 -framerate 30 -t "$duur" -i "$png" \
      -loop 1 -framerate 30 -t "$duur" -i "$OVERLAYS/masker.png" -filter_complex "\
[0:v]setpts=PTS/${factor},fps=30,format=rgba[v];\
[2:v]format=gray[m];\
[v][m]alphamerge[vr];\
[1:v][vr]overlay=x=${VX}:y=${VY}:format=auto:shortest=1,format=yuv420p,setsar=1[o]" \
      -map "[o]" -an -shortest "${ENC[@]}" "$uitbestand"
  else
    tekst_uit=$(awk -v d="$duur" 'BEGIN{printf "%.3f", d-0.45}')
    "$FFMPEG" -nostdin -y -loglevel error -i "$ruw" -loop 1 -framerate 30 -t "$duur" -i "$png" -filter_complex "\
[0:v]setpts=PTS/${factor},fps=30[v];\
[1:v]format=rgba,fade=t=in:st=0.18:d=0.55:alpha=1,fade=t=out:st=${tekst_uit}:d=0.4:alpha=1[ov];\
[v][ov]overlay=x=0:y='if(lt(t\,0.73)\,34*(1-t/0.73)\,0)':format=auto:shortest=1,format=yuv420p,setsar=1[o]" \
      -map "[o]" -an -shortest "${ENC[@]}" "$uitbestand"
  fi

  printf "  opname %-16s %ss → %ss (×%s, %d fragment(en))\n" \
    "$id" "$(rond "$echt")" "$(rond "$duur")" "$factor" "$fnr"
  SCENES+=("$uitbestand")
done < "$OVERLAYS/plan.txt"

[ "${#SCENES[@]}" -gt 0 ] || { echo "Geen bruikbare scènes gevonden."; exit 1; }

# ── Scènes aan elkaar met crossfades ────────────────────────────────────────
# Bewust géén fade-naar-zwart per scène (de eerste opzet deed dat): bij zes
# scènes levert dat ruim twee seconden zwartbeeld op, wat in een video van 35
# seconden leest als haperen. xfade laat het ene beeld in het andere overlopen.
echo "› samenvoegen (crossfade ${XF}s)"

INV=(); FILT=""; acc=""
for i in "${!SCENES[@]}"; do
  INV+=(-i "${SCENES[$i]}")
  d=$(duur_van "${SCENES[$i]}")
  if [ "$i" -eq 0 ]; then
    acc="$d"; huidig="[0:v]"
    continue
  fi
  offset=$(awk -v a="$acc" -v t="$XF" 'BEGIN{printf "%.3f", a-t}')
  label="[x$i]"
  FILT="${FILT}${huidig}[$i:v]xfade=transition=fade:duration=${XF}:offset=${offset}${label};"
  acc=$(awk -v a="$acc" -v d="$d" -v t="$XF" 'BEGIN{printf "%.3f", a+d-t}')
  huidig="$label"
done

eind=$(awk -v a="$acc" 'BEGIN{printf "%.3f", a-0.7}')
FILT="${FILT}${huidig}fade=t=in:st=0:d=0.5,fade=t=out:st=${eind}:d=0.7,format=yuv420p[out]"

"$FFMPEG" -nostdin -y -loglevel error "${INV[@]}" -filter_complex "$FILT" \
  -map "[out]" -an "${ENC_EIND[@]}" "$WERK/master-stil.mp4"
TOTAAL=$(duur_van "$WERK/master-stil.mp4")

# Naam volgt de opmaak: bij staand is 9:16 de master, niet 16:9.
if [ "$LAYOUT" = "verticaal" ]; then MASTER="$UIT/promo-9x16.mp4"; else MASTER="$UIT/promo-16x9.mp4"; fi

# ── Voice-over (optioneel) ──────────────────────────────────────────────────
# PROMO_STEM=/pad/naar/voice-over.mp3 bash promo/montage.sh
#
# De muziek duikt automatisch weg onder de stem (sidechaincompress) in plaats
# van met een vaste verlaging: zo blijft het bed hoorbaar in de stiltes tussen
# de zinnen, en verdwijnt het precies wanneer er gesproken wordt.
# PROMO_STEM_START verschuift de stem (default 0.8s, zodat hij niet exact op
# frame 1 begint).
if [ -n "${PROMO_STEM:-}" ] && [ ! -f "${PROMO_STEM}" ]; then
  echo "  ! PROMO_STEM=${PROMO_STEM} bestaat niet — voice-over overgeslagen"
  PROMO_STEM=""
fi

if [ -n "${PROMO_STEM:-}" ]; then
  stemvertraging=$(awk -v s="${PROMO_STEM_START:-0.8}" 'BEGIN{printf "%d", s*1000}')
  stempiek=$("$FFMPEG" -nostdin -hide_banner -i "$PROMO_STEM" -af volumedetect -f null - 2>&1 \
    | awk -F': ' '/max_volume/{gsub(/ dB/,"",$2); print $2}')
  stemgain=$(awk -v p="${stempiek:--6}" -v doel="${PROMO_STEM_PIEK:--4}" 'BEGIN{printf "%.2f", doel - p}')
  stemduur=$(duur_van "$PROMO_STEM")
  echo "› stem: ${stemduur}s, piek ${stempiek:-?} dB → ${stemgain} dB"
  if awk -v a="$stemduur" -v b="$TOTAAL" 'BEGIN{exit !(a > b + 0.4)}'; then
    echo "  ⚠  De voice-over (${stemduur}s) is LANGER dan de video (${TOTAAL}s)."
    echo "     Het laatste stuk valt weg. Kort de tekst in of laat rustiger inspreken."
  fi
fi

if [ -n "${PROMO_STEM:-}" ] && [ -n "${PROMO_MUZIEK:-}" ] && [ -f "${PROMO_MUZIEK}" ]; then
  # Stem én muziek: muziek op bedniveau, en daarbovenop wegduiken onder de stem.
  fade=$(awk -v t="$TOTAAL" 'BEGIN{printf "%.3f", (t-2.5)}')
  piek=$("$FFMPEG" -nostdin -hide_banner -i "$PROMO_MUZIEK" -af volumedetect -f null - 2>&1 \
    | awk -F': ' '/max_volume/{gsub(/ dB/,"",$2); print $2}')
  gain=$(awk -v p="${piek:--6}" -v doel="${PROMO_MUZIEK_PIEK:--24}" 'BEGIN{printf "%.2f", doel - p}')
  echo "› muziek onder stem: piek ${piek:-?} dB → ${gain} dB, duikt weg onder de stem"
  "$FFMPEG" -nostdin -y -loglevel error -i "$WERK/master-stil.mp4" -i "$PROMO_MUZIEK" -i "$PROMO_STEM" \
    -filter_complex "\
[1:a]volume=${gain}dB,volume=${PROMO_MUZIEK_VOLUME:-1.0},\
afade=t=in:st=0:d=1.5,afade=t=out:st=${fade}:d=2.5,apad,aformat=channel_layouts=stereo[muz];\
[2:a]volume=${stemgain}dB,adelay=${stemvertraging}|${stemvertraging},apad,aformat=channel_layouts=stereo[stem];\
[stem]asplit=2[stem1][stem2];\
[muz][stem1]sidechaincompress=threshold=0.03:ratio=12:attack=25:release=450:makeup=1[gedoken];\
[gedoken][stem2]amix=inputs=2:normalize=0:duration=longest[a]" \
    -map 0:v -map "[a]" -t "$TOTAAL" -c:v copy -c:a aac -b:a 256k -movflags +faststart "$MASTER"

elif [ -n "${PROMO_STEM:-}" ]; then
  # Alleen stem, geen muziek.
  echo "› alleen voice-over, geen muziek"
  "$FFMPEG" -nostdin -y -loglevel error -i "$WERK/master-stil.mp4" -i "$PROMO_STEM" \
    -filter_complex "[1:a]volume=${stemgain}dB,adelay=${stemvertraging}|${stemvertraging},apad,\
aformat=channel_layouts=stereo[a]" \
    -map 0:v -map "[a]" -t "$TOTAAL" -c:v copy -c:a aac -b:a 256k -movflags +faststart "$MASTER"

elif [ -n "${PROMO_MUZIEK:-}" ] && [ -f "${PROMO_MUZIEK}" ]; then
  fade=$(awk -v t="$TOTAAL" 'BEGIN{printf "%.3f", (t-2.5)}')
  # Niveau: meet de piek en pas één statische versterking toe. Bewust geen
  # loudnorm — dat is dynamisch en tilt bij een zachte track de ruisvloer mee
  # op (hoorbaar als windachtige ruis).
  piek=$("$FFMPEG" -nostdin -hide_banner -i "$PROMO_MUZIEK" -af volumedetect -f null - 2>&1 \
    | awk -F': ' '/max_volume/{gsub(/ dB/,"",$2); print $2}')
  gain=$(awk -v p="${piek:--6}" -v doel="${PROMO_MUZIEK_PIEK:--26}" 'BEGIN{printf "%.2f", doel - p}')
  echo "› muziek: piek ${piek:-?} dB → ${gain} dB (doel ${PROMO_MUZIEK_PIEK:--26} dB)"
  # Zachte opbouw richting het eindscherm: kubisch, dus vrijwel onhoorbaar in de
  # eerste helft en ca. +2 dB op het eind. Bewust zonder komma's in de expressie
  # — die leest ffmpeg als scheidingsteken tussen filters.
  "$FFMPEG" -nostdin -y -loglevel error -i "$WERK/master-stil.mp4" -i "$PROMO_MUZIEK" \
    -filter_complex "[1:a]volume=${gain}dB,volume=${PROMO_MUZIEK_VOLUME:-1.0},\
volume='1+0.30*(t/${TOTAAL})*(t/${TOTAAL})*(t/${TOTAAL})':eval=frame,\
afade=t=in:st=0:d=1.5,afade=t=out:st=${fade}:d=2.5[a]" \
    -map 0:v -map "[a]" -shortest -c:v copy -c:a aac -b:a 256k -movflags +faststart "$MASTER"
else
  cp "$WERK/master-stil.mp4" "$MASTER"
fi

# ── Bijsnijvarianten ────────────────────────────────────────────────────────
# Letterbox met de merkkleur i.p.v. bijsnijden: de onderregel staat links-
# onder in het 16:9-kader en zou bij een centrale crop wegvallen.
AUDIO=(); { [ -n "${PROMO_MUZIEK:-}" ] || [ -n "${PROMO_STEM:-}" ]; } && AUDIO=(-c:a copy)
variant() { # naam breedte hoogte
  echo "› variant $1"
  "$FFMPEG" -nostdin -y -loglevel error -i "$MASTER" \
    -vf "scale=$2:-2,pad=$2:$3:0:($3-ih)/2:color=${INK}" \
    -c:v libx264 -preset medium -crf "${PROMO_CRF_VARIANT:-17}" -pix_fmt yuv420p \
    "${KLEUR[@]}" -movflags +faststart "${AUDIO[@]}" "$UIT/promo-$1.mp4"
}
if [ "$LAYOUT" = "verticaal" ]; then
  echo "› staand formaat is de master — geen afgeleide varianten"
else
  variant "1x1"  1080 1080
  variant "4x5"  1080 1350
  variant "9x16" 1080 1920
fi

echo
echo "Totale duur: $(rond "$TOTAAL")s"
echo "Klaar:"
ls -lh "$UIT" | awk 'NR>1 {print "  " $9 "  " $5}'
