#!/usr/bin/env bash
# ============================================================================
#  Driftdetectie Productie — twee signalen (fase 5).
# ----------------------------------------------------------------------------
#  SIGNAAL 1 — Productie versus de gepinde momentopname in de repo.
#    Vangt: iets is op Productie veranderd zonder dat de repo het weet.
#    Vangt NIET: een migratie die Productie nooit bereikte — dan verandert er
#    immers niets en blijft de momentopname kloppen.
#
#  SIGNAAL 2 — Productie versus Preview, beperkt tot de schema-vormige
#  categorieën (functie, policy, rls, publication, execute).
#    Vangt: precies wat signaal 1 mist. Een migratie die in de ene omgeving
#    landde en in de andere niet, laat hier een verschil achter.
#
#  Dat tweede signaal bestaat vanwege T14b: die migratie stond sinds 17 juli op
#  main, was toegepast op Preview, en bereikte Productie nooit. Vier weken lang
#  veranderde er op Productie niets — dus een controle die alleen naar
#  verandering kijkt, had niets gezien. Twee omgevingen naast elkaar leggen wél.
#
#  Bewust BUITEN signaal 2: storage.bucket en extensie. Die verschillen legitiem
#  per omgeving en zouden het signaal onbruikbaar ruisig maken. Ze zitten wel in
#  signaal 1, waar een verandering over tijd juist wél betekenis heeft.
#
#  Verbindingen zijn read-only (rol drift_lezer, zie drift-readonly-rol.sql).
#
#  Gebruik:
#    DRIFT_PROD_URL='postgresql://…' \
#    DRIFT_PREVIEW_URL='postgresql://…' \
#    bash scripts/drift-vergelijk.sh
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

MOMENTOPNAME="supabase/checks/2026_08_19_drift_momentopname.sql"
VERWACHT="supabase/checks/drift-momentopname-verwacht.txt"
WERKMAP="$(mktemp -d "${TMPDIR:-/tmp}/drift.XXXXXX")"
trap 'rm -rf "$WERKMAP"' EXIT

test -f "$MOMENTOPNAME" || { echo "FOUT: $MOMENTOPNAME ontbreekt." >&2; exit 1; }
test -n "${DRIFT_PROD_URL:-}" || { echo "FOUT: DRIFT_PROD_URL ontbreekt." >&2; exit 1; }

# Categorieën die tussen omgevingen gelijk horen te zijn.
SCHEMA_CATEGORIEEN='^(functie|policy|rls|publication|execute)\|'

echo "Momentopname Productie ophalen…"
psql "$DRIFT_PROD_URL" -v ON_ERROR_STOP=1 -At -f "$MOMENTOPNAME" > "$WERKMAP/prod.txt"
echo "  $(wc -l < "$WERKMAP/prod.txt" | tr -d ' ') regels."

# --pin legt de huidige Productietoestand vast als de nieuwe verwachting.
# Bewust een aparte handeling en niet iets wat de nachtrun zelf mag doen: een
# controle die zijn eigen verwachting bijwerkt, meldt per definitie nooit iets.
if [ "${1:-}" = "--pin" ]; then
  cp "$WERKMAP/prod.txt" "$VERWACHT"
  echo
  echo "Vastgelegd in $VERWACHT ($(wc -l < "$VERWACHT" | tr -d ' ') regels)."
  echo "Lees hem na vóór je commit: je verklaart hiermee de HUIDIGE toestand"
  echo "voor goed, inclusief eventuele drift die er nu al in zit."
  exit 0
fi

bevindingen=0

# ── Signaal 1 ───────────────────────────────────────────────────────────────
echo
echo "── Signaal 1: Productie versus de gepinde momentopname ──"
if [ ! -f "$VERWACHT" ]; then
  echo "  Nog geen gepinde momentopname ($VERWACHT)."
  echo "  Dit is de eerste run. Leg de huidige toestand vast met:"
  echo "    bash scripts/drift-vergelijk.sh --pin"
  echo "  en beoordeel die momentopname vóór je hem commit — je pint hem als"
  echo "  'goed', dus alles wat er nu in staat wordt daarmee geaccepteerd."
