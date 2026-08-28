# 0193 — `platform.pipeline.operate`: machinegezag als soort, niet als recht

| | |
|---|---|
| **Status** | Voorgesteld |
| **Datum** | 2026-08-27 |
| **Spoor** | W · onderdeel van #183b spoor M (de 9 machine-writes) |
| **Volgt op** | 0190, 0191 (§7 voorwaarde 5c) |
| **Raakt** | `platform/lib/platform-capabilities.ts` · seed `platform_capabilities` · CI-test 17 · V3-grants-gate |

## 1. Context

De 5 machine-worker-SPECs (`aqlab/worker`, `internal/ingest-worker`,
`internal/afschrift-worker`, `internal/semantische-extractie`,
`platform/monitoring/snapshot`) moeten `platform_event_log` gaan schrijven
(#183b spoor M, drager `spoor_vereist` → 0). Elk event draagt een **verplicht**
`capability`-veld (`platform_event_log.capability` is `NOT NULL`).

Deze routes passeren **geen** capability-check: hun poort is
`bewaking: "cron-secret"` (constant-time bearer), niet een `requireCapability`.
Ze draaien met de service-role, zonder platform-identiteit. De vraag is dus:
welke `capability` benoemt eerlijk *onder welke bevoegdheid* dit gebeurde?

## 2. Besluit

Er komt één nieuwe capability: **`platform.pipeline.operate`**, gedragen door
**alle vijf** de machine-workers. Hij benoemt een **soort bevoegdheid** —
"dit gebeurde onder **machinegezag**, niet onder iemands recht" — niet een
functie en niet een toekenbaar privilege.

### 2a. Structureel niet-toekenbaar (de invariant die de keuze afmaakt)
Niemand houdt deze capability ooit. Dat is geen gewoonte maar een **invariant**:
- staat **niet** in enig `PLATFORM_ROL_CAPABILITIES`-profiel;
- staat **niet** als toekenbaar recht in de allowlist;
- de seed voegt hem toe als **bekende waarde** (code↔seed-consistentie, test 17),
  niet als toekenbaar recht;
- **DB-CHECK + CI-assertie:** geen enkele rij in `platform_identity_capabilities`
  verwijst er ooit naar — de insert faalt structureel, en een gate valt rood als
  het toch gebeurt.

Zo is het geen permissie maar een soortaanduiding, en is uitgesloten dat iemand
over een jaar een mens `pipeline.operate` geeft en machinegebeurtenissen weer
ononderscheidbaar worden van menselijke.

### 2b. `identity_id` blijft `null`
Geen verzonnen service-identiteit. Het schema staat `identity_id NULL` toe en
`logSecurity` heeft dat precedent al. Een verzonnen identiteit is dezelfde fout
als een verzonnen capability, één kolom verderop.

### 2c. Snapshot valt er óók onder — reconciliatie, geen uitzondering
`platform/monitoring/snapshot` is het meest observability-achtig, maar krijgt
**dezelfde** capability als de andere vier. Reden: het `capability`-veld benoemt
de **soort bevoegdheid** (machinegezag), niet de functie. Snapshots
observability-karakter leeft in het **`handeling`-veld**
(`monitoring.snapshot.geschreven`), niet in een afwijkende capability. Eén
conventie over vijf SPECs, geen twee.

Bovendien is snapshot de **enige** van de vijf met een gedeclareerde destructieve
mutatie (`directeMutaties: ["delete","insert"]`, de retentiesnoei op
`platform_signal_snapshots`). Een cron die rijen verwijdert zonder spoor is
precies I-6; hem `audit:"geen"` laten zou de zwaarste de enige zonder spoor maken.

## 3. Afgewezen alternatieven

- **`platform.support.operate`** — beweert dat een supportdesk-bevoegdheid is
  uitgeoefend. Dat is niet gebeurd; deze routes passeren geen capability-check.
  Een verplicht veld vullen met een plausibele waarde die met niets
  correspondeert, is exact het patroon van `audit:"platform-event-log"` dat een
  niet-bestaand mechanisme benoemde. Zelfde val, ander veld.
- **`platform.observability.read`** — een lees-capability op jobs die muteren.
  Semantisch scheef.

## 4. Uitkomstregel (outcome-gescopet) + de vijf schrijfpunten

**Een run die niets deed, schrijft niets.** Liveness is de taak van `healthz`,
niet van het auditspoor — dwingend op een serialiserende, retentieloze tabel.
Schrijf via `logResultGegarandeerd` (retry, **niet** fail-closed: een logfout mag
een cron-run niet laten mislukken), `fase='result'`, `identity_id=null`,
`capability='platform.pipeline.operate'`.

| Worker | schrijf als… | `handeling` | `effect` / `doel` |
|---|---|---|---|
| `aqlab/worker` | `totaalVerwerkt > 0` | `aqlab.runs.verwerkt` | `{verwerkt}` |
| `ingest-worker` | enig veld van `IngestWorkerResultaat` > 0 | `ingest.batch.verwerkt` | `resultaat` |
| `afschrift-worker` | `geclaimd > 0` | `afschrift.batch.verwerkt` | `{geclaimd,gereed,mislukt}` |
| `semantische-extractie` | `enqueued === true` | `semantische-extractie.enqueue` | `doelObject = documentId` |
| `monitoring/snapshot` | `rijen.length > 0` | `monitoring.snapshot.geschreven` | `{gemeten,mislukt,rijen}` |

De 2 probes (`platform/healthz`, `healthz/ping`) blijven `audit:"geen"`: ze
muteren niets, en `healthz` logt bewust niet (een gezondheidscontrole die faalt
op het loggen is een zelfreferentiële storing).

## 5. De dragende koppeling tussen twee bestanden — vastleggen als test

Snapshots gatdetector is **Signaal 14** (`platform/lib/monitoring-queries.ts`),
die filtert op `.eq("fase","attempt")`. `logResultGegarandeerd` schrijft
uitsluitend `fase='result'`. Daarom ziet snapshot zijn **eigen** events niet als
gat — een dragende koppeling tussen twee bestanden die niets van elkaar weten.

Voegt iemand later een `logAttempt` (fase='attempt') aan de workers toe, dan
ontstaat stilzwijgend een terugkoppellus: de gatdetector telt zijn eigen
schrijfacties als gaten. **Assertie (verplicht):** de eigen `result`-events van
de workers komen niet voor in Signaal 14's `attempt`-gefilterde gatdetectie —
één test die precies de wijziging vangt die niemand als gevaarlijk herkent.

## 6. Gevolg voor de vlag en de retentie

- Deze writes brengen `spoor_vereist` naar 0 — voorwaarde 2 van 0191 §7
  (voorwaarde 5c).
- Volume: outcome-scoping houdt lege runs uit de tabel, maar `platform_event_log`
  blijft retentieloos → zie `TICKET-RETENTIESNOEI-DRIE-APPEND-ONLY-TABELLEN.md`.
  Snapshots eigen `.delete().lt(...)` toont dat het snoeipatroon al bestaat en
  draait; het retentieticket weegt dat als drager tegen `pg_cron`.

## 7. Uitvoerchecklist

- [ ] `platform.pipeline.operate` in union + `PLATFORM_CAPABILITIES` (16), buiten
      elk profiel; `NIET_TOEKENBARE_CAPABILITIES` + helper.
- [ ] `platform-capabilities.sanity.ts`: telling 15→16; + "in geen profiel" + "niet-toekenbaar".
- [ ] Migratie: seed-rij `platform_capabilities` + **CHECK** op
      `platform_identity_capabilities` (`capability <> 'platform.pipeline.operate'`) + rollback.
- [ ] 5 routes: `audit → "platform-event-log"`, outcome-gescopte
      `logResultGegarandeerd` (§4).
- [ ] Signaal-14-zelfdetectie-assertie (§5).
- [ ] `audit-inventaris.json` geregenereerd: `spoor_vereist` 9→0 (rode uitvoer van vóór vastgelegd).
- [ ] `tsc --noEmit --skipLibCheck` groen; capability-sanity groen.
