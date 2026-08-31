#!/usr/bin/env bash
# Start de wegwerp-Supabase-stack zonder dat de CLI de historische migratiemap
# automatisch probeert af te spelen.
#
# De repository heeft bewust een eigen baseline-/replayvolgorde in
# testdb-apply-migrations.sh, omdat de historische bestandsnamen geen lineaire,
# CLI-veilige keten vormen. Nieuwere CLI-versies voeren bij `supabase start`
# standaard migrations/* uit. Daarom staat die map alleen tijdens het booten in
# een tijdelijke directory en wordt zij via de EXIT-trap altijd teruggezet.
set -euo pipefail
cd "$(dirname "$0")/.."

migraties="supabase/migrations"
tijdelijk="$(mktemp -d "${TMPDIR:-/tmp}/bp-supabase-start.XXXXXX")"

herstel_migraties() {
  if [ -d "$tijdelijk/migrations" ]; then
    mv "$tijdelijk/migrations" "$migraties"
  fi
  rmdir "$tijdelijk" 2>/dev/null || true
}
trap herstel_migraties EXIT

if [ ! -d "$migraties" ]; then
  echo "FOUT: $migraties ontbreekt; ephemere stack niet gestart." >&2
  exit 1
fi

mv "$migraties" "$tijdelijk/migrations"
if command -v supabase >/dev/null 2>&1; then
  supabase start
else
  # Lokale ontwikkelmachine: dezelfde gepinde CLI als CI. `latest` kan een
  # andere Postgres-/default-ACL-combinatie starten en maakt de replay dan
  # lokaal vals-rood of -groen t.o.v. de verplichte checks.
  npx --yes supabase@2.114.0 start
fi
