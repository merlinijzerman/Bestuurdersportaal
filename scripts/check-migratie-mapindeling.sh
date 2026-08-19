#!/usr/bin/env bash
# ============================================================================
#  Mapindeling-gate voor supabase/ (fase 1, ontwerpnotitie migratieproces v2.1).
# ----------------------------------------------------------------------------
#  supabase/migrations/ mag UITSLUITEND echte forward-migraties bevatten.
#  Rollbacks en seeds horen ernaast:
#
#     supabase/migrations/      forward-migraties
#     supabase/rollbacks/       *_ROLLBACK.sql
#     supabase/seeds/preview/   omgevingsspecifieke seeds
#     supabase/seeds/schema/    schema-/referentieseeds
#
#  Waarom dit een gate is en geen afspraak: `supabase migration up` past ELK
#  geldig SQL-bestand in migrations/ toe. Eén rollback in die map betekent dat
#  de CLI hem uitvoert, direct ná zijn eigen forward-migratie. Vóór deze
#  herindeling stonden er 137 zulke bestanden in.
#
#  De invariant zit nu in de mapstructuur; deze check bewaakt dat het zo blijft.
#
#  NOG NIET afgedwongen: de 14-cijferige bestandsnaamconventie. De hernummering
#  is bewust uitgesteld (raakt 111 documenten en 128 bestandsnamen) en is pas
#  nodig zodra de CLI-ledger in gebruik wordt genomen. Zie fase 1.5 en 3.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

fout=0

ongeldig="$(find supabase/migrations -maxdepth 1 -name '*.sql' \
  \( -name '*ROLLBACK*' -o -name '*seed*' \) | LC_ALL=C sort)"
if [ -n "$ongeldig" ]; then
  echo "FOUT: supabase/migrations/ bevat rollback- of seedbestanden." >&2
  echo "$ongeldig" | sed 's/^/  /' >&2
  echo "" >&2
  echo "Verplaats ze naar supabase/rollbacks/, supabase/seeds/preview/ of" >&2
  echo "supabase/seeds/schema/. Zie de kop van dit script." >&2
  fout=1
fi

# Spiegelbeeld: een forward-migratie die per ongeluk in rollbacks/ belandt wordt
# nooit toegepast en valt anders pas op als productie iets mist.
verdwaald="$(find supabase/rollbacks -maxdepth 1 -name '*.sql' \
  ! -name '*_ROLLBACK.sql' 2>/dev/null | LC_ALL=C sort)"
if [ -n "$verdwaald" ]; then
  echo "FOUT: supabase/rollbacks/ bevat bestanden zonder _ROLLBACK-achtervoegsel." >&2
  echo "$verdwaald" | sed 's/^/  /' >&2
  fout=1
fi

# Derde controle, toegevoegd nadat de eerste verplaatsing dit precies fout deed:
# code en documentatie mogen niet meer naar een verplaatst bestand wijzen via
# supabase/migrations/. De mapgate hierboven ziet alleen wáár bestanden staan,
# niet wie ze leest. Zeven bestanden (sanity-tests, cross-tenant-tests,
# toets-fondsthema.mjs) lazen een seed of rollback op het oude pad en faalden
# pas in CI met ENOENT.
stale="$(git grep -nE 'supabase/migrations/[^ )`"'\''`]*(_ROLLBACK|seed)[^ )`"'\''`]*\.sql' \
  -- ':!scripts/check-migratie-mapindeling.sh' 2>/dev/null || true)"
if [ -n "$stale" ]; then
  echo "FOUT: verwijzingen naar supabase/migrations/ voor een verplaatst bestand:" >&2
  echo "$stale" | sed 's/^/  /' >&2
  echo "" >&2
  echo "Wijs naar supabase/rollbacks/, supabase/seeds/preview/ of" >&2
  echo "supabase/seeds/schema/, afhankelijk van waar het bestand nu staat." >&2
  fout=1
fi

if [ "$fout" -ne 0 ]; then
  exit 1
fi

echo "OK: mapindeling supabase/ schoon ($(find supabase/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ') forward-migraties, $(find supabase/rollbacks -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ') rollbacks, $(find supabase/seeds -name '*.sql' | wc -l | tr -d ' ') seeds)."
