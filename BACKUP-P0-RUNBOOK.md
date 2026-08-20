# P0 — back-upketen, Storage en restore

**Status:** managed restore-oefening end-to-end groen (run 32345486528, 2026-08-20); alertkanaal vastgesteld op GitHub-notificaties (besluit 0185)
**Datum:** 2026-08-20
**Eigenaar:** technisch beheer / incidentleider

## Wat nu wordt opgeslagen

De workflow `.github/workflows/supabase-backup.yml` maakt dagelijks om 01:30
UTC twee onafhankelijke archieven in Backblaze B2. De completion marker wordt
pas als laatste geschreven, nadat alle objecten met `head-object` op aanwezigheid
en bestandsgrootte zijn gecontroleerd.

| Component | Bestand/onderdeel | Dekking |
|---|---|---|
| Eigen database | `roles.sql`, `schema.sql`, `data.sql` | Ja |
| Supabase Auth-data | `data.sql` | Ja, inclusief gebruikers-/identiteitsdata |
| Storage-metadata | `data.sql` | Ja, inclusief buckets en objectmetadata |
| Auth/Storage-maatwerk | `managed-customizations.sql` plus manifest | Alleen portable policies en user-defined triggers; geen Supabase-managed functies, ownership of standaard-RLS |
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
- `BACKUP_ALERT_WEBHOOK_URL` — **optioneel**. Alleen vereist wanneer
  `ALERT_CHANNEL` in de watchdog op `webhook` staat. Bij het huidige kanaal
  `github-native` (besluit 0185) is dit secret niet nodig en wordt het genegeerd
- `SUPABASE_MANAGEMENT_API_TOKEN` — read-only Management API-token voor de
  platforminventaris; nooit in een artefact of log opnemen
- `VERCEL_TOKEN` — read-only Vercel-token voor project- en variabelenameninventaris

Aanvullend, uitsluitend voor één afzonderlijk geautoriseerde managed
restore-oefening op het tijdelijke doelproject:

- `RESTORE_TARGET_DB_URL`
- `RESTORE_TARGET_SUPABASE_ADMIN_KEY` — óf `sb_secret_…`, óf een legacy
  `service_role`-JWT van exact het doelproject
- `RESTORE_TARGET_SUPABASE_CLIENT_KEY` — óf `sb_publishable_…`, óf een legacy
  `anon`-JWT van exact het doelproject

De admin- en clientkey moeten verschillend zijn. Een publishable/anon-key wordt
nooit voor beheer, usercreatie of Storage-restore gebruikt. Nieuwe opaque keys
gaan als `apikey`; alleen de legacy service-role-JWT wordt daarnaast als Bearer
gebruikt. `SUPABASE_MANAGEMENT_API_TOKEN` leest tijdens deze oefening uitsluitend
de Auth-config van het tijdelijke doel om die met de niet-geheime broninventaris
te vergelijken.

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
- Iedere managed B2-download gebruikt maximaal drie expliciete pogingen. Een
  incomplete of inhoudelijk afwijkende tijdelijke download wordt vóór de volgende
  poging verwijderd, blijft uitsluitend op LUKS-opslag en wordt pas atomisch als
  bruikbaar bestand vrijgegeven nadat de verwachte lengte en SHA-256 kloppen.
- De `backup-status/.../manifest-*.json` completion marker wordt pas na alle
  uploads en lokale controles geüpload.
- `supabase-backup-watchdog.yml` draait iedere zes uur. De B2-jobs controleren,
  onafhankelijk van de webhookconfiguratie:
  - laatste complete marker;
  - checksum van de marker;
  - ouderdom: waarschuwing boven 26 uur, kritiek boven 48 uur;
  - manifestdekking voor Auth, Storage-metadata en fysieke Storage-objecten;
  - aanwezigheid van alle gerefereerde B2-objecten.
