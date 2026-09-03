# Voorstel: releaseweg zonder GitHub Desktop

> **Status**: voorstel ter besluitvorming. Herziet `CLAUDE.md` r. 53 (*"geen terminal-git
> commits"*). Besluitnummer **0207** gereserveerd (0201 P1a · 0202 T3 · 0203 T5 · 0204 T1 ·
> 0205 T2 · 0206 T4).
> **Datum**: 3 september 2026
> **Aanleiding**: deploys lopen in de praktijk via agentsessies; GitHub Desktop is een
> handmatige stap die daar niet meer in past.

---

## 1. Waarom de huidige regel er staat — en waarom hij niet meer klopt

`RELEASEWEG-PREVIEW-EERST.md` legt de herkomst vast: `CLAUDE.md` r. 53 luidde oorspronkelijk
*"Deploy verloopt via GitHub Desktop (commit → push `main` → Vercel auto-deploy)"*, en het
woord *preview* kwam er nul keer in voor. De regel dateert dus uit de periode waarin
deployen betekende: rechtstreeks naar `main` duwen. GitHub Desktop was toen de enige rem —
een mens die op een knop moest drukken.

Sinds 14-08-2026 is die situatie vervangen door machinecontroles:

| Wat de regel ooit moest voorkomen | Wat het nu tegenhoudt |
|---|---|
| Per ongeluk naar `main` pushen | Branch protection met `enforce_admins`, geverifieerd 20-08-2026 — geblokkeerd, ook voor de eigenaar |
| Ongecontroleerd naar productie | Required checks: `Cross-tenant isolatie (§15 T1-T14)`, `Security baseline (Sprint 1)`, `Code-scheiding (T9)`, `Mapindeling supabase/` |
| Buiten de preview-eerst-weg om releasen | Check **`Previewpoort (naar main alleen vanuit preview)`** |
| Losse merkkleuren insluipen | `scripts/hooks/pre-commit` via `core.hooksPath` — draait identiek vanuit de terminal en vanuit Desktop |

Geen van die vier hangt af van de client waarmee je commit. **De regel beschermt vandaag niets
wat de gates niet al afdwingen; hij kost alleen een handmatige stap.**

Twee observaties die dat bevestigen:

1. **`gh` is al onderdeel van de toolchain.** `scripts/g2-evidence.sh` haalt het
   branch-protection-bewijs op met `gh api repos/{owner}/{repo}/branches/main/protection` en
   gebruikt `gh run list`; vier workflows documenteren `gh api`-commando's; en de
   foutmelding van `previewpoort.yml` instrueert `gh pr edit <nummer> --base preview`.
2. **Een regel die routinematig wordt omzeild, beschermt niets.** Met tientallen parallelle
   `codex/*`-branches en worktrees is de praktijk vermoedelijk al voorbij deze regel. Beter
   een expliciete regel die klopt dan een strenge regel die iedereen omloopt — dat laatste
   ondermijnt ook het gezag van de regels die er wél toe doen.

---

## 2. Voorstel

**Vervang** in `CLAUDE.md` r. 53 *"Deploy verloopt via GitHub Desktop (commit → push).
**Geen terminal-git commits.**"* **door:**

> **Deploy verloopt via de GitHub CLI (`gh`) of GitHub Desktop — de keuze is vrij.** Wat niet
> vrij is: elke wijziging gaat via een PR, feature-branch → `preview` → `main`, en `main` is
> alleen bereikbaar vanuit `preview`. Rechtstreeks pushen naar `main` of `preview` is
> geblokkeerd door branch protection én lokaal door de `pre-push`-hook. Commits gebeuren
> nooit met `--no-verify`. Merges naar `preview` mogen autonoom na groene checks; de
> **promotie naar `main` vereist een expliciet akkoord van de opdrachtgever**, gegeven ná een
> waargenomen preview-deploy en op basis van de releasenotitie in de promotie-PR (§7).

De rest van r. 53 (releaseweg, branch protection, Previewpoort, de hotfix-uitzondering)
blijft ongewijzigd.

---

## 3. Twee vangnetten die eerst geregeld moeten zijn

Ze vervangen de menselijke rem die GitHub Desktop was. **Doe dit vóór het besluit ingaat.**

**a. Geheimen in de pre-commit-hook.** `scripts/hooks/pre-commit` controleert nu alleen
merkkleuren (`lint:colors`). De geheimenscan `scripts/check-committed-secrets.sh` draait wel
in `test:ci`, maar dat is ná de commit. Voeg hem toe aan de hook:

```sh
npm run --silent lint:colors || { …bestaande melding… }
npm run --silent security:secrets || {
  echo "✗ Commit geblokkeerd: mogelijk geheim in de wijziging."
  exit 1
}
```

**b. Een `pre-push`-hook tegen een misplaatste push.** Branch protection weigert de push
server-side, maar pas ná een mislukte poging en zonder duidelijke uitleg. Lokaal is het
vriendelijker en sneller:

```sh
# scripts/hooks/pre-push
while read -r _ _ remote_ref _; do
  case "$remote_ref" in
    refs/heads/main|refs/heads/preview)
      echo "✗ Push naar ${remote_ref##*/} geweigerd — ga via een PR." ; exit 1 ;;
  esac
done
```

Beide hooks worden al geactiveerd door het bestaande `prepare`-script
(`git config core.hooksPath scripts/hooks`), dus er is geen nieuwe installatiestap.

---

## 4. De flow met `gh`

Eenmalig: `gh auth login` met de scopes `repo` en `workflow`.

