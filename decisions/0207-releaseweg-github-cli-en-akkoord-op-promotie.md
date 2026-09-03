# 0207 — Releaseweg zonder GitHub Desktop: vrije client, akkoord op de promotie naar main

- **Status:** Geaccepteerd
- **Datum:** 2026-09-03
- **Betrokkenen:** productowner (bestuurdersportaal), Claude Code
- **Herziet:** `CLAUDE.md` r. 53 (*"Deploy verloopt via GitHub Desktop … geen terminal-git commits"*)

## Context

De regel "geen terminal-git commits" dateert uit de periode waarin deployen betekende:
rechtstreeks naar `main` pushen. `security/RELEASEWEG-PREVIEW-EERST.md` legt de oorspronkelijke
formulering vast — *"Deploy verloopt via GitHub Desktop (commit → push `main` → Vercel
auto-deploy)"* — waarin het woord *preview* nul keer voorkwam. GitHub Desktop was toen de enige
rem: een mens die op een knop moest drukken.

Die situatie bestaat niet meer. Sinds 14-08-2026 wordt de releaseweg machinaal afgedwongen:
branch protection met `enforce_admins` (geverifieerd 20-08-2026), de required checks
`Cross-tenant isolatie (§15 T1-T14)`, `Security baseline (Sprint 1)`,
`Code-scheiding (T9 core/platform-grens)` en `Mapindeling supabase/`, en de check
`Previewpoort (naar main alleen vanuit preview)`. Geen van die controles hangt af van de client
waarmee gecommit wordt. De pre-commit-hook draait via `core.hooksPath` identiek vanuit een
terminal en vanuit Desktop.

Daarnaast is `gh` al onderdeel van de toolchain: `scripts/g2-evidence.sh` haalt het
branch-protection-bewijs op met `gh api` en gebruikt `gh run list`; vier workflows documenteren
`gh api`-commando's; `previewpoort.yml` instrueert in zijn eigen foutmelding
`gh pr edit <nummer> --base preview`.

De aanleiding is praktisch: deploys lopen via agentsessies, en een handmatige stap in GitHub
Desktop past daar niet in.

## Besluit

1. **De client is vrij**: GitHub CLI (`gh`) of GitHub Desktop.
2. **De releaseweg blijft ongewijzigd**: elke wijziging via een PR, feature-branch → `preview`
   → `main`, `main` alleen bereikbaar vanuit `preview`, hotfix-uitzondering via het label
   `hotfix-direct-naar-main`.
3. **Merges naar `preview` mogen autonoom** na groene checks, zonder dat er per PR iemand
   meeleest.
4. **De promotie naar `main` vereist een expliciet akkoord van de opdrachtgever**, gegeven ná
   een waargenomen preview-deploy en op basis van de releasenotitie in de promotie-PR.
5. `git commit --no-verify` is niet toegestaan.

## Motivering van punt 3

De Preview-omgeving heeft een **eigen Supabase-project** (`swviwoytzvaqypieqgji`), schema-only
opgezet, zonder tabeldata, gebruikers of objecten uit productie
(`security/SPRINT-1-BEWIJS-2026-08-14.md`). Een fout die op preview landt kost tijd, geen
fondsgegevens. De prijs van een autonome merge naar `preview` is daarmee een tijdvraag, geen
datarisico.

## Gevolgen

**Toegevoegd — twee lokale vangnetten die de menselijke rem vervangen:**

- `scripts/hooks/pre-commit` draait nu óók `npm run security:secrets`. Die geheimenscan draaide
  alleen in `test:ci`, dus ná de commit; nu is het het moment waarop een geheim nog tegen te
  houden is.
- `scripts/hooks/pre-push` (nieuw) weigert een rechtstreekse push naar `main` of `preview`.
  Branch protection doet dat server-side ook, maar pas ná een mislukte poging en zonder uitleg.

Beide hooks worden geactiveerd door het bestaande `prepare`-script
(`git config core.hooksPath scripts/hooks`) — geen nieuwe installatiestap.

**Af te dwingen op GitHub:** `main` vereist een PR, maar dat is niet hetzelfde als een verplichte
goedkeuring. Zonder *required approving reviews* kan de promotie-PR gemerged worden zonder dat
iemand op "approve" klikt. Controleren en zo nodig op 1 zetten:

```sh
gh api repos/{owner}/{repo}/branches/main/protection \
  --jq '.required_pull_request_reviews.required_approving_review_count'
```

**Releasenotitie per promotie:** de promotie-PR krijgt als body een `release-*.md` uit
`00 Overzicht en status/` met (a) welke PR's erin zitten, (b) wat er functioneel verandert en
(c) waar op preview naar gekeken moet worden. Zonder (c) is "waargenomen preview-deploy" niet
controleerbaar.

**Gatendekking wordt een voorwaarde, geen hygiëne.** De gates zijn nu de enige rem vóór
`preview`. Een geschreven controle die niet is aangesloten op `scripts/cross-tenant-ci.sh` of op
`--project component`, draait niet en beschermt dus niets (les C-01, V4/#81).

**Restrisico:** `git commit --no-verify` omzeilt beide hooks. Dat is niet langer zichtbaar vóór
`preview`, alleen nog in de diff van de promotie-PR. Aanvaardbaar zolang de required approving
review, de releasenotitie en de gatendekking staan; niet aanvaardbaar zonder.

## Alternatieven

- **Regel handhaven.** Afgewezen: hij beschermt niets wat de gates niet al afdwingen, kost een
  handmatige stap, en een regel die routinematig omzeild wordt ondermijnt het gezag van de regels
  die er wél toe doen.
- **Menselijke review op élke PR naar `preview`.** Afgewezen: gegeven dat preview geen
  productiedata bevat, weegt de vertraging niet op tegen de winst; het akkoord op de promotie
  dekt de batch.

## Verwijzingen

- `VOORSTEL-RELEASEWEG-ZONDER-GITHUB-DESKTOP.md` — de onderbouwing bij dit besluit.
- `security/RELEASEWEG-PREVIEW-EERST.md` — de releaseweg zelf, ongewijzigd.
