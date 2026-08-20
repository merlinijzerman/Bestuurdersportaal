# P0 — back-upketen, Storage en restore

**Status:** implementatie gereed voor configuratie en gecontroleerde cloudtest  
**Datum:** 2026-08-17  
**Eigenaar:** technisch beheer / incidentleider

## Wat nu wordt opgeslagen

De workflow `.github/workflows/supabase-backup.yml` maakt dagelijks om 01:30
UTC twee onafhankelijke archieven in Backblaze B2. De completion marker wordt
pas als laatste geschreven, nadat alle objecten met `head-object` op aanwezigheid
en bestandsgrootte zijn gecontroleerd.

| Component | Bestand/onderdeel | Dekking |
|---|---|---|
| Eigen database | `roles.sql`, `schema.sql`, `data.sql` | Ja |
| Supabase Auth-data | `auth-data.sql` | Ja, inclusief gebruikers-/identiteitsdata |
| Storage-metadata | `storage-data.sql` | Ja, inclusief buckets en objectmetadata |
| Auth/Storage-maatwerk | `managed-customizations.sql` | Ja, functies, RLS-state, policies en user-defined triggers |
| Fysieke documenten | afzonderlijk Storage-archief | Ja, alle vier expliciete buckets, per object met SHA-256 |
| Niet-geheime platforminventaris | `platform-inventory/...json` | Ja, Supabase/Vercel-configuratie en Vercel-variabelenamen |
| Supabase Auth-providerinstellingen | `platform-inventory/...json` | Gedeeltelijk: niet-geheime instellingen ja; credentials nee |
| Secretwaarden, Vault-secrets, DNS en externe webhooks | providerconfiguratie | Nee; bewust uitgesloten |

De bucketlijst is bewust exact: `documenten`, `documenten-quarantaine`,
`afschriften` en `aqlab-audit`. Als Supabase een extra bucket teruggeeft, stopt
de back-up totdat die bucket expliciet aan de configuratie is toegevoegd.

## Vereiste GitHub-configuratie

Maak dit in environment `production-backup`, met deployment-branchbeperking op
`main`:

Secrets:

- `SUPABASE_DB_PASSWORD`
- `SUPABASE_SERVICE_ROLE_KEY` — uitsluitend voor Storage-lezen tijdens de back-up
- `B2_APPLICATION_KEY_ID` en `B2_APPLICATION_KEY` — write-only voor de back-upworkflow
- `B2_READONLY_APPLICATION_KEY_ID` en `B2_READONLY_APPLICATION_KEY` — alleen lezen/listen voor de watchdog
- `BACKUP_ALERT_WEBHOOK_URL` — endpoint van de afgesproken incident-/alertdienst
- `SUPABASE_MANAGEMENT_API_TOKEN` — read-only Management API-token voor de
  platforminventaris; nooit in een artefact of log opnemen
- `VERCEL_TOKEN` — read-only Vercel-token voor project- en variabelenameninventaris

Variables:

- `B2_BUCKET_NAME`
- `B2_S3_ENDPOINT`, bijvoorbeeld `https://s3.eu-central-003.backblazeb2.com`
- `VERCEL_PROJECT_IDS` — komma-gescheiden lijst van alle Vercel-projecten
  (minimaal productie en het aparte beheerproject). Voor de huidige productie-
  configuratie: `bestuurdersportaal,bestuurdersportaal-beheer`.
- `bestuurdersportaal-scanner` is bewust uitgesloten; dit is een afzonderlijke
  securitydienst en geen onderdeel van de productie-uitwijk.
- `VERCEL_TEAM_ID` — alleen invullen wanneer het project onder een team valt

De write-key wordt niet voor restore gebruikt en moet de prefixes `supabase/`,
`backup-status/` en `platform-inventory/` kunnen schrijven. De read-only sleutel
moet minimaal diezelfde prefixes kunnen lezen/listen. De webhook
krijgt alleen statusinformatie, run-URL en objectpaden; geen database-URL,
tokens of documentinhoud.

## Retry en alarmering

- Iedere B2-upload gebruikt AWS-retries plus vijf expliciete uploadpogingen met
  exponentiële wachttijd.
- De `backup-status/.../manifest-*.json` completion marker wordt pas na alle
  uploads en lokale controles geüpload.
- `supabase-backup-watchdog.yml` draait iedere zes uur en controleert:
  - laatste complete marker;
  - checksum van de marker;
  - ouderdom: waarschuwing boven 26 uur, kritiek boven 48 uur;
  - manifestdekking voor Auth, Storage-metadata en fysieke Storage-objecten;
  - aanwezigheid van alle gerefereerde B2-objecten.
- Een mislukte back-uprun triggert via `workflow_run` direct dezelfde webhook.
- `platform-inventory.yml` draait wekelijks en legt niet-geheime Supabase- en
  Vercel-configuratie vast. De watchdog verwacht binnen 14 dagen een complete
  inventarismarker en alarmeert als configuratiedekking ontbreekt.

Als `BACKUP_ALERT_WEBHOOK_URL` ontbreekt, faalt de watchdog bewust. Een groene
back-up zonder werkende alertbestemming geldt dus niet als P0-gereed.

## Platformconfiguratie en secrets

De Management API-inventaris gebruikt uitsluitend read-only endpoints. De
workflow vraagt geen API-keywaarden, Vault-secrets, JWT-secrets, SMTP-wachtwoorden
of Vercel-environmentwaarden op. Van Vercel worden alleen namen, targets en
metadata vastgelegd; `values_captured` staat expliciet op `false`.

