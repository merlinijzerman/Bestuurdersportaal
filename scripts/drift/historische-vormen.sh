#!/usr/bin/env bash
# ============================================================================
#  #440 — legt per migratie vast WELKE VORM zij van een object achterlaat.
# ----------------------------------------------------------------------------
#  Waarom dit bestaat: de eerste versie kon alleen zeggen "de eindvorm klopt
#  niet", niet WELKE schakel ontbrak. Dat was de opgeschreven beperking, en de
#  meting op Preview liet meteen zien waarom hij pijnlijk is: `fn_access_token_hook`
#  wijkt af, en de vraag "welke migratie mist dan?" bleef onbeantwoord.
#
#  Werkwijze: baseline toepassen, dan migratie voor migratie in ketenvolgorde,
#  en na ELKE stap de vingerafdrukken meten. Verandert een object, dan is die
#  migratie de auteur van die vorm. Zo ontstaat een historie van vormen per
#  object, en kan een afwijkende doelomgeving worden teruggekoppeld aan de
#  migratie waarvan zij de vorm nog draagt.
#
#  Draait UITSLUITEND tegen een wegwerp-DB.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

DB_URL="${TEST_DATABASE_URL:-${DATABASE_URL:-}}"
[ -n "$DB_URL" ] || { echo "FOUT: TEST_DATABASE_URL vereist." >&2; exit 1; }
if psql "$DB_URL" -tAc "select 1 from public.tenant_domains where host like '%bestuurdersportaal.com' limit 1" 2>/dev/null | grep -q 1; then
  echo "FOUT: deze database draagt een tenant-host en is dus geen wegwerp-referentie." >&2
  exit 1
fi

CUTOFF="$(grep -oE '^BASELINE_CUTOFF="[^"]+"' scripts/testdb-apply-migrations.sh | cut -d'"' -f2)"
UIT="supabase/checks/440-historische-vormen.generated.tsv"
OVERGESLAGEN="supabase/checks/440-historie-onbekend.generated.txt"
# Tempmap ONDER de repo: sommige psql-opstellingen (o.a. een container-shim)
# zien /tmp van de host niet. De trap ruimt hem op.
# RELATIEVE tempmap onder de repo. Absoluut zou hier niet werken: sommige
# psql-opstellingen (o.a. een container-shim) zien de host-paden niet en
# resolven alles binnen de werkmap. De trap ruimt hem op.
TMP=".440-tmp.$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

# ── Prep HERGEBRUIKEN, niet overtypen ───────────────────────────────────────
# testdb-apply-migrations.sh maakt extensies en fixture-rollen (microsoft_vault,
# copilot_operator, ai_gateway) aan vóór de eerste migratie. Zonder die rollen
# weigeren migraties als 423a fail-closed — terecht. Een eigen kopie van die
# prep zou een tweede waarheid zijn; daarom knippen we dezelfde heredocs eruit.
python3 scripts/drift/knip-prep.py "$TMP/prep.sql"

echo "→ extensies, baselines en fixture-rollen"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -c "create extension if not exists vector; create extension if not exists \"uuid-ossp\"; create extension if not exists pgcrypto;"
for b in supabase/baseline/2026_08_14_preview_public.sql \
         supabase/baseline/2026_08_14_auth_hooks.sql \
         supabase/baseline/2026_08_14_storage_custom.sql; do
  psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$b" >/dev/null
done
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$TMP/prep.sql" >/dev/null

meet() { psql "$DB_URL" -tAF$'\t' -f scripts/drift/vingerafdruk.sql | sort; }

echo "→ nulmeting (baseline-stand)"
meet > "$TMP/vorig"
printf 'sectie\tsch\tobj\tvingerafdruk\tmigratie\n' > "$UIT"
awk -F'\t' '{print $1"\t"$2"\t"$3"\t"$4"\t(baseline)"}' "$TMP/vorig" >> "$UIT"
: > "$OVERGESLAGEN"

n=0; mislukt=0
for pad in $(ls supabase/migrations/*.sql | sort); do
  mig="$(basename "$pad")"
  [[ "$mig" > "$CUTOFF" ]] || continue
  if ! psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$pad" > "$TMP/fout.log" 2>&1; then
    # NIET stil overslaan. Een onvolledige historie levert later valse
    # 'afwijkend'-meldingen op, en dat is erger dan geen historie.
    echo "$mig" >> "$OVERGESLAGEN"
    echo "   ! $mig FAALDE: $(grep -m1 ERROR "$TMP/fout.log" | cut -c1-160)" >&2
    mislukt=$((mislukt+1))
    continue
  fi
  meet > "$TMP/nu"
  comm -13 "$TMP/vorig" "$TMP/nu" | awk -F'\t' -v m="$mig" '{print $1"\t"$2"\t"$3"\t"$4"\t"m}' >> "$UIT"
  mv "$TMP/nu" "$TMP/vorig"
  n=$((n+1))
done

echo "→ $n migraties afgespeeld; $(( $(wc -l < "$UIT") - 1 )) vormregels"
if [ "$mislukt" -gt 0 ]; then
  echo "FOUT: $mislukt migratie(s) konden niet worden afgespeeld; de historie is onvolledig." >&2
  echo "      Zie $OVERGESLAGEN. Repareer de replay vóór je het driftscript genereert:" >&2
  echo "      een onvolledige historie meldt straks drift die er niet is." >&2
  exit 1
fi
rm -f "$OVERGESLAGEN"
echo "VOLLEDIG: elke migratie ná de cutoff is afgespeeld."
