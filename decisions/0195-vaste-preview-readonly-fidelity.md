# 0195 — Vaste Preview uitsluitend read-only voor nightly fidelity

- **Status:** Geaccepteerd — technisch gerealiseerd; eerste gehoste run open
- **Datum:** 2026-08-28
- **Betrokkenen:** Merlin (akkoord), Codex (uitvoering)
- **Herziet:** besluit 0046 optie B en het DB-doel uit besluit 0194; optie A, fail-closed gedrag en de GitHub-issuemelding blijven ongewijzigd

## Context

De oorspronkelijke optie B vereiste een aparte, blijvend betaalde Supabase
Preview Branch als wegwerpdatabase. Het Bestuurdersportaal heeft al een vaste,
van Productie gescheiden Preview-database. Die mag niet rechtstreeks door de
volledige §15-suite worden gebruikt: `cross-tenant-ci.sh` past eerst baseline en
alle migraties toe en voert daarna muterende gedragssuites uit. Dat botst met de
rol van Preview voor handmatige acceptatie en fondsgerichte rookproeven.

Tegelijk bestaat al een bewezen least-privilege rol `drift_lezer` en een
repositorysecret `DRIFT_DB_PASSWORD`. Deze rol leest uitsluitend catalogus en
bucketdefinities; fondsdata, storage-objecten, DDL en tabelwrites zijn dicht.

## Besluit

De nightly wordt gesplitst langs de bestaande verantwoordelijkheidsgrens:

1. de volledige app- en muterende DB-gedragssuite blijft in
   `rls-cross-tenant.yml` op een ephemere Supabase-stack draaien;
2. `nightly-fidelity.yml` gebruikt de vaste Preview uitsluitend read-only en
   vergelijkt de omgevingsonafhankelijke cataloguscategorieën `functie`,
   `policy`, `rls`, `publication` en `execute` met de goedgekeurde
   momentopname;
3. de workflow bouwt de verbinding zelf op uit de vaste Preview-ref, de vaste
   Preview-poolerhost en `DRIFT_DB_PASSWORD`; een preflight eist exact gebruiker
   `drift_lezer.<preview-ref>` en weigert iedere Productiebinding;
4. `PGOPTIONS=-c default_transaction_read_only=on` forceert read-only sessies;
   de runner bewijst aanvullend dat de rol geen superuser/BYPASSRLS/CREATE-
   rechten of `public`-tabelgrants heeft, en dat `public.profielen`,
   `storage.objects` en een proefwrite ontoegankelijk zijn;
5. baseline, migraties, seeds en muterende regressies worden in deze workflow
   contractueel verboden;
6. fail-closed, timeout, concurrency, bewijsartifact en het automatisch beheerde
   GitHub-incident uit besluit 0194 blijven gelden.

## Alternatieven

- **Vaste Preview als wegwerpdatabase gebruiken:** verworpen; blijvende DDL en
  generieke testseeds kunnen acceptatie en andere Preview-tenants raken.
- **Een betaalde Preview Branch aanhouden:** veilig maar verworpen zolang de
  read-only signalen de gehoste driftbehoefte dekken; dit voegt circa $9,80 per
  maand toe en dupliceert de ephemere gedragssuite.
- **Alleen de bestaande productie-driftworkflow gebruiken:** verworpen; WP0 wil
  een eigen fail-closed Preview-signaal en eigen herstelbewijs.

## Gevolgen

- De nightly bewijst gehoste schema-, functie-, policy-, RLS-, publication- en
  EXECUTE-fidelity zonder Preview-data te lezen of te wijzigen.
- De nightly bewijst niet opnieuw de volledige muterende §15-gedragsmatrix;
  daarvoor blijft de ephemere PR-run de autoritatieve poort.
- Preview-specifieke bucket- en extensieverschillen worden niet met de
  Productiemomentopname vergeleken. De bestaande driftworkflow bewaakt die
  categorieën volgens haar eigen omgevingsregels.
- Er is geen nieuw Supabase-project, databasebranch of maandelijkse resource
  nodig.

## Referenties

- `decisions/0046-cross-tenant-testsuite-testdb-strategie.md`
- `decisions/0194-nightly-fidelity-fail-closed.md`
- `.github/workflows/nightly-fidelity.yml`
- `scripts/preview-fidelity-readonly.sh`
- `scripts/verify-preview-fidelity-env.mjs`
- `scripts/drift-readonly-rol.sql`
- `supabase/checks/2026_08_19_drift_momentopname.sql`