- Een mislukte back-uprun triggert via `workflow_run` direct dezelfde webhook.
- `platform-inventory.yml` draait wekelijks en legt niet-geheime Supabase- en
  Vercel-configuratie vast. De watchdog verwacht binnen 14 dagen een complete
  inventarismarker en alarmeert als configuratiedekking ontbreekt.

De workflow onderscheidt drie statussen in jobnamen, logs en webhookpayload:
`back-up mislukt`, `B2-bewijs ongeldig` en `alertkanaal niet geconfigureerd`.
Een ontbrekend webhooksecret blokkeert de B2-controles niet en mag nooit als een
mislukte productieback-up worden omschreven.

### Het goedgekeurde meldkanaal

Het kanaal staat als `ALERT_CHANNEL` in `supabase-backup-watchdog.yml`, bewust in
code en niet in een instelling in de UI: wijzigen vereist een PR en is daarmee
reviewbaar en terugleesbaar.

Huidige waarde: **`github-native`** (besluit 0185). De rode workflowrun zélf is
het meldkanaal. Iedere inhoudelijke afwijking roept `send-backup-alert.mjs` aan
en sluit af met `exit 1`; de run wordt daardoor rood en GitHub stuurt een
notificatie naar de eigenaar van de workflow.

Die belofte is alleen waar zolang elke afwijking de run ook echt rood maakt. De
job `Alertkanaalconfiguratie controleren` draait daarom
`scripts/verify-watchdog-fail-closed.mjs`, die afdwingt dat beide inhoudelijke
controlejobs bestaan, dat elke vaststellende stap eindigt met `exit 1` en dat
nergens `continue-on-error` staat. Een onbekende of lege `ALERT_CHANNEL` faalt
eveneens. Zet je het kanaal op `webhook`, dan eist dezelfde job juist dat
`BACKUP_ALERT_WEBHOOK_URL` aanwezig is.

Bewust geaccepteerde beperkingen van `github-native`, elk een reden om alsnog
een toegewijd kanaal in te richten:

- de melding landt in dezelfde inbox als alle overige GitHub-ruis, zonder eigen
  urgentie, ontvangstbevestiging of escalatie bij uitblijven;
- GitHub stuurt notificaties over scheduled workflows naar de gebruiker die de
  workflow heeft aangemaakt; wijzigt iemand anders de cron-expressie, dan
  verschuift de ontvanger stilzwijgend;
- er is één ontvanger en geen dienstdoend rooster;
- een storing bij GitHub Actions maakt zowel de back-up als de melding erover
  onzichtbaar.

### Veilige negatieve test

Start `Supabase-back-upbewaking` handmatig met `synthetic_alert=true`. Er wordt
geen back-up, completion marker of B2-object aangeraakt.

- Bij `webhook` verstuurt de job `Veilige synthetische alertdelivery` een
  `warning` met de expliciete tekst dat niets is aangeraakt.
- Bij `github-native` maakt diezelfde job de run **met opzet rood**. Dat is het
  bewijs zelf: alleen een rode run levert de notificatie op. Controleer daarna
  dat je de GitHub-melding hebt ontvangen; die ontvangstcontrole is onderdeel
  van de test en kan niet geautomatiseerd worden.

**Laatst volledig bevestigd: 2026-08-20**, run 32348713703 — run rood geworden
én de GitHub-notificatie aantoonbaar ontvangen. Herhaal deze test bij elke
wijziging aan de bewaking, en verder minimaal halfjaarlijks: is deze datum meer
dan zes maanden oud, dan is niet meer aangetoond dat een melding de ontvanger
nog bereikt. Let daarbij op wie de ontvanger is — GitHub stuurt notificaties
over scheduled workflows naar de gebruiker die de workflow heeft aangemaakt, en
die ontvanger verschuift stilzwijgend als iemand anders de cron-expressie
wijzigt.

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

