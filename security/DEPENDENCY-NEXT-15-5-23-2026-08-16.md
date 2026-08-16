# Dependencybewijs — Next.js 15.5.23

- **Datum:** 2026-08-16
- **Basis:** `origin/main` op `2a5da5b`
- **Branch:** `codex/next-15-5-23`
- **Scope:** uitsluitend de laatste patchrelease binnen Next.js 15.5
- **Omgevingen gewijzigd:** geen vaste omgeving; lokaal getest en via tijdelijke
  Vercel PR-deployments gecontroleerd

## Wijziging

`next` is van de lockfileversie `15.5.15` opgehoogd en exact gepind op
`15.5.23`. Het lockfile wijzigt uitsluitend Next.js, `@next/env` en de
platformgebonden `@next/swc-*`-pakketten. Er zijn geen overrides,
`npm audit fix --force`, React-upgrades of overige dependency-upgrades
toegepast.

Na de eerste vaste Preview-smoke is bovendien de functionele blocker in het
chatpad hersteld: `AssistentClient` maakt nu per logische gebruikersactie één
client-side idempotentiecontext en stuurt de sleutel als `Idempotency-Key` mee.
Een eventuele transportretry vanuit dezelfde context behoudt de sleutel; een
nieuwe gebruikersactie krijgt een nieuwe UUID. De server blijft fail-closed en
maakt bij een ontbrekende of ongeldige header geen eigen vervangende sleutel.

## Audituitkomst

Commando:

```bash
npm audit --omit=dev --audit-level=high --json
```

De productiestand blijft numeriek **1 critical en 9 high**. De directe
Next-core-advisories uit `15.5.15` zijn na de patch verdwenen. Het resterende
high-signaal op `next` loopt via de in Next 15.5 ingebouwde
`postcss@8.4.31` en optionele `sharp@0.34.5`; npm biedt hiervoor alleen
`next@16.3.1` als semver-majorfix.

Verder blijven onder meer `tar`, `@mapbox/node-pre-gyp`, `brace-expansion`,
`form-data`, `nanoid`, `ws` en het directe `xlsx@0.18.5` open. `xlsx` heeft
binnen npm geen beschikbare fix en vraagt een afzonderlijk vervangingsbesluit.

## Verificatie

- `npm ci`: groen;
- `npm run typecheck`: groen;
- `npm run sanity`: alle suites groen, inclusief Preview-AI-quota en kill switch;
- `npm run build`: groen met de bestaande lokale omgevingsconfiguratie; waarden
  zijn niet gelogd of naar de worktree gekopieerd;
- `core/lib/idempotency-key.sanity.ts`: **3/3 groen** — sleutelbehoud binnen één
  logische actie, een nieuwe sleutel voor een nieuwe actie en compatibiliteit
  met de servervalidatie;
- app-laag cross-tenant: **196/196 groen**;
- volledige `scripts/cross-tenant-ci.sh` tegen de met Supabase CLI `2.114.0`
  gestarte Postgres 17-wegwerpstack: groen, inclusief migratiereplay, RLS,
  Storage en AI-begrenzing;
- lokale productieruntime op de app-surface: `/login` rendert en hydrateert
  zonder browserwaarschuwingen, `/api/healthz/ping` geeft `{"ok":true}` en
  `/platform/login` is op de app-surface fail-closed `404`;
- lokale productieruntime op de platform-surface: `/login` rendert de
  MFA-verplichte platformlogin zonder browserwaarschuwingen.
- GitHub PR #13: alle verplichte en aanvullende checks groen, waaronder
  `Security baseline (Sprint 1)`, `Cross-tenant isolatie (§15 T1-T14)`,
  `Code-scheiding`, `lint-colors` en beide Vercel-deployments;
- tijdelijke app-PR-preview: `/login` rendert de app-login met zichtbare
  `PREVIEW · GEEN PRODUCTIEOMGEVING`-markering;
- tijdelijke beheer-PR-preview: de generieke Vercel Preview-environment bevat
  niet de fonds-/beheergerichte configuratie van de vaste Preview-environment
  en rendert daarom op `/login` de app-surface. Deze URL is niet geschikt voor
  de functionele beheer-smoke; dat is een bekende configuratiebeperking en geen
  regressie door deze dependencytranche;
- vaste Preview-branch `preview` is na een gecontroleerde fast-forward op commit
  `7d7d7b2` gezet; de vaste app- en beheerdeployments en alle branchchecks zijn
  groen. Eén dubbele Security-baselinerun faalde eerst uitsluitend op een
  tijdelijke downloadfout bij `fonts.gstatic.com`; de herstart op dezelfde
  commit is volledig groen, inclusief productiebuild;
- verse login op de eigen fondsgerichte host is groen voor PH&C (bestuurslid)
  en Huisartsen (bestuursbureau). PGB is conform de testafspraak overgeslagen;
- beheer-Preview is met de bestaande AAL2-sessie bereikbaar; startpagina,
  rechten, monitoring en AI-begrenzing renderen op de juiste platform-surface;
- upload op Huisartsen is groen voor aanlevering en opslag: het synthetische
  DOCX-bestand `Synthetische Next 15.5.23 Preview-smoke 2026-08-16` staat als
  `Overig`, bronstatus `Actief`, uitsluitend in de Huisartsen-fondsbibliotheek.
  De applicatie gaf de succesmelding en een fondsgebonden downloadroute; de
  browserconsole bleef foutvrij. De lokale bestandskeuze is handmatig afgerond
  nadat `Allow access to file URLs` voor de ChatGPT Chrome-extensie was
  geactiveerd;
- de async indexeringsstatus bleef tijdens meerdere hercontroles `Nog in
  verwerking`. Aanlevering en opslag zijn bewezen, maar de workerdoorloop en
  doorzoekbaarheid blijven daarom nog open;
- de idempotentiefix is functioneel groen op de vaste Huisartsen-Previewhost:
  exact één begrensde AI-call vanuit de bestuursbureauflow `Een stuk
  voorbereiden` → `Alleen een onderwerp` → `Memo` is volledig afgerond. De
  eerdere 400-melding bleef weg, het synthetische gesprek is opgeslagen en de
  teller ging van vijf naar zes gesprekken;
- de aansluitende Word-export is groen: de knop `Download als Word` riep de
  serverroute zonder zichtbare fout of consolefout aan en het DOCX-bestand is in
  de lokale downloadmap ontvangen. De browserbesturing zelf ving het
  download-event niet af; de ontvangst is daarom door de controleur in de lokale
  map bevestigd.

De lokale Preview-testcredentials zijn uitsluitend rechtstreeks uit het
git-uitgesloten bestand `.env.preview-tests.local` gebruikt en nergens gelogd of
in bewijs opgenomen. Er zijn geen provider- of Productiecredentials bekeken of
gebruikt. De tijdelijke servers en Supabase-stack zijn na de lokale tests
gestopt en verwijderd.

## Resterende poort

1. bewijs dat de async ingestworker het synthetische document van `Nog in
   verwerking` naar doorzoekbaar brengt;
2. merge pas na de workercontrole en een expliciet akkoord;
3. behandel Next 16 en de vervanging van `xlsx` als afzonderlijke tranches.
