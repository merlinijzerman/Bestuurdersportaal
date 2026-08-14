# 0176 — Fondsgerichte Preview-tenants binnen één geïsoleerde Preview-stack

- **Status:** Geaccepteerd
- **Datum:** 2026-08-14
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder), Codex (uitvoering/advies)
- **Relatie:** vult [`0175`](./0175-preview-productie-scheiding.md) aan en herziet
  alleen het daar gekozen enkelvoudige Preview-tenantmodel.

## Context

De generieke Preview op `app.bestuurdersportaal.com` is nodig voor regressie- en
externe tests. Daarnaast moeten fondsspecifieke aspecten vóór Productie worden
getest: hostresolutie, naam/logo/theming, modulemanifest, feature flags, rollen,
documentstromen, retrieval en AI-gedrag.

Daarvoor zijn twee soorten isolatie denkbaar. Een fysieke stack per fonds geeft
maximale scheiding, maar vermenigvuldigt Vercel-/Supabase-/Auth-/secretbeheer en
maakt schema- en migratiedrift waarschijnlijk. Eén Preview-stack met meerdere
tenants gebruikt juist dezelfde RLS- en hostgrenzen als Productie en maakt die
grenzen daardoor onderdeel van de acceptatietest.

## Besluit

1. De vaste Preview-stack krijgt een generieke sandbox op
   `app.bestuurdersportaal.com` en fondsgerichte Preview-hosts volgens het patroon
   `<fonds-slug>.preview.bestuurdersportaal.com`.
2. De eerste drie fondsgerichte hosts zijn:
   - `pgb.preview.bestuurdersportaal.com`;
   - `phenc.preview.bestuurdersportaal.com`;
   - `huisartsenpensioen.preview.bestuurdersportaal.com`.
3. Iedere host mapt in de Preview-database via een exacte, actieve
   `tenant_domains`-rij naar precies één Preview-tenant. Wildcard-DNS of een
   wildcard Vercel-domain is alleen transport; onbekende hosts blijven door de
   database-resolver fail-closed.
4. De Preview-tenants delen de Preview-code, schema-versie en Preview-only
   providers, maar data, accounts, Storage-toegang, configuratie en AI-quota zijn
   per `fonds_id` gescheiden.
5. Fondsconfiguratie mag gecontroleerd als inhoudsarm, versieerbaar manifest van
   Productie naar Preview worden overgenomen. Productiedata, sessies en secrets
   worden nooit gesynchroniseerd; er is geen live databasekoppeling.
6. Externe gebruikers worden standaard aan precies één fondsgerichte Preview-
   tenant gekoppeld, met minimale rol en einddatum. De generieke `app.*`-sandbox
   is geen loginhub voor die gebruikers.
7. Een fysieke Preview-stack per fonds is alleen nodig bij echte/niet-volledig
   gesynthetiseerde data, fonds-eigen identity-provider of secrets,
   contractuele isolatie, of destructieve/load-/hersteltests.
8. Iedere Preview-/Staging-build toont applicatiebreed een vaste, niet handmatig
   uitzetbare Preview-markering op basis van de Vercel-omgeving.

## Overwogen alternatieven

- **Alleen `app.*` met een fondskiezer na login.** Afgevallen: één host kan onder
  fail-closed host↔fondsafdwinging niet tegelijk de tenantgrens van meerdere
  fondsgebruikers zijn zonder de bestaande beveiligingsarchitectuur te verzwakken.
- **Een volledig Vercel- en Supabase-project per fonds.** Niet de standaard:
  operationeel zwaar en gevoelig voor migratiedrift. Blijft de escalatieoptie bij
  een concrete eis voor fysieke isolatie.
- **`preview-<slug>.bestuurdersportaal.com`.** Technisch mogelijk, maar de zone
  `<slug>.preview.bestuurdersportaal.com` groepeert DNS, certificaten en
  omgevingsherkenning duidelijker onder één Preview-namespace.

## Gevolgen

- Vercel Preview moet meerdere vaste custom domains aan dezelfde vaste branch of
  custom environment koppelen. Op het huidige Pro-abonnement kan één custom
  environment worden gebruikt; meerdere domeinen hoeven geen extra environment
  te betekenen.
- Supabase Preview bevat meerdere testtenants. Daarmee worden cross-fund-tests
  binnen Preview een harde releasepoort.
- `APP_HOST` is in Preview een komma-lijst. De hostparser ondersteunt dit al. De
  Productie-marketingredirect mag deze waarde nooit gebruiken; dat bestaande
  cutoverblok uit 0175 blijft staan.
- `DEPLOY_TARGET` blijft in Preview `app`: die variabele kiest de surface en mag
  niet als omgevingslabel `preview` krijgen. De lifecycle volgt uit
  `VERCEL_ENV`/`VERCEL_TARGET_ENV`.
- Supabase Auth gebruikt exacte callbackhosts voor de sandbox en ieder actief
  previewfonds; geen brede `*.bestuurdersportaal.com`-redirectallowlist.
- AI blijft aan, maar kosten- en requestquota worden naast gebruiker ook per
  Preview-`fonds_id` gemeten.
- Preview gebruikt standaard uitsluitend synthetische documenten. De bestaande
  dataresidentie-/providerpoort blijft leidend vóór niet-synthetische data naar
  AI- of OCR-providers mag.
- Een omgevingsspecifieke Preview-seed wordt pas toegevoegd nadat het Preview-
  project/branch-ID en een fail-safe uitvoeringsguard beschikbaar zijn; er komt
  geen universele migratie die Preview-hosts in Productie kan registreren.

## Referenties

- [`../security/OMGEVINGEN-RUNBOOK.md`](../security/OMGEVINGEN-RUNBOOK.md)
- [`../security/DREIGINGSMODEL.md`](../security/DREIGINGSMODEL.md)
- `core/lib/platform-host.ts`
- `core/lib/tenant-host.ts`
- `core/lib/fonds-config.ts`
- [Vercel environments](https://vercel.com/docs/deployments/environments)
- [Vercel domain aan een Git-branch koppelen](https://vercel.com/docs/domains/working-with-domains/assign-domain-to-a-git-branch)
- [Supabase branching en geïsoleerde omgevingen](https://supabase.com/docs/guides/deployment/branching)