De inventaris wordt als `platform-inventory/...json` met checksum in B2 gezet en
heeft een eigen completion marker onder
`backup-status/platform-inventory/`. Een gedeeltelijke inventaris wordt niet
gepubliceerd als complete marker. DNS, externe webhooks en secretwaarden blijven
een handmatig beheerde recovery-checklist en horen in een password/secrets
manager, niet in dit archief.

## Restore-oefening

### Voorwaarden

1. Kies een nieuw, leeg tijdelijk Supabase-project. Gebruik niet Productie,
   Preview of een project met klantdata.
2. Controleer PostgreSQL-majorversie en benodigde extensies.
3. Maak een tijdelijke, bucket- en prefix-beperkte B2-read-only sleutel.
4. Leg bronproject, doelproject, back-upobject, T0–T8 en uitvoerders vast.
5. E-mail, AI-calls, cronjobs, webhooks en publieke DNS blijven uit.

### Database

Download het database-archief en het bijbehorende `.sha256`-object. Voer daarna
uit met een expliciet bevestigde doelprojectref:

```bash
export TARGET_DB_URL='postgresql://postgres.<DOELREF>:<WACHTWOORD>@<DOELHOST>:5432/postgres'
export TARGET_PROJECT_REF='<DOELREF>'
export TARGET_IS_EMPTY_CONFIRMED=YES
export RESTORE_WORKDIR="$(mktemp -d)"

bash scripts/restore-supabase-backup.sh \
  /veilig/pad/bestuurdersportaal-database-<TIMESTAMP>.tar.gz
```

Het script controleert checksum, padtraversal, verplichte bestanden, bron-/
doelprojectverschil en de doelhost. De restorevolgorde is rollen, public schema,
Auth-data, Storage-metadata, public data en managed maatwerk.

### Fysieke Storage

Haal het afzonderlijke Storage-archief en het bijbehorende checksum-object op
met dezelfde tijdelijke read-only B2-sleutel. Gebruik het `storage.archive_key`
uit de completion marker; vul de placeholder hieronder niet blind in:

```bash
export B2_ENDPOINT='https://s3.eu-central-003.backblazeb2.com'
export B2_BUCKET='<B2_BUCKET_NAME>'
export STORAGE_KEY='supabase/JJJJ/MM/DD/bestuurdersportaal-storage-<TIMESTAMP>.tar.gz'
export STORAGE_ARCHIVE='bestuurdersportaal-storage-<TIMESTAMP>.tar.gz'
export STORAGE_DIR='/veilig/pad/uitgepakte-storage'

aws s3api get-object --endpoint-url "$B2_ENDPOINT" --bucket "$B2_BUCKET" \
  --key "$STORAGE_KEY" "$STORAGE_ARCHIVE"
aws s3api get-object --endpoint-url "$B2_ENDPOINT" --bucket "$B2_BUCKET" \
  --key "$STORAGE_KEY.sha256" "$STORAGE_ARCHIVE.sha256"
sha256sum -c "$STORAGE_ARCHIVE.sha256"
mkdir -p "$STORAGE_DIR"
tar -xzf "$STORAGE_ARCHIVE" -C "$STORAGE_DIR"
```

Controleer lokaal per object de SHA-256 en upload daarna naar de nieuwe buckets:

```bash
export TARGET_SUPABASE_URL='https://<DOELREF>.supabase.co'
export TARGET_PROJECT_REF='<DOELREF>'
export TARGET_SUPABASE_SERVICE_ROLE_KEY='<tijdelijke-doelsleutel>'

node scripts/restore-supabase-storage.mjs \
  --input-dir "$STORAGE_DIR"
```

Dit maakt of actualiseert de vier buckets, uploadt idempotent en downloadt elk
object na upload opnieuw voor een inhoudelijke hashcontrole. Gebruik voor een
voorafgaande lokale controle `--dry-run`; dat schrijft niets naar Supabase.

### Acceptatiepoorten

- [ ] B2-archive en checksum groen.
- [ ] Database restore exit 0 met `ON_ERROR_STOP=1`.
- [ ] Auth-users/identities en kritieke publieke rijtellingen plausibel.
- [ ] Storage-metadata en fysieke objectcount gelijk aan het manifest.
- [ ] Per Storage-object download-hash groen.
- [ ] Laatste platforminventaris checksum- en ouderdomscontrole groen.
- [ ] Auth/Vercel-configuratie opnieuw ingesteld aan de hand van de inventaris;
      secrets zijn nieuw uitgegeven of gecontroleerd uit de secrets manager.
- [ ] RLS, policies, triggers, functies en structurele gates groen.
- [ ] Tenant-smoke met testaccount groen.
- [ ] Tijdelijke app-smoke gebruikt uitsluitend het doelproject.
- [ ] Read-only B2-sleutel, doelproject en lokale Productiekopieën zijn na
  aftekening verwijderd of vernietigd volgens het privacybeleid.

De cloudrestore is op 2026-08-17 nog niet uitgevoerd: daarvoor is een leeg
tijdelijk Supabase-project nodig. Een lokale dry-run of database-restore bewijst
niet dat Auth, Storage en de uitwijkdeploy in Supabase Cloud werken.

## Lokale controles

```bash
npm run test:backup-storage
node --input-type=module -e 'import fs from "node:fs"; import yaml from "js-yaml"; for (const file of [".github/workflows/supabase-backup.yml", ".github/workflows/supabase-backup-watchdog.yml"]) yaml.load(fs.readFileSync(file, "utf8")); console.log("workflow YAML groen")'
```
