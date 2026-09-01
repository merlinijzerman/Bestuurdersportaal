#!/usr/bin/env bash
# ============================================================================
#  Lokale per-PR / pre-merge gateset — één entrypoint.
# ----------------------------------------------------------------------------
#  Zolang de epic-stack NIET naar GitHub gepusht is (blijft zo tot P6), draait
#  de GitHub-CI niet op deze branches. De pre-merge-borging is dus LOKAAL, en
#  die routine moet expliciet zijn — anders valt er stil een check uit de set
#  (dat gebeurde: P1b ging de epic in met een rode cross-tenant-check omdat
#  cross-tenant-ci.sh niet in de handmatige set zat).
#
#  Deze set spiegelt de blokkerende GitHub-checks. Draai 'm vóór elke merge van
#  een P-ticket in de epic:  bash scripts/gates.sh   (of: npm run gates)
#
#  De DB-laag van de cross-tenant-suite vereist een test-DB. Zet er één en geef
#  'm door zodat de DB-laag ECHT draait (anders meldt de suite 'm als
#  overgeslagen — precies het gat dat we dichten):
#     TEST_DATABASE_URL=postgresql://…  bash scripts/gates.sh
#  XTENANT_REQUIRE_DB=1 maakt een ontbrekende DB hard rood i.p.v. een stille skip.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

rood=""
stap() {
  echo ""
  echo "──────────────────────────────────────────────────────────────────────"
  echo "▶ $1"
  echo "──────────────────────────────────────────────────────────────────────"
}
draai() { # naam, commando…
  local naam="$1"; shift
  stap "$naam"
  if "$@"; then
    echo "✓ $naam"
  else
    echo "✗ $naam ROOD"
    rood="$rood\n  - $naam"
  fi
}

draai "typecheck (tsc)"                 npm run --silent typecheck
draai "sanity-suites"                   npm run --silent sanity
draai "lint:colors (merkkleuren)"       npm run --silent lint:colors
draai "migratie-mapindeling"            bash scripts/check-migratie-mapindeling.sh
# De check die stil wegrotte — nu vast in de set. Draait de app-laag altijd, en
# de DB-laag (incl. bewijsbinding + vaststelling-binding) als er een DB is.
draai "cross-tenant §15 (xtenant:ci)"   npm run --silent test:xtenant:ci

echo ""
echo "══════════════════════════════════════════════════════════════════════"
if [ -n "$rood" ]; then
  printf "GATES ROOD in:%b\n" "$rood"
  echo "Merge NIET. Los bovenstaande op en draai opnieuw."
  exit 1
fi
echo "GATES GROEN — alle lokale per-PR-checks geslaagd."
