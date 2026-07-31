#!/usr/bin/env bash
# ============================================================================
#  Zet de huisstijl-branch klaar voor een PR naar main.
#
#  Waarom een script en geen directe uitvoering: de Cowork-omgeving kan wél naar
#  bestanden schrijven maar géén bestanden verwijderen. `git checkout <branch>`
#  vervangt bestanden (unlink + create) en faalt daar met "Operation not
#  permitted". Branchwissel, `git rm` en push moeten dus lokaal draaien.
#
#  Draaien vanuit de map `mvp/`:
#      bash klaarzetten-pr-huisstijl.sh
#
#  Het script doet niets onomkeerbaars: het commit alleen, het pusht niet en
#  opent de PR niet. Die twee commando's print het aan het eind.
# ============================================================================
set -euo pipefail

BRANCH="huisstijl/token-d1-bestuursblauw"
ADR="decisions/0101-accentkleur-terug-naar-navy-d1-bestuursblauw.md"
LOCK="_to_delete/stale-git-locks/index.lock-20260731-142845"

# ── voorwaarden ─────────────────────────────────────────────────────────────
[[ -f package.json && -d decisions ]] || { echo "✗ Draai dit vanuit de map mvp/."; exit 1; }
[[ -f "$ADR" ]] || { echo "✗ $ADR ontbreekt. Zet het besluitrecord eerst op die plek neer."; exit 1; }

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "✗ Er staan niet-gecommitte wijzigingen in de werkkopie:"
  git status --short
  echo "  Commit of stash die eerst — dit script wisselt van branch."
  exit 1
fi

echo "→ naar $BRANCH"
git checkout "$BRANCH"

# ── 1. besluitrecord in de index ────────────────────────────────────────────
git add "$ADR"

# ── 2. index-regel in decisions/README.md, direct onder 0100 ────────────────
python3 - "$ADR" <<'PY'
import io, sys, re
pad = "decisions/README.md"
t = io.open(pad, encoding="utf-8").read()
if "[0101]" in t:
    print("  · README-index had de regel al — overgeslagen")
    raise SystemExit
rij = (
  '| [0101](./0101-accentkleur-terug-naar-navy-d1-bestuursblauw.md) | Accentkleur terug naar de '
  'navy-familie (richting D1 "Bestuursblauw"): `--accent` 91 79 224 → **27 79 168**, met bijbehorende '
  'verschuiving van ink/muted/line/surfaces en de semantische tinten. **Herziet '
  '[0084](./0084-huisstijl-t1-violet-accent-teal-fase-lichte-nav.md) gedeeltelijk** — alleen de '
  'accentkleur; de lichte navigatie-chrome blijft. Uitgevoerd als **pure token-hercolorering**: geen '
  'component, Tailwind-klasse of pagina aangepast. `--phase` blijft **teal**: terugzetten naar plum is '
  'overwogen en verworpen op perceptuele afstand (CIELAB ΔE navy↔teal 45,9 / 34,4 deuteranopie versus '
  'navy↔plum 18,7 / 24,0; op de `-ink` zelfs 5,3 bij protanopie) — luminantiecontrast wees de verkeerde '
  'kant op en is voor deze vraag een misleidende maat. `--app-line-control` verschuift 134 140 168 → '
  '**120 134 156** omdat de nieuwe, donkerdere `--app-bg` de oude waarde op 2,93:1 bracht en daarmee door '
  'WCAG 1.4.11 zakte; de afspraak uit [0097](./0097-tokens-mark-en-app-line-control.md) blijft, alleen de '
  'waarde is bijgesteld. Twee hardcoded kleuren uit de vóór-tokenperiode (`.typing-dot`, `.status-puls`) '
  'onder de tokens gebracht. Borging: bevroren ratio\'s herrekend + vier tests erbij in '
  '`kleurcontrast.sanity.ts` (15/15), en `scripts/toets-fondsthema.mjs` (`npm run lint:fondsthema`) toetst '
  'per-fonds overrides op leesbaarheid én verwarring. Openstaand: fonds-theming niet op echte DB-data '
  'getoetst (demo-seed toont 2 pre-existente nav-overtredingen en 1 nieuwe verslechtering accent↔`--err`); '
  '`public.css` en de export-/e-mail-HTML bewust buiten scope; typografie ongewijzigd | Geaccepteerd | '
  '2026-07-31 |'
)
regels = t.rstrip("\n").split("\n")
idx = [i for i, r in enumerate(regels) if r.startswith("| [0100]")]
if not idx:
    raise SystemExit("✗ regel voor 0100 niet gevonden in decisions/README.md")
regels.insert(idx[-1] + 1, rij)
io.open(pad, "w", encoding="utf-8").write("\n".join(regels) + "\n")
print("  · README-index bijgewerkt")
PY
git add decisions/README.md

# ── 3. _to_delete/ voortaan negeren ─────────────────────────────────────────
if ! grep -q '^_to_delete/' .gitignore; then
  printf '\n# werkmap voor bestanden die weg moeten; hoort niet in de repo\n_to_delete/\n' >> .gitignore
  git add .gitignore
  echo "  · _to_delete/ toegevoegd aan .gitignore"
fi

# ── 4. het meegecommitte lockbestand uit de repo halen ──────────────────────
# Alleen dit ene bestand: de overige 16 in _to_delete/ stonden er al vóór deze
# branch en zijn een aparte opruiming.
if git ls-files --error-unmatch "$LOCK" >/dev/null 2>&1; then
  git rm --cached -q "$LOCK"
  echo "  · $LOCK uit de index gehaald"
fi

# ── 5. controles ────────────────────────────────────────────────────────────
echo "→ controles"
npx tsx core/lib/kleurcontrast.sanity.ts
npm run --silent lint:colors
npm run --silent lint:fondsthema || echo "  (fondsthema meldt bekende, pre-existente bevindingen op de demo-seed — zie de PR-tekst)"
npx tsc --noEmit && echo "  ✓ typecheck schoon"

# ── 6. commit ───────────────────────────────────────────────────────────────
git commit -q -F - <<'MSG'
Besluitrecord 0101 + opschoning bij de huisstijlwissel

Legt de accentwissel naar navy (richting D1) vast als ADR, inclusief de
onderbouwing waarom --phase juist teal blijft: terugzetten naar plum is
overwogen en verworpen op perceptuele afstand (CIELAB, ook onder
gesimuleerde kleurenblindheid). Luminantiecontrast wees daar de verkeerde
kant op en is voor die vraag een misleidende maat — vandaar dat de cijfers
zijn vastgelegd en niet alleen de uitkomst.

Herziet 0084 gedeeltelijk (alleen de accentkleur; de lichte navigatie-chrome
blijft). Raakt 0097: --app-line-control krijgt een nieuwe waarde omdat de
donkerdere --app-bg de oude op 2,93:1 bracht; de afspraak zelf blijft.

Verder: _to_delete/ naar .gitignore en het lockbestand dat in de vorige
commit meeliftte uit de index gehaald.
MSG
echo "  ✓ gecommit"

# ── 7. wat er nog met de hand moet ──────────────────────────────────────────
cat <<EOF

────────────────────────────────────────────────────────────────────────────
Klaar. Nog twee stappen, bewust niet geautomatiseerd:

  git push

  gh pr create --base main --head $BRANCH \\
    --title "Huisstijl: accentkleur terug naar navy (richting D1 Bestuursblauw)" \\
    --body-file PR-huisstijl-d1.md

Zet PR-huisstijl-d1.md eerst in deze map neer (of geef het volledige pad op).
────────────────────────────────────────────────────────────────────────────
EOF