1. Maak vanuit dit runbook geen Supabase-project aan zonder afzonderlijke,
   projectspecifieke kostenautorisatie. Die autorisatie noemt minimaal naam,
   regio, plan/compute, verwachte looptijd en kostenimpact. Een algemeen “ga
   door” of “akkoord” is hiervoor niet voldoende.
2. Kies na die autorisatie maximaal één nieuw, leeg tijdelijk Supabase-project.
   Gebruik niet Productie, Preview of een project met klantdata. Diagnoseer en
   hervat fouten op hetzelfde doel; een tweede project vereist nieuwe
   autorisatie.
3. Start geen managed restore voordat alle kosteloze gates en het go/no-go-
   rapport groen en goedgekeurd zijn.
4. Controleer PostgreSQL-majorversie en benodigde extensies.
5. Maak een tijdelijke, bucket- en prefix-beperkte B2-read-only sleutel.
6. Leg bronproject, doelproject, back-upobject, T0–T8 en uitvoerders vast.
7. E-mail, AI-calls, cronjobs, webhooks en publieke DNS blijven uit.

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
doelprojectverschil, doelhost, SQL-allowlist en het customizationmanifest vóór
de eerste doelmutatie. Rollen, schema, public/Auth/Storage-data en portable
customizations worden in één `psql --single-transaction` aangeboden. Een fout
in de laatste customization draait daardoor de volledige databasewijziging
terug. Legacy `auth-data.sql` en `storage-data.sql` zijn niet langer onderdeel
van het verplichte contract en worden bij oude archieven bewust genegeerd.

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
export TARGET_SUPABASE_ADMIN_KEY='<sb_secret_… of legacy service-role-JWT>'

node scripts/restore-supabase-storage.mjs \
  --input-dir "$STORAGE_DIR"
