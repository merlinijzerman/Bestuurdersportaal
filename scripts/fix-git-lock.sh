#!/usr/bin/env bash
# ============================================================
#  fix-git-lock.sh — verwijdert achtergebleven git-lockbestanden
# ============================================================
# Wanneer gebruiken: GitHub Desktop (of git) meldt "A lock file already
# exists in the repository". Dat gebeurt als een eerdere git-operatie is
# gecrasht of afgebroken en het lockbestand (.git/index.lock e.d.) is
# blijven staan.
#
# Gebruik (Terminal):
#   1. Sluit GitHub Desktop volledig (Cmd+Q) — belangrijk!
#   2. cd "/Users/merlinijzerman/Documents/Claude/Projects/MVP bestuurdersportaal/mvp"
#   3. bash scripts/fix-git-lock.sh
#
# Het script is veilig: het controleert eerst of er nog een git-proces
# draait en verwijdert alleen bekende lockbestanden, nooit repo-data.

set -euo pipefail

# Repo-root = één niveau boven de scripts-map, ongeacht vanwaar je start.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GIT_DIR="$REPO_DIR/.git"

if [ ! -d "$GIT_DIR" ]; then
  echo "❌ Geen .git-map gevonden in: $REPO_DIR"
  exit 1
fi

# Veiligheidscheck: draait er nog een git-proces? Dan kan de lock legitiem
# in gebruik zijn — eerst dat proces (of GitHub Desktop) afsluiten.
if pgrep -x git >/dev/null 2>&1; then
  echo "⚠️  Er draait nog een git-proces. Sluit GitHub Desktop (Cmd+Q) en"
  echo "    wacht enkele seconden, of herstart je Mac als dit blijft hangen."
  echo "    Daarna dit script opnieuw uitvoeren."
  exit 1
fi

# Bekende locklocaties: index.lock (commit/stage), HEAD.lock, refs-locks,
# config.lock en packed-refs.lock.
GEVONDEN=0
while IFS= read -r lock; do
  GEVONDEN=1
  echo "🔓 Verwijderen: ${lock#$REPO_DIR/}"
  rm -f "$lock"
done < <(find "$GIT_DIR" -maxdepth 4 -name "*.lock" -type f 2>/dev/null)

if [ "$GEVONDEN" -eq 0 ]; then
  echo "✅ Geen lockbestanden gevonden — de repository is al vrij."
else
  echo "✅ Klaar. Open GitHub Desktop opnieuw en probeer de commit nogmaals."
fi