```sh
# 1 · vertakken (altijd vanaf preview; main bevat alleen merge-commits)
git fetch origin
git worktree add ../mvp-t1-paneel -b feat/t1-assistentpaneel origin/preview

# 2 · werken en vastleggen — de pre-commit-hook draait
git add -A
git commit -m "feat(assistent): paneelschil in DashboardShell"

# 3 · pushen
git push -u origin feat/t1-assistentpaneel

# 4 · PR naar PREVIEW — --base is verplicht, gh kiest anders main
gh pr create --base preview \
  --title "T1 · Assistentpaneel (PR 1: paneelschil en ingangen)" \
  --body-file .github/pull_request_template.md

# 5 · checks live volgen
gh pr checks --watch

# 6 · mergen na groen
gh pr merge --squash --delete-branch

# 7 · promotie naar main, ná een WAARGENOMEN preview-deploy
gh pr create --base main --head preview --title "Release: T1 assistentpaneel"
gh pr checks --watch      # incl. Previewpoort
gh pr merge --merge
```

**De valkuil die je eigen workflow al benoemt**: `gh pr create` kiest standaard `main`. Vergeet
je `--base preview`, dan opent de PR naar `main` en zet **Previewpoort** hem hard rood. Dat is
geen storing maar de gate die werkt; herstel met `gh pr edit <nummer> --base preview`.

**Stap 7 blijft mensenwerk.** "Waargenomen preview-deploy" betekent: iemand heeft de
Preview-omgeving daadwerkelijk bekeken. Groene checks zijn geen waarneming. Dat is de enige
stap die niet geautomatiseerd mag worden — zie `security/RELEASEWEG-PREVIEW-EERST.md`.

---

## 5. Wat dit raakt

- `CLAUDE.md` r. 53 — de kernwijziging.
- `T3-RLS-CONTROLEKADER.md` r. 238, `WERKOPDRACHT-MONITORING-P5.md` r. 148-152,
  `SETUP.md` r. 158, `VRAAGROUTER-DOCUMENTDEKKING-PREVIEW-RUNBOOK.md` r. 33-36 en
  `security/OVERDRACHT-DEPLOY-PENTEST-CRITICAL-HIGH-2026-08-17.md` herhalen de oude regel.
  Werk ze bij of laat ze naar `CLAUDE.md` verwijzen — een regel die op zes plaatsen staat,
  loopt gegarandeerd uiteen.
- `WERKOPDRACHT-ASSISTENT-T1-PANEEL.md` §6 — pas aan zodra dit besluit is genomen.
- Nieuw besluitrecord **0207**, met §1 als motivering.

## 6. Wat dit niet is

Geen versoepeling van de releaseweg. Preview-eerst, de required checks, de Previewpoort, de
waargenomen preview-deploy en het PR-verplichte model blijven exact zoals ze zijn. Dit
voorstel wisselt alleen de **client** waarmee commits en PR's gemaakt worden, en voegt twee
lokale vangnetten toe die er nu niet zijn.

---

## 7. Waar het menselijke moment zit (besloten 3-9-2026)

**De opdrachtgever geeft ná preview expliciet akkoord voor de promotie naar `main`.** Dat is
het menselijke moment. Werk mag daarvóór autonoom door: agentsessies committen, pushen,
openen een PR naar `preview` en mergen die na groene checks, zonder dat er per PR iemand
meeleest.

Dat is verdedigbaar, om één reden die de moeite waard is expliciet te maken: **de
Preview-omgeving heeft een eigen Supabase-project** (`swviwoytzvaqypieqgji`), schema-only
opgezet, zonder tabeldata, gebruikers of objecten uit productie
(`security/SPRINT-1-BEWIJS-2026-08-14.md`). Een fout die op preview landt, raakt dus geen
echte fondsgegevens. De prijs van een autonome merge naar `preview` is verloren tijd, geen
datarisico.

Drie voorwaarden maken van dat akkoord een echte controle in plaats van een formaliteit:

**a. Machinaal afdwingen, niet als gewoonte.** `main` vereist vandaag een PR en
`enforce_admins` staat aan, maar dat is niet hetzelfde als een verplichte goedkeuring: zonder
*required approving reviews* kan de promotie-PR gemerged worden zonder dat iemand op
"approve" heeft geklikt. Controleer dat en zet het zo nodig op 1:

```sh
gh api repos/{owner}/{repo}/branches/main/protection \
  --jq '.required_pull_request_reviews.required_approving_review_count'
```

Zo wordt "ik geef expliciet akkoord" een regel die het systeem afdwingt, ook op een drukke dag.

**b. Een releasenotitie per promotie, als PR-body.** Bij autonoom mergen naar `preview`
verzamelt zich tussen twee promoties een batch die niemand PR-voor-PR heeft gelezen. Het
akkoord slaat op die hele batch. Geef de promotie-PR daarom de vorm die jullie al kennen —
een `release-*.md` in `00 Overzicht en status/` — met: welke PR's erin zitten, wat er
functioneel verandert, en **waar op preview naar gekeken moet worden**. Zonder dat lijstje is
"waargenomen preview-deploy" niet controleerbaar.

**c. De gates zijn nu de enige rem vóór preview.** Daarmee wordt de les uit C-01 harder dan
hij al was: een geschreven controle die niet in `scripts/cross-tenant-ci.sh` of in
`--project component` is aangesloten, draait niet — en beschermt dus niets. Elke nieuwe suite
aansluiten is vanaf nu geen hygiëne maar een voorwaarde.

**Restrisico, expliciet**: `git commit --no-verify` omzeilt de hooks. Dat is nu niet meer
zichtbaar vóór `preview`, alleen nog in de diff van de promotie-PR. Aanvaardbaar zolang (a),
(b) en (c) staan; niet aanvaardbaar zonder.