```

Dit maakt of actualiseert de vier buckets en werkt hervatbaar op hetzelfde doel:
een object dat al met de verwachte SHA-256 aanwezig is, wordt overgeslagen; een
ontbrekend of afwijkend object wordt idempotent geüpload en opnieuw gedownload.
Gebruik voor een voorafgaande lokale controle `--dry-run`; dat schrijft niets
naar Supabase. `--no-resume` forceert herupload van alle objecten.

### Verplichte kosteloze preflight

Voer vóór een managed restore minimaal uit:

1. haal de gekozen completion marker, markerchecksum, beide archieven en beide
   archiefchecksums met een read-only B2-sleutel op;
2. valideer markerpad, bronproject, restorecontract, exacte vier buckets,
   bestandsgroottes en SHA-256;
3. laat de volledige managed-customizations SQL-parser/allowlist groen lopen;
4. voer `npm run test:backup-restore` uit;
5. voer de Storage-restore met `--dry-run` uit op het echte uitgepakte archief;
6. herstel dezelfde database en fysieke Storage tweemaal vanaf schoon in een
   gecontroleerde lokale/self-hosted PostgreSQL 17/Supabase-omgeving;
7. verwijder alle tijdelijke productiegegevens en leg alleen niet-gevoelig
   cleanupbewijs en het go/no-go-resultaat vast.

Een lokale kopie met productiegegevens hoort uitsluitend in tijdelijke,
versleutelde opslag op een gecontroleerde runner/omgeving. Neem geen secrets of
rij-inhoud op in logs, artifacts, issues of fixtures.

De fysieke Storage-restore vertaalt de databasevelden uit het manifest
(`file_size_limit`, `allowed_mime_types`) expliciet naar het camelCase-contract
van de Storage-API (`fileSizeLimit`, `allowedMimeTypes`). Omdat de database-
restore de bucketmetadata al terugzet, leest de fysieke restore iedere bucket
eerst en werkt zij een bestaande bucket bij; alleen een expliciete 404 leidt tot
aanmaken. Bij een fout mag alleen
de allowlisted restorefase en de numerieke HTTP-status buiten het versleutelde
volume als diagnostisch bewijs worden bewaard; bucket- en objectnamen blijven
op het vernietigde volume.

De workflow `.github/workflows/supabase-restore-preflight.yml` automatiseert
deze poort zonder een Supabase-cloudproject aan te maken. Start hem uitsluitend
vanaf `main` met de exacte contract-v2-marker en bevestiging
`PREFLIGHT_ON_ENCRYPTED_EPHEMERAL_RUNNER`. De workflow:

1. gebruikt alleen de prefix-beperkte B2-read-only sleutel;
2. plaatst archieven, tijdelijke logs én Docker/PostgreSQL op één nieuw
   LUKS2-volume met een eenmalige sleutel;
3. valideert marker, checksums, restorecontract en Storage dry-run vóór herstel;
4. start tweemaal een schone lokale Supabase-stack met PostgreSQL 17;
5. herstelt en vergelijkt database/Auth/Storage, inhoudshashes, policies,
   triggers en ieder opnieuw gedownload fysiek object;
6. publiceert alleen een niet-gevoelig `go-no-go.json` en `cleanup.json`; bij
   een databasefout bevat `restore-diagnostic.json` uitsluitend iteratie,
   restorefase en SQLSTATE, nooit SQL-tekst of rijwaarden;
7. stopt de stack, ontkoppelt LUKS en verwijdert het versleutelde backingbestand
   in een `always()`-stap.

Een groene preflight is alleen `go-for-managed-review`: Auth-providersecrets,
functionele canary-/RLS-/appsmokes en verschillen met Supabase Cloud blijven
expliciete managed gates. De workflow mag daarom nooit automatisch de managed
restoreworkflow starten.

### Managed restoreworkflow

`.github/workflows/supabase-restore-drill.yml` maakt zelf geen project aan en
verwijdert ook geen project. Start de workflow alleen na projectspecifieke
autorisatie en uitsluitend vanaf `main`, met:

1. de project-ref van het ene tijdelijke doel;
2. de exacte contract-v2 `backup_marker_key`;
3. de exacte complete `platform_inventory_marker_key` onder
   `backup-status/platform-inventory/`;
4. bevestiging `RESTORE_TO_EMPTY_PROJECT`.

De eerste run accepteert alleen een aantoonbaar leeg doel. Als databaseherstel
al atomisch is geslaagd en Storage of verificatie later faalt, blijft in een
afgeschermd databaseschema een state met bronref, doelref, marker en
databasechecksum staan. Een retry mag uitsluitend met alle vier exact dezelfde
waarden op hetzelfde doel verder. Een niet-leeg doel zonder die state, een ander
doelproject of een andere back-up wordt fail-closed geweigerd. Storage wordt bij
een retry idempotent hervat; de database wordt niet opnieuw geladen. De state
wordt pas na alle technische, functionele en cleanupchecks verwijderd.

Een tijdelijke afgebroken B2-stream verandert deze binding niet. Hervat na een
groene retryfix op exact hetzelfde doelproject; maak geen vervangend project aan.
De workflow verwijdert iedere partiële download binnen LUKS en probeert een
object maximaal drie keer, waarna hij fail-closed stopt.

De managed workflow voert aanvullend uit:

- vergelijking van allowlisted Auth-provider-, login-, sessie-, MFA- en
  wachtwoordinstellingen; secretvelden worden niet opgehaald of gelogd;
- twee tijdelijke gemarkeerde canary-users in verschillende fondsen, aangemaakt
  met de adminkey, gevolgd door echte e-mail/wachtwoordlogin met de clientkey;
- positieve eigen-profiel/document/Storage-tests en negatieve profiel-,
  document- en privé-Storagetests over de tenantgrens via beide user-JWT's;
- een lokale Chrome-smoke tegen de herstelde managed backend voor Home/dashboard,
  Documentbibliotheek/API en een geautoriseerde privédownload; het document van
  de andere tenant moet via dezelfde appsessie 404 geven;
- verwijdering van canary-users en hun tijdelijke inzageregels, gevolgd door een
  tweede exacte database/Auth/Storage-validatie tegen de bron.

Alle archieven, manifests, databasequeryresultaten, canarygegevens,
app-build/cache/logs en browserprofielen staan op een nieuw LUKS2-volume op de
ephemere runner. Een `always()`-stap ontkoppelt het volume, sluit de mapping en
verwijdert het versleutelde backingbestand. Alleen
`managed-restore-evidence.json` met tellingen/booleans en `cleanup.json` worden
buiten LUKS geplaatst en als artifact bewaard. Geen namen, e-mailadressen,
user-/document-ID's, objectpaden, hashes, rijwaarden of volledig Storage-manifest
verlaten het versleutelde volume.

Bestaande contract-v2-archieven kunnen vóór het JSON-document de drie standaard
`psql`-statusregels voor outputformaat, tuples-only en pager bevatten. De restore
maakt daarvoor uitsluitend binnen de versleutelde werkmap een genormaliseerde
kopie. Alleen die drie exacte, unieke regels vóór het JSON-object zijn toegestaan;
onbekende, dubbele of later voorkomende statusregels stoppen de restore fail-closed.
Nieuwe back-ups schrijven het validatiebestand direct in quiet/unaligned vorm.

### Acceptatiepoorten

- [ ] B2-archive en checksum groen.
- [ ] Database restore exit 0 met `ON_ERROR_STOP=1`.
- [ ] Auth-users/identities en kritieke publieke tellingen exact gelijk.
- [ ] Deterministische inhoudshashes voor Auth, Storage-metadata en kritieke
      publieke tabellen exact gelijk.
- [ ] Policies en triggers exact gelijk op naam en definitiehash.
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

### Aangetoond herstel

Run `32345486528` (2026-08-20) heeft alle poorten hierboven groen doorlopen op
het tijdelijke doelproject `mqeyrsdptapbdmwnrhnq`, vanaf backupmarker
`backup-status/2026/08/19/manifest-2026-08-19T06-49-24Z.json`. Het geaggregeerde
bewijsartifact legt vast:

| Onderdeel | Waargenomen |
|---|---|
| Database | PostgreSQL 17, inhoudshashes gelijk, 160 policies, 84 triggers, 6 kritieke tabellen met 7.510 rijen, 7 extensies |
| Auth | 16 gebruikers, 16 identities, 42 instellingen en 27 providerinstellingen vergeleken, 0 afwijkingen |
| Storage | 4 buckets, 34 objecten, 29.067.773 bytes, per object opnieuw gedownload en op SHA-256 gecontroleerd |
| Functioneel | 2 echte wachtwoordlogins, 4 positieve en 4 negatieve RLS-controles, 4 cross-tenantweigeringen over 2 tenants |
| Applicatie | echte browserlogin, dashboard, documentenlijst, geautoriseerde privédownload met veilige headers, cross-tenantdownload geweigerd |
| Opruiming | 2 canary-users verwijderd, 0 profielresidu, versleuteld volume unmounted, LUKS-mapping gesloten, backing file verwijderd |

Geen enkele secretwaarde, hostnaam, e-mailadres of document-id staat in het
bewijs; het bevat uitsluitend aantallen en booleans.

Maak of start hiervoor geen nieuw betaald doelproject zonder de hierboven
beschreven afzonderlijke kostenautorisatie. Een lokale dry-run of
database-restore bewijst niet dat Auth, Storage, RLS en de uitwijkdeploy in
Supabase Cloud werken; alleen een managed oefening als deze doet dat.

## Hersteldoelen (RPO en RTO)

**RPO — maximaal aanvaardbaar dataverlies: 24 uur.** De back-up draait dagelijks
om 01:30 UTC en is pas compleet als de marker is geschreven. Valt Productie vlak
vóór een geslaagde run uit, dan is de laatste bruikbare marker maximaal iets meer
dan 24 uur oud. De watchdog waarschuwt boven 26 uur en escaleert boven 48 uur;
die grenzen zijn bewust ruimer dan 24 uur, zodat één vertraagde run geen vals
alarm geeft maar een echt gemiste dag wél opvalt.

**RTO — gemeten componenten.** Uit run 32345486528 en de voorgaande oefeningen
zijn deze stappen daadwerkelijk geklokt op een GitHub-hosted runner:

| Stap | Gemeten |
|---|---|
| Volledige managed restore vanaf schoon (database, Auth, Storage-metadata, fysieke objecten) | circa 5 minuten |
| Hervatte restore met functionele en applicatieverificatie | 3 minuten 30 seconden |
| Volledige kosteloze preflight met dubbele lokale restore | circa 20 minuten |

Deze cijfers dekken **niet** de volledige uitwijk. Nog niet geklokt, en dus nog
geen onderdeel van een RTO-toezegging:

- aanmaken en gereedmaken van een vervangend Supabase-project (inclusief regio en
  plan/compute);
- opnieuw uitgeven en instellen van Auth-providercredentials, API/JWT-sleutels en
  overige secrets volgens de checklist onder *Platformconfiguratie en secrets*;
- DNS-omzetting en propagatie;
- deploy van de applicatie naar de vervangende omgeving.

Een RTO-toezegging aan het bestuur is pas verantwoord nadat die vier stappen in
één oefening zijn geklokt. Tot dat moment geldt: de datalaag is aantoonbaar
binnen tientallen minuten herstelbaar, de volledige dienstverlening niet.

## Escalatie

De escalatieladder hangt aan de drie statussen die de bewaking onderscheidt.

| Trigger | Eerste actie | Escaleer wanneer |
|---|---|---|
| `alertkanaal niet geconfigureerd` | Bij `github-native`: de fail-closed controle herstellen die de bewaking rood laat worden. Bij `webhook`: `BACKUP_ALERT_WEBHOOK_URL` instellen. Daarna de synthetische test draaien | Direct bij constatering; de bewaking meldt dan mogelijk niets meer |
| `B2-bewijs ongeldig` | Marker, checksums en gerefereerde objecten controleren; back-up handmatig herdraaien | Als een tweede run hetzelfde bewijs afkeurt |
| `back-up mislukt` | Runlog beoordelen en handmatig herdraaien | Als de marker ouder dan 26 uur wordt |
| Markerouderdom boven 48 uur | Behandelen als P0-incident: er is geen verse herstelbron | Onmiddellijk naar de incidentleider |
| Restore-oefening faalt ná mutatie op het doel | Hervatten op hetzelfde doelproject met de atomische en hervatbare fasen | Voor een tweede project is nieuwe kostenautorisatie vereist |

Besluitrechten: de eigenaar van dit runbook beslist over herdraaien en
hervatten. Het aanmaken van een betaald doelproject en het verwijderen van een
tijdelijk doelproject zijn uitsluitend beslissingen van de opdrachtgever, met de
kostenautorisatie zoals hierboven beschreven.

De namen, telefoonnummers en meldkanalen van de dienstdoende personen staan
bewust **niet** in dit bestand — het is een publieke repository. Neem ze op in
het interne oproepregister en verwijs daar vanuit dit runbook naar zodra dat
register is ingericht.

## Lokale controles

```bash
npm run test:backup-storage
npm run test:backup-restore
node --input-type=module -e 'import fs from "node:fs"; import yaml from "js-yaml"; for (const file of [".github/workflows/supabase-backup.yml", ".github/workflows/supabase-backup-watchdog.yml", ".github/workflows/supabase-restore-preflight.yml", ".github/workflows/supabase-restore-drill.yml", ".github/workflows/platform-inventory.yml"]) yaml.load(fs.readFileSync(file, "utf8")); console.log("workflow YAML groen")'
```
