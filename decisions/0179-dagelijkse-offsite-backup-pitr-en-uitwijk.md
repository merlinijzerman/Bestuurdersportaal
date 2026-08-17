# 0179 — Dagelijkse off-site back-up nu; PITR en beproefde uitwijk als volgende fase

**Status:** Geaccepteerd
**Datum:** 2026-08-15
**Impact:** operations, security, continuïteit; geen datamodel- of RLS-wijziging

## Context

Het Bestuurdersportaal gebruikte één Supabase-productieproject zonder onafhankelijk gedocumenteerde back-up-, restore- of uitwijkketen. Op korte termijn is maximaal circa 24 uur gegevensverlies acceptabel. Een onafhankelijke kopie buiten Supabase is nodig; GitHub is geen geschikte back-upopslag voor databasekopieën en geheimen.

## Besluit

1. GitHub Actions maakt dagelijks om `01:30 UTC` een logische Supabase-dump van rollen, schema en data en schrijft die naar een private Backblaze B2-bucket.
2. De bucket gebruikt server-side encryptie en standaard 14 dagen Object Lock. Lifecycle/privacyretentie wordt afzonderlijk vastgesteld; 14 dagen immutability wordt niet als verwijdertermijn gepresenteerd.
3. Het huidige beoogde RPO is maximaal circa 24 uur. De RTO is onbekend totdat een restore- en uitwijkoefening is uitgevoerd.
4. Restore vindt eerst plaats naar een nieuw, leeg Supabase-project. Productie wordt niet als eerste restoredoel overschreven.
5. Bij uitwijk wordt pas na technische en functionele validatie omgeschakeld via de productie-omgevingsvariabelen en een redeploy. Een terugval naar de oude omgeving blijft onderdeel van het draaiboek.
6. PITR wordt later toegevoegd voor fijnmaziger en sneller herstel. De dagelijkse B2-kopie blijft daarna bestaan als onafhankelijke off-site laag.
7. Supabase Storage-metadata en fysieke objecten zijn onderdeel van de off-site
   keten; de fysieke objecten worden als afzonderlijk B2-archief met checksum
   opgeslagen en apart teruggezet.

## Alternatieven

- **Alleen providerback-ups:** verworpen omdat dit geen onafhankelijke off-site laag geeft en op het huidige plan niet voldoende herstelbewijs biedt.
- **Direct PITR:** uitgesteld; de huidige 24-uurs-RPO is tijdelijk acceptabel en de plan-/kostenkeuze volgt later.
- **GitHub als opslag:** verworpen; bronbeheer is geen passende opslag voor gevoelige databasearchieven, retentie, immutability en herstelbeheer.
- **Restore direct over productie:** verworpen vanwege het risico op onomkeerbare extra schade.

## Gevolgen en open acties

- GitHub-secrets staan in de afgeschermde environment `production-backup`, beperkt tot `main`.
- De B2-back-upsleutel is write-only; voor restore wordt tijdelijk een bucket-beperkte read-only sleutel gebruikt en daarna ingetrokken.
- De back-upketen en checksum zijn op 2026-08-15 bewezen. Ook het herstel van
  alle 118 applicatietabellen en de daaropvolgende P1-migratietest zijn groen.
  Een volledige restore is nog niet bewezen: de Supabase CLI sluit managed
  Auth/Storage-schema-DDL bewust uit en veronderstelt een actueel, leeg
  Supabase-doelproject. De gebruikte losse lokale Postgres-image had een andere
  managed Auth-schemaversie en stopte daarom terecht fail-closed.
- De geteste back-up bevatte 270 audit-events tegenover 272 in een latere
  read-only Productie-inventaris. Zij bewijst herstelgedrag, maar is niet de
  finale snapshot voor Productie-go/no-go.
- Eerstvolgend: de uitgebreide workflow publiceren, de ontbrekende
  configuratie/secrets toevoegen en een volledige restore-/uitwijkoefening naar
  een actueel, leeg Supabase-doelproject uitvoeren; lifecyclebesluit en later
  PITR blijven vervolgacties.
- Draaiboek: `04 Technische inrichting/Bestuurdersportaal - Back-up restore en uitwijk runbook v1.0.md`.

## Implementatie-addendum — 2026-08-17

De oorspronkelijke database-only workflow is uitgebreid naar een volledige
off-site keten voor de applicatiedata:

- de public dump blijft apart van Auth- en Storage-metadata;
- Auth-data en Storage-metadata worden expliciet met `pg_dump --data-only`
  vastgelegd;
- managed Auth/Storage-maatwerk (functies, RLS-state, policies en user-defined
  triggers) wordt apart geëxporteerd;
- alle vier toepassingsbuckets worden via de Storage API recursief gedownload,
  met per object SHA-256 en een aparte archive/checksum;
- B2-upload gebruikt retries, post-upload `head-object`-controle en een laatste
  completion marker;
- een zesuurlijkse watchdog alarmeert bij een mislukte run, ontbrekende objecten
  of een back-up ouder dan 26/48 uur.

De fysieke Storage-objecten zijn daarmee onderdeel van de geautomatiseerde
back-up, maar Supabase-providerconfiguratie, API-sleutels, Vault-secrets,
Vercel/DNS en externe integraties blijven bewust een aparte uitwijkcheck.
Zie `BACKUP-P0-RUNBOOK.md` voor secrets, restorevolgorde en acceptatiepoorten.

De P0-keten bevat daarnaast een afzonderlijke wekelijkse
`platform-inventory.yml`. Die legt niet-geheime Supabase- en Vercel-configuratie
vast, inclusief Vercel-variabelenamen zonder waarden. Secretwaarden, DNS,
externe webhooks en andere providercredentials blijven buiten de artefacten en
moeten via de secrets manager en de recovery-checklist worden hersteld.
