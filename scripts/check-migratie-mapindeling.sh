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
#  Zolang de eigen baseline-runner leidend is, moet elke migratie de bestaande
#  `YYYY_MM_DD...`-vorm houden. Een losse CLI-timestamp (`YYYYMMDDhhmmss`) sorteert
#  vóór de baselinecutoff en wordt daardoor stil overgeslagen. De volledige
#  hernummering naar CLI-ledgernamen blijft uitgesteld tot fase 1.5 en 3.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

fout=0

# Voorkom een gemengde naamruimte: de replay in testdb-apply-migrations.sh
# vergelijkt bestandsnamen met een YYYY_MM_DD-cutoff. Een door `supabase
# migration new` gemaakte 14-cijferige naam zou daardoor niet worden toegepast,
# terwijl bijbehorende checks wel draaien.
onreplaybaar="$(find supabase/migrations -maxdepth 1 -name '*.sql' -print \
  | sed 's#supabase/migrations/##' \
  | grep -Ev '^20[0-9]{2}_[0-9]{2}_[0-9]{2}[a-z]*_.+\.sql$' \
  | LC_ALL=C sort || true)"
if [ -n "$onreplaybaar" ]; then
  echo "FOUT: migratiebestanden passen niet in de YYYY_MM_DD-replayvolgorde:" >&2
  echo "$onreplaybaar" | sed 's/^/  supabase\/migrations\//' >&2
  echo "Gebruik de bestaande repo-conventie zolang de CLI-ledger niet leidend is." >&2
  fout=1
fi

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
