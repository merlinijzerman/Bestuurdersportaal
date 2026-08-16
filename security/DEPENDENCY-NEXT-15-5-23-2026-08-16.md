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
- `npm run build`: groen met lokale, onbruikbare Supabase-testwaarden;
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
  regressie door deze dependencytranche.

Er zijn tijdens de runtimesmokes geen echte provider-, Preview- of
Productiecredentials gebruikt. De tijdelijke servers en Supabase-stack zijn na
de tests gestopt en verwijderd.

## Resterende poort

1. voer de functionele login-, upload/export- en begrensde AI-smoke uit op de
   vaste Preview-environment, waar de juiste gescheiden configuratie actief is;
2. merge pas na die Preview-smoke en een expliciet akkoord;
3. behandel Next 16 en de vervanging van `xlsx` als afzonderlijke tranches.
