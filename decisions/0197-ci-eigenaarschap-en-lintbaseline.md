# 0197 — Eén CI-eigenaar per controle en een ratelende lintbaseline

- **Status:** Geaccepteerd — lokaal bewezen; hosted PR-bewijs volgt
- **Datum:** 2026-08-29
- **Betrokkenen:** Merlin (akkoord op consolidatie en uitstel lintschuld), Codex (uitvoering)
- **Scope:** GitHub Actions, testcontracten, lintconfiguratie en testdocumentatie; geen product-, database-, RLS- of procedurewijziging

## Context

Een featurebranch met een open pull request startte dezelfde workflows zowel via
`push` als via `pull_request`. Daarnaast draaiden typecheck, sanity,
app-cross-tenant, boundaries, service-role-, kleur- en themacontroles in meerdere
workflows. Dat vergrootte compute en gaf meerdere rode signalen voor één oorzaak.
React-, Hooks- en Next-regels waren nog niet als brede kwaliteitscontrole actief.

De actuele GitHub-API-meting op 29 augustus 2026 geeft voor `preview` een 404
`Branch not protected`. Er zijn daarom geen required contexts om te migreren en
WP5 wijzigt geen repository-instellingen. De bestaande zichtbare jobnamen blijven
wel gelijk, zodat latere branch protection daarop kan aansluiten.

## Besluit

1. Featurebranches draaien de betreffende workflows alleen via
   `pull_request`; `push` is beperkt tot `main` en `preview`. Handmatige dispatch
   blijft beschikbaar waar die al bestond.
2. Iedere snelle controle heeft één primaire PR-eigenaar:

   | Controle | Primaire workflow |
   |---|---|
   | committed secrets, unit/componentcoverage, contracten, scanner, qualitylint, productiebuild en bundelcheck | `security-baseline.yml` |
   | typecheck, sanity en app-cross-tenant | `g2-evidence.yml` |
   | architectuurgrenzen en service-role-lek | `boundaries.yml` |
   | merkkleuren en fondsthema | `lint-colors.yml` |
   | echte RLS/RPC/Storage/grants tegen ephemere Supabase | `rls-cross-tenant.yml` |
   | API-karakterisering | `karakterisering.yml` |
   | browsersecurityflows | `e2e-security.yml` |

3. De RLS-workflow mag uitsluitend met de exacte waarde
   `XTENANT_FAST_LAGEN=overslaan` de al door `g2-evidence` uitgevoerde typecheck
   en app-matrix overslaan. `XTENANT_REQUIRE_DB=1` blijft verplicht en ontbrekend
   databasebewijs maakt de run rood.
4. Externe GitHub Actions worden op een volledige commit-SHA gepind met de
   semantische versie in commentaar. Relevante jobs krijgen een timeout;
   concurrency annuleert alleen verouderde runs van dezelfde workflow/ref.
5. Officiële React-, Hooks- en Nextregels draaien als afzonderlijke
   kwaliteitsconfiguratie. De uitgangsbaseline is **42 waarschuwingen, verdeeld
   over 9 regels en 28 bestanden**. `lint:quality:check` faalt bij iedere stijging
   per regel of bestand en staat geen errors toe; een daling is toegestaan.
6. De 42 bestaande bevindingen worden in een apart vervolg aangepakt. Er vindt
   in WP5 geen bulkfix plaats en procedurecode wordt niet inhoudelijk aangepast,
   omdat WP4 en de procedures bewust geparkeerd zijn.
7. Productiebouwen blijft in zowel securitybaseline, karakterisering als E2E
   bestaan. De outputs hebben verschillende environmentbindingen en worden niet
   zonder aantoonbare artifactbinding hergebruikt.

## Bewijs

- De workflowcontractsuite bewaakt branches, uniek eigenaarschap, volledige
  action-SHA's, behoud van jobnamen en fail-closed databasegedrag.
- De lintcontractsuite bewaakt de baselinevorm, reproduceerbaarheid en proven-red
  bij een kunstmatig toegevoegde overtreding.
- Lokaal zijn `npm run test:ci`, `npm run test:ops`, de productiebuild, de
  volledige DB-integratielaag en 14/14 Playwrighttests groen uitgevoerd.
- De drie representatieve voorafgaande feature-PR-workflows op commit `d15342f`
  waren dubbel gestart via push en PR: boundaries circa 39/41 s, G2 circa
  80/98 s en securitybaseline circa 207/195 s. Hosted na-meting volgt in de PR.

## Restrisico's en vervolg

- Zonder branch protection op `preview` zijn de checks informatief en niet door
  GitHub als mergevoorwaarde afgedwongen. Invoering daarvan vereist een apart,
  expliciet akkoord.
- `npm audit` meldt bestaande productieafhankelijkheidsbevindingen, waaronder in
  de huidige Next-stack. Automatische major-upgrades vallen buiten WP5 en krijgen
  een afzonderlijk dependency-onderhoudsitem.
- De 42 lintbevindingen worden per inhoudelijke categorie opgelost; iedere
  baselineverlaging wordt meegecommit zodat de ratel niet kan teruggroeien.

## Rollback

De wijziging is terug te draaien door de workflowtriggers en opdrachten terug te
zetten en de afzonderlijke qualityconfiguratie, baseline en contracttests te
verwijderen. Er is geen schema-, data-, RLS- of applicatiegedrag terug te draaien.

## Referenties

- `.github/workflows/security-baseline.yml`
- `.github/workflows/g2-evidence.yml`
- `.github/workflows/boundaries.yml`
- `.github/workflows/lint-colors.yml`
- `.github/workflows/rls-cross-tenant.yml`
- `eslint.quality.config.mjs`
- `lint-quality-baseline.json`
- `scripts/ci-ownership-workflows.test.mjs`
- `scripts/lint-quality-baseline.test.mjs`