else
  if diff -u "$VERWACHT" "$WERKMAP/prod.txt" > "$WERKMAP/diff1.txt"; then
    echo "  Geen afwijking."
  else
    echo "  AFWIJKING — Productie wijkt af van de gepinde momentopname:"
    # De weergave wordt afgekapt; het VOLLEDIGE verschil gaat als artefact mee.
    #
    # De vorige vorm vergeleek het aantal GEWIJZIGDE regels met de WEERGAVElimiet
    # — twee verschillende grootheden. Een diff met 15 wijzigingen verspreid over
    # 200 regels context werd stilzwijgend afgekapt zonder melding, en de lezer
    # dacht alles te zien. Zo kwam op 22-08 een onvolledige driehoeksvergelijking
    # tot stand.
    totaal=$(wc -l < "$WERKMAP/diff1.txt" | tr -d ' ')
    regels=$(grep -c '^[+-]' "$WERKMAP/diff1.txt" || true)
    sed -n '4,80p' "$WERKMAP/diff1.txt" | sed 's/^/    /'
    echo "    ── $regels gewijzigde regels; de diff is $totaal regels lang ──"
    if [ "$totaal" -gt 80 ]; then
      echo "    WEERGAVE AFGEKAPT op regel 80. Het volledige verschil staat in het"
      echo "    artefact drift-diff1.txt van deze run — lees dat, niet dit."
    fi
    cp "$WERKMAP/diff1.txt" "drift-diff1.txt" 2>/dev/null || true
    bevindingen=$((bevindingen + 1))
  fi
fi

# ── Signaal 2 ───────────────────────────────────────────────────────────────
echo
echo "── Signaal 2: Productie versus Preview (schemavormige categorieën) ──"
if [ -z "${DRIFT_PREVIEW_URL:-}" ]; then
  echo "  Overgeslagen: DRIFT_PREVIEW_URL niet gezet."
  echo "  Let op: zonder dit signaal blijft een migratie die Productie nooit"
  echo "  bereikte onzichtbaar. Dat is het T14b-scenario."
else
  psql "$DRIFT_PREVIEW_URL" -v ON_ERROR_STOP=1 -At -f "$MOMENTOPNAME" > "$WERKMAP/preview.txt"
  grep -E "$SCHEMA_CATEGORIEEN" "$WERKMAP/prod.txt"    | LC_ALL=C sort > "$WERKMAP/prod_schema.txt"
  grep -E "$SCHEMA_CATEGORIEEN" "$WERKMAP/preview.txt" | LC_ALL=C sort > "$WERKMAP/prev_schema.txt"

  if diff -u "$WERKMAP/prev_schema.txt" "$WERKMAP/prod_schema.txt" > "$WERKMAP/diff2.txt"; then
    echo "  Preview en Productie zijn schemagelijk."
  else
    echo "  AFWIJKING — Preview (-) en Productie (+) lopen uiteen:"
    # De weergave wordt afgekapt; het VOLLEDIGE verschil gaat als artefact mee.
    #
    # De vorige vorm vergeleek het aantal GEWIJZIGDE regels met de WEERGAVElimiet
    # — twee verschillende grootheden. Een diff met 15 wijzigingen verspreid over
    # 200 regels context werd stilzwijgend afgekapt zonder melding, en de lezer
    # dacht alles te zien. Zo kwam op 22-08 een onvolledige driehoeksvergelijking
    # tot stand.
    totaal=$(wc -l < "$WERKMAP/diff2.txt" | tr -d ' ')
    regels=$(grep -c '^[+-]' "$WERKMAP/diff2.txt" || true)
    sed -n '4,80p' "$WERKMAP/diff2.txt" | sed 's/^/    /'
    echo "    ── $regels gewijzigde regels; de diff is $totaal regels lang ──"
    if [ "$totaal" -gt 80 ]; then
      echo "    WEERGAVE AFGEKAPT op regel 80. Het volledige verschil staat in het"
      echo "    artefact drift-diff2.txt van deze run — lees dat, niet dit."
    fi
    cp "$WERKMAP/diff2.txt" "drift-diff2.txt" 2>/dev/null || true
    echo
    echo "  Beoordeel per regel: is dit een bedoeld omgevingsverschil, of is"
    echo "  een migratie in één omgeving blijven steken? Zie de classificatie"
    echo "  uit fase 0.4 van de ontwerpnotitie."
    bevindingen=$((bevindingen + 1))
  fi
fi

echo
if [ "$bevindingen" -eq 0 ]; then
  echo "OK: geen drift gevonden."
else
  echo "DRIFT: $bevindingen van de 2 signalen sloeg aan."
  exit 1
fi
