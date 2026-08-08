# Monitoringbasis beheer-surface (P5 + P4-light) — Ontwerpdocument

> **Status**: 1.2 — §5 op elf signalen (blok B+C) en §8.1 (driedelig dashboard, blok A+D), 2026-08-08; basis 1.0 opgeleverd 2026-08-03
> **Scope**: platform-back-office (`beheer.bestuurdersportaal.com`, route-groep `(platform)`)
> **Herkomst**: werkopdracht "monitoringbasis beheer-surface" v0.3; FO Increment P §12/§17/§18/§19/§20.1; TO Increment P §9
> **Leidend besluit**: `decisions/0005` — monitoring in-stack, geen Sentry. Deze tranche lost de tot nu toe openstaande helft daarvan in.

---

## 1. Waarom

De beheer-surface had geen monitoringlaag. Er waren ruwe bronnen — rate-limit-events, pipeline-jobs, het platform-event-log — maar niets dat ze aggregeerde, niets dat de gezondheid van de keten mat, en geen plek waar iemand keek. Fouten landden uitsluitend in `console.error` → Vercel-logs.

Dat is niet alleen een comfortprobleem. **Detectie is de compensating control onder meerdere bewust geaccepteerde risico's**: rate limiting is fail-open bij een DB-storing, de malwarescan is gestubd en zichtbaar als `overgeslagen`-job waar niemand naar keek, en de datalekprocedure (art. 33/34 AVG) is niet uitvoerbaar zonder detectie. Een 72-uurs meldtermijn zonder detectiemechanisme is een papieren termijn.

Deze tranche bouwt de **eerste basis**: de ontbrekende bronnen operationeel maken, de bestaande ontsluiten, en één stoplichtpagina waar het samenkomt.

---

## 2. Wat de verkenning corrigeerde

De signaalbronnentabel in TO §9.1 bleek op meerdere punten optimistischer dan de code. Deze zes vaststellingen hebben het ontwerp gestuurd en horen hier vast, omdat ze anders opnieuw ontdekt moeten worden.

| # | Aanname | Werkelijkheid (geverifieerd 03-08-2026) |
|---|---|---|
| 1 | De service-role is beschikbaar waar gelogd wordt | **Nee.** Sinds variant C (`0066`) leeft `SUPABASE_SERVICE_ROLE_KEY` uitsluitend in het beheer-project. `core/lib/api-errors.ts` draait op de gedeelde surface en kan er dus niet mee schrijven. |
| 2 | `api-errors.ts` kent al een status-opzet met categorieën | **Nee.** Geen categorieën, geen severity, geen foutcodes. Alleen een routelabel en `console.error`. De taxonomie is nieuw gebouwd. |
| 3 | "Alle 13+ routes profiteren automatisch" | Klopt qua mechanisme, maar het bereik is kleiner: 24 bestanden importeren `errorResponse` (31 aanroepen) van de 86 `route.ts`-bestanden; daarnaast staan er 178 losse `console.error`-regels onder `app/api`. Dekking ≈ 28%. |
| 4 | `rate_limit_events` is de bron voor signaal 5 | **Nee.** `fn_rate_limit_check` **verwijdert** verlopen rijen bij elke check (`2026_06_10_rate_limiting.sql`). Historische incidenten zijn daar niet telbaar. |
| 5 | Alleen signaal 6 (tokens) mist een bron | **Ook signaal 3.** Het chatpad gebruikt de provider-adapter niet (roept de SDK rechtstreeks aan) en mat nergens duur. `finaleMsg.usage` werd opgehaald maar nooit uitgelezen. |
| 6 | `document_processing_jobs` moet nog gebouwd worden | **Bestaat al** sinds `2026_06_24_p1_generieke_curatie.sql`, met een comment die letterlijk "voedt P5-pipelinegezondheid" zegt. Alleen: write-only, nooit gelezen. |

Correcties 4 en 5 hebben de signaalbronnen daadwerkelijk verlegd; 1 heeft de architectuur bepaald.

---

## 3. Architectuur

```
GEDEELDE SURFACE (app + publiek)          BEHEER-SURFACE (apart Vercel-project)
─────────────────────────────────         ────────────────────────────────────
errorResponse / rateLimited                 snapshot-cron  ──┐
   │  console.error  (1e spoor, altijd)     healthz-route  ──┤
   │                                                          │ service-role
   └─ after() ─→ fn_app_error_log ──┐                        │
                (SECURITY DEFINER)   │                        │
                                     ▼                        ▼
                            ┌──────────────────────────────────────┐
                            │  app_errors                          │
                            │  platform_signal_snapshots           │  deny-by-default
                            │  platform_signaal_config             │  (RLS aan, geen policy)
                            └──────────────────────────────────────┘
                                     ▲
                                     │ withPlatformRead + platform.observability.read
                            monitoring-dashboard (P4-light)
```

### 3.1 Het schrijfpad: waarom een `SECURITY DEFINER`-RPC

Correctie 1 uit §2 is hier bepalend. De gedeelde surface heeft geen service-role en mag ook niet uit `platform/*` importeren (eslint-boundary T9 + `scripts/check-service-role-leak.sh`). Er zijn dan drie opties: een tenant-policy op een platformtabel (verbreedt het RLS-oppervlak op precies de verkeerde plek), niets loggen vanaf de tenant-surface (dan dekt `app_errors` bijna niets), of een smalle RPC.

Gekozen: **`fn_app_error_log`, `SECURITY DEFINER`, gepind `search_path`, aanroepbaar met de sessieclient**. Exact het D1-patroon uit besluit `0065`. De tabel blijft deny-by-default; de RLS-bypass is afgebakend tot de functie-body.

Vier eigenschappen die niet mogen verwateren:

- **`fonds_id` wordt in de functie afgeleid uit `auth.uid()`, en is geen parameter.** Een caller kan hem dus niet vervalsen. Dit is hetzelfde principe als de T8-guard op het chat-auditpad.
- **Niet aan `anon` gegeven.** Dat zou een internet-facing schrijfpad naar een platformtabel openen én gate H breken. Gevolg: fouten op ongeauthenticeerde paden (contactformulier, publieke pagina's) landen niet in `app_errors`; daar blijft `console.error` het enige spoor. Bewust aanvaard.
- **Volumeklep in de functiebody.** De RPC is via PostgREST rechtstreeks aanroepbaar door élke ingelogde gebruiker. Zonder rem kan iemand `app_errors` vullen en signaal 5 naar rood duwen of juist in de ruis laten verdwijnen — en een detectie-control die de gecontroleerde zelf kan vullen is geen control. De klep hergebruikt `fn_rate_limit_check` (120/min per `auth.uid()`): bestaand patroon, zelfopschonend, geen nieuw oppervlak. Boven de limiet wordt de regel stil genegeerd; een foutlogger die zelf gooit maakt het probleem erger.
- **Kolom `bron` (`rpc` | `service`).** Zonder herkomst kan een operator een server-gegenereerde regel niet onderscheiden van een gefabriceerde. Dat is precies wat je nodig hebt op het moment dat het signaal ergens op wijst.

De lengtebegrenzingen zitten op twee niveaus: `[1:20]` begrenst het aantal contextsleutels, `left(x, 60)` per element de lengte. Alleen het eerste zou 20 elementen van 1 MB toelaten — een directe RPC-aanroeper is niet gebonden aan de afkapping in de TS-laag.

`service_role` krijgt **expliciete** tabelgrants. Nergens in deze repo staat zo'n grant; alles leunt op de Supabase-default-ACL — dezelfde ACL die R6 juist aan het inperken is. Wordt die strakker gezet, dan faalt de monitoring **stil**, want de leesfouten worden bewust geslikt (ze mogen niets blokkeren). Een blinde monitor dus. De migratie én de gedragscheck toetsen daarom óók positief: kan `service_role` er wél bij?

De beheer-surface schrijft rechtstreeks (`platform/lib/platform-fout-log.ts`) — een cron-run heeft geen sessie, dus de RPC zou daar niets opleveren. **Beide paden bouwen het record met dezelfde pure functie** (`core/lib/app-fout.ts`); anders drift de sanitatie uit elkaar en dekt de negatieve controle nog maar de helft.

### 3.2 Nooit blokkerend, nooit werpend, nooit recursief

Het wegschrijven gebeurt in `after()` (Next 15), dus ná de response. `console.error` blijft het **eerste** spoor en staat bewust vóór de aanroep: een fout tijdens een DB-storing landt niet in `app_errors` (aanvaarde schuld uit `0005`), maar staat dan nog steeds in de Vercel-logs. De logger logt zijn eigen fout niet naar `app_errors` — anders vermenigvuldigt een DB-storing zichzelf.

---

## 4. De sanitatieregel

Dit is het scherpste punt van de tranche. `api-errors.ts` saniteert richting de **gebruiker**; wegschrijven naar de database is een aparte vraag met een andere dreiging. Supabase-foutmeldingen dragen kolomnamen, tabelnamen en rij-data; eigen `throw new Error("… " + tekst)` kan documentinhoud of een vraagtekst meedragen.

**`melding_kort` is altijd afgeleid, nooit `error.message` rauw.** Vier onafhankelijke grenzen, zodat één gemiste redactie niet meteen een lek is:

1. **Bronselectie** — van een `PostgrestError` worden `details` en `hint` **nooit** overgenomen; dáár zitten kolomnamen en rijwaarden. Alleen `code` (→ `foutcode`) en `message` (→ de redactiepijplijn).
2. **Redactie** — URL's → alleen host, e-mailadressen, UUID's, quoted literals en cijferreeksen ≥6 worden vervangen door placeholders.
3. **Vormeisen** — een melding die na redactie meer dan 16 woorden telt, of waarvan de ruwe eerste regel langer was dan 300 tekens, wordt **volledig onderdrukt**. Dit is de grens die het concatenatiegeval vangt (`"Extractie mislukt: " + documenttekst`) — dat herkent geen enkele regex.
4. **Harde kap** — 200 tekens, ook afgedwongen door een CHECK op de kolom en een `left()` in de RPC.

Contextwaarden gaan nooit mee: alleen `Object.keys(context)`.

**Het bewijs** staat in `core/lib/app-fout.sanity.ts`: zes negatieve controles met vijandige fixtures (een promptfragment, documentinhoud, een deelnemernaam met BSN-achtig nummer en e-mailadres, een volledige Supabase-rijdump, contextwaarden, en een willekeurig object). Elke test eist dat geen enkel fragment van de payload het record haalt — als hele string én als losse kenmerken.

---

## 5. Signaalset

Elf signalen na blok B/C (2026-08-08): de acht uit FO §19 waarvan de bron bestaat, plus drie meetdefinities op tabellen die al gevuld worden — het fail-open-getal (blok B) en de doorvoer/doorlooptijd van de documentketen (blok C). Geen nieuwe bron, geen wijziging aan de verwerkingsketen.

| # | Signaal | Bron | Interval | Venster | Oranje / rood | n-drempel |
|---|---|---|---|---|---|---|
| 7 | Uptime kernfunctionaliteit | healthchecks (§6) | 5 min | 24 u | <99,5 / <99 % | — |
| 2 | Ingest-achterstand (wachtrij) | `document_processing_jobs` | 15 min | momentopname | >10 / >50 | — |
| C2 | Ingest-stilstand (oudste openstaande job) | `document_processing_jobs` (`aangemaakt`) | 15 min | momentopname | ≥30 min / ≥120 min | — |
| C3 | Ingest-doorlooptijd p95 | `document_processing_jobs` (`eind − aangemaakt`) | 60 min | 24 u | >30 min / >2 u | ≥5 jobs\* |
| 1 | Embedding-/indexeringsfouten | `document_processing_jobs` (+ `app_errors`) | 15 min | 60 min | >2 / >5 % | — |
| 5 | Rate-limit-incidenten (429) | `app_errors` (categorie `rate_limiting`, `http_status 429`) | 15 min | 24 u | >20 / >40 per dag | — |
| B3 | Rate-limit fail-open | `app_errors` (`rate_limiting`, severity hoog) | 15 min | 24 u | ≥1 / ≥2 | — |
| 3 | AI-modellatency p95 | `governance_log.retrieval_meta.duur_model_ms` | 60 min | 24 u | >5 / >10 s | n<10 |
| 4 | Lege-antwoord-ratio | `governance_log.retrieval_meta` | 60 min | 24 u | >15 / >30 % | n<10 |
| 6 | Tokenverbruik per fonds | `governance_log.retrieval_meta.tokens` | 60 min | 24 u | +50 / +100 % t.o.v. 7-daags gemiddelde | n<10 |
| 14 | Audit-volledigheid | `platform_event_log` (attempt zonder result) | 15 min | 24 u | ≥1 / ≥5 | — |

De twee tijdsduursignalen (C2/C3) slaan op in **milliseconden** — géén nieuwe eenheidswaarde, de CHECK op `eenheid` blijft ongewijzigd (architectuurpunt 9); de formatter maakt er `30 min` / `2 u` van. \*De drempel bij C3 is een **betekenis**drempel, geen privacydrempel: onder vijf afgeronde jobs is een p95 de traagste van vijf, geen percentiel (besluit `0144`, los van `0055`). C2 kent geen drempel: een lege wachtrij is groen, niet onbekend. De drie richtwaarden bij C3 worden na een week meten via de configtabel bijgesteld, niet via een deploy.

### 5.1 Definities die niet impliciet mochten blijven

- **Leeg antwoord** = `retrieval_meta.geselecteerd = 0` **of** `zwakke_bronbasis = true`, met uitsluiting van de terugvraagtak (`verduidelijking = true`) — dat is een bewuste vervolgvraag, geen leeg antwoord (besluit `0092`).
- **Latency** meet **modeltijd**: de map-reduce-lus én de eindgeneratie (`duur_model_ms`). Alleen de eindgeneratie meten zou erger zijn dan een gat: de map-lus is de trage tak, dus een beurt waarop de bestuurder 45 seconden wacht zou als een paar seconden meetellen en de p95 juist omlaag trekken. Retrieval, query-reformulatie en de reranker vallen erbuiten — het is modeltijd, geen doorlooptijd, en het signaal heet daarom "AI-modellatency". `duur_ms` blijft daarnaast bestaan voor de eindgeneratie alleen, zodat de decompositie zichtbaar is.
- **Tokenverbruik** is een **ondergrens**: eindgeneratie + map-lus, inclusief cache-tokens (zonder `cache_read`/`cache_creation` is `input_tokens` geen verbruik maar een restpost). Niet meegeteld: de reranker, query-reformulatie, server-side web_search, en de AI-routes buiten de assistentchat — `voorbereiding` en `besluit-concept` schrijven überhaupt geen `governance_log`-regel. Dat laatste is een pre-existente breuk met de guardrail "elke AI-interactie blijft herleidbaar" en staat als apart punt in §11.
- **Het dekkingsvoorbehoud is code-only.** Het staat níet in `platform_signaal_config.toelichting` maar als apart veld in de registry, buiten `combineerConfig()` om — net als `platformbreed`. Anders zou één SQL-update de disclaimer laten verdwijnen, zonder deploy, zonder review, zonder auditregel. Het wordt als vaste regel op elke signaalkaart getoond.
- **Rate-limit-incidenten** telt twee dingen die het tegenovergestelde betekenen: een 429 (de rem wérkte) en een mislukte limietcheck (de rem viel weg, fail-open). Met drempels van 20/40 per dag zouden de 429's domineren en drie fail-opens — het enige echt alarmerende geval — in de ruis verdwijnen. De fail-opens worden daarom apart geteld en in `meta.limietchecks_mislukt` zichtbaar gemaakt.
- **Audit-volledigheid** telt alleen schrijfpaden. `withPlatformRead` schrijft bewust géén attempt-event, dus leespaden kunnen dit signaal niet vervuilen.

### 5.2 Bronneutraal

Elke signaalquery groepeert op `fonds_id`, ook nu er één fonds is (TO §9, FO §20.1). Er wordt een meting geproduceerd voor **elk actief fonds**, ook bij nul waarnemingen — anders bewijst de implementatie de groepering niet en is "het werkt met N fondsen" een aanname. Alleen `uptime_kern` is platformbreed en levert één rij met `fonds_id = null`. Dat `platformbreed` een eigenschap van de meetdefinitie is en géén instelling, is afgedwongen: `combineerConfig` negeert het veld als het uit de database zou komen.

### 5.3 Cadans

Eén cron (`*/5 * * * *`), per signaal een eigen `interval_minuten`. Per run wordt alleen gemeten wat aan de beurt is: de nieuwste snapshot ouder dan het interval. **Stateloos en zelfherstellend** — na een uur stilstand haalt de eerstvolgende run alles in, zonder ergens bij te houden wanneer we voor het laatst draaiden.

Verwachte belasting: ±744 snapshotrijen per dag; acht aggregaten over begrensde vensters op bestaande indexen (`idx_dpj_status`, `idx_log_tijd`, `idx_pel_correlatie`).

---

## 6. Healthchecks

Zeven componenten conform TO §9.2, elk met status en responstijd.

| Component | Meting |
|---|---|
| back-office | antwoordt (deze code draait daar) |
| tenant-app | `GET https://<APP_HOST>/api/healthz/ping` |
| supabase | `select id from fondsen limit 1` |
| storage | `listBuckets()` — bucketonafhankelijk |
| model-API | `GET https://api.anthropic.com/v1/models?limit=1` — **metadata-endpoint, verbruikt geen tokens** |
| embedding/retrieval | afgeleid uit `retrieval_meta.embedding_query_success` over het laatste uur |
| documentverwerking | afgeleid uit `document_processing_jobs` (hangend >30 min, mislukt laatste uur) |

**Twee endpoints, bewust gescheiden** (architectuurpunt 4 van de werkopdracht):

- `/api/healthz/ping` — publiek, geeft uitsluitend `{"ok":true}`. Geen DB, geen env, geen versie. Nodig omdat de snapshot-job alleen in het beheer-project draait en de beschikbaarheid van het andere Vercel-project niet van binnenuit kan meten.
- `/api/platform/healthz` — CRON_SECRET-gated. Een publiek eindpunt dat Supabase-connectiviteit, storage-status en model-API-bereikbaarheid prijsgeeft is een kaart van de infrastructuur voor een aanvaller.

De embedding- en documentverwerkingchecks zijn **afgeleid, geen live probe**: een embedding-aanroep kost geld en zou de meting zelf tot kostenpost maken. `reden` is altijd een vaste, door ons geschreven string — nooit een doorgegeven foutmelding van een derde.

---

## 7. Zelfmonitoring — een blinde monitor is een risico

FO §18.2 benoemt back-office-observability als het derde beschikbaarheidsniveau: *"monitoring/logging zelf (een blinde monitor is een risico)"*.

Concreet ingebouwd:

- Het dashboard toont bovenaan **wanneer er voor het laatst is gemeten**.
- Een snapshot ouder dan **2,5 × het meetinterval** maakt het signaal **grijs/onbekend — nooit groen**. Ook een oude *rode* meting wordt grijs: die is geen bewijs dat het nú rood is.
- Is er nog nooit gemeten, dan staat er een expliciete waarschuwing met wat er te controleren valt, in plaats van acht groene vinkjes op lege tabellen.
- Een signaal waarvan de **meetquery** faalt krijgt een rij met status `onbekend` en een reden, in plaats van géén rij — anders zou een kapotte query niet te onderscheiden zijn van een stilgevallen cron.
- Een leesquery die de `LEESLIMIET` raakt levert `onbekend` met `meta.afgekapt`, niet een getal uit een halve dataset. Alle tijdgebonden queries dragen daarom een expliciete `.order()`: zonder volgorde garandeert PostgREST niets, en dan zou bij afkapping van de result-kant van signaal 14 een afgeronde handeling als auditgat tellen — vals alarm op precies het signaal dat over de volledigheid van het auditspoor gaat.
- `Number(null)` is `0`, en `0` is finiet en niet-negatief. De latency-query filtert daarom expliciet op `null` vóór de conversie. Zonder die check zouden alle gesprekken van vóór deze tranche als 0 ms meetellen: p95 richting nul, `n` ruim boven de n-drempel, en een groen stoplicht op waarnemingen die nooit gemeten zijn. Dat is de blinde monitor in zijn zuiverste vorm.

Dit is bevinding **T-01** in ontwerpvorm: `npm run sanity` stopte destijds bij de eerste rode suite, waardoor 45 suites twee weken niet draaiden zonder dat iemand het zag. Die faalvorm hoort in de monitoringlaag zelf te zijn afgevangen.

---

## 8. Dashboard (P4-light)

`/platform/monitoring`, achter `platform.observability.read` — **niet** achter de tenant-rol `beheerder`. Dat is no-regret-besluit 1 uit FO §20.1 en de daar expliciet benoemde valkuil.

Dubbele check, zoals op de contact-inbox: een vriendelijke voorcheck met uitleg, plus de échte server-side afdwinging binnen `withPlatformRead` (live AAL2-hercheck, actief-check, capabilitycheck) die ook een result-event schrijft — met alleen tellingen als `effect`, nooit meetwaarden of fondsnamen.

### 8.1 Drie lagen (P4-light tranche B, 2026-08-08)

De oorspronkelijke opzet rendeerde **één kaart per signaal per fonds** — 8 kaarten bij één fonds, 29 bij vier, zonder filter, samenvatting of sortering op ernst. Dat is vervangen door een **driedelig dashboard** (voorstel herontwerp §4; besluiten [`0141`](./decisions/0141-monitoring-aggregatie-uitsluitend-op-statussen.md) en [`0142`](./decisions/0142-monitoring-leeslimiet-uitdunnen-en-periode-bovengrens.md)):

1. **Ketenstatusbalk** — één platformbrede uitspraak (In orde / Aandacht / Verstoord / Onbekend) plus vier domeintegels (Beschikbaarheid · Verwerking · AI-kwaliteit · Beveiliging en audit), elk met de slechtste status en het aantal afwijkende én onbekende metingen. De balk **negeert het fondsfilter en de periodekeuze**: hij gaat over "nu". Tegels zijn klikbaar als domeinfilter.
2. **Filterbare signaaltabel** — één rij per signaal, ongeacht het aantal fondsen. Bij "Alle fondsen" de slechtste status over de fondsen, een verdelingsindicator met tekstueel equivalent en de naam van het slechtst scorende fonds; bij een gekozen fonds de waarde van dát fonds. Sortering op ernst (standaard) of domein, plus een "alleen afwijkingen"-schakelaar en een periodekeuze **24 uur / 7 dagen** (standaard 7 dagen).
3. **Detail per rij** (uitklap, geen aparte pagina) — grote trendlijn, meetdefinitie, venster, meegestempelde drempels, dekkingsbadge + dekkingsvoorbehoud, de volledige `meta`, betekenisregel, eigenaar en opvolgactie, de uitsplitsing per fonds en een periodesamenvatting (aandeel in orde, overschrijdingen, langste afwijking, onbekend). Voor percentiel- en trendsignalen toont die samenvatting de hoogste + mediane snapshot, nooit een percentiel over percentielen.

**Architectuur.** De server leest één keer (binnen `withPlatformRead`); het fonds-, periode- en domeinfilter draaien in een client component en veroorzaken dus **geen extra auditpaar per klik** — het `effect` blijft `{signalen, snapshotrijen}`, zonder fondsnaam of meetwaarde. De aggregatie- en samenvattingslogica leeft als pure functies in `monitoring-signalen.ts` (`aggregeerStatus`, `samenvattingPerDomein`, `vatPeriodeSamen`, `kiesSlechtsteMeting`, `dunTrendUit`), met negatieve controles in de sanity. De trend wordt server-side tot ± 1 punt/uur uitgedund zodat de client-payload begrensd blijft; `trendAfgekapt` en het werkelijk gedekte aantal dagen blijven zichtbaar (besluit `0142`).

**Vijf code-only registryvelden** vullen de nieuwe lagen: `domein`, `betekenis`, `eigenaar`, `opvolgactie` en `dekkingsniveau` — eigenschappen van de meetdefinitie of van de organisatieafspraak, door `combineerConfig()` genegeerd als ze uit de database zouden komen (negatieve controle in de sanity), net als `platformbreed` en `dekkingsvoorbehoud`.

**Kleur is nooit de enige drager** (besluiten `0097` en `0101`). Elke status draagt drie onafhankelijke signalen: kleur (via de bestaande `ok`/`warn`/`err`-tokens), woord ("In orde" / "Aandacht" / "Verstoord" / "Onbekend") en vorm (vinkje / uitroepteken / kruis / streepjes, elk in een eigen omtrek). Er is een legenda.

**Aggregaat-first.** Geen individu-herleidbaar gegeven. Signalen die op gebruikersgedrag leunen dragen de n-drempel n<10 uit besluit `0055` — hergebruikt uit `core/lib/suppressie.ts`, geen zelfverzonnen waarde — en tonen dan "onderdrukt" met status onbekend.

De suppressie zit op **drie** plekken, want op één plek is ze een weergavetruc:

1. **Bij het meten** — onder de drempel wordt de waarde niet weggeschreven, en het absolute tokengetal verdwijnt uit `meta`. Anders staat het onderdrukte getal 180 dagen in de database; bij n=1 is dat het exacte verbruik van één gesprek van één bestuurder.
2. **In de leeslaag** — élk trendpunt met n<10 wordt gemaskeerd, niet alleen de laatste meting. De kaart toont "onderdrukt", maar de trendlijn krijgt de hele historie mee en zou de waarde anders gewoon plotten — en het `aria-label` van de grafiek spreekt hem letterlijk uit. Een privacybelofte die in dezelfde component sneuvelt is erger dan geen belofte.
3. **In de configuratie** — de drempel is via de database alleen te VERHOGEN, nooit te verlagen of uit te zetten, afgedwongen door een CHECK-constraint én door een vloer in `combineerConfig`. Anders is besluit 0055 met één SQL-update weg voor precies de signalen waar het voor bedoeld is, terwijl het dashboard blijft beweren dat de drempel geldt. Verlagen hoort een besluit te zijn dat 0055 herziet.

`maskeerTrendwaarde` staat als aparte pure functie in de registry, juist zodat deze waarborg programmatisch na te rekenen is in plaats van te leunen op één regel in de leeslaag.

Trendlijnen zijn **pure SVG**; er is geen chart-library toegevoegd. De vergelijkbare trendlijn onder `app/(dashboard)/` wordt bewust niet geïmporteerd: de platform-surface hoort niet uit de tenant-surface te lezen. Extractie naar `core/components/` is een nette opruimactie, maar hoort niet in een monitoringtranche.

---

## 9. Datamodel

Drie nieuwe tabellen, alle drie RLS aan + **bewust geen policy** + expliciete `revoke` bij `anon` en `authenticated`. Die revoke is nodig omdat R6 de `supabase_admin`-kant van de default privileges niet kon dichtzetten: een nieuwe tabel kan anders de volledige Supabase-standaardgrant meekrijgen.

| Tabel | Kern | `fonds_id` | Retentie |
|---|---|---|---|
| `app_errors` | gestructureerde foutregels, 10 categorieën × 4 severities, met `bron` (rpc/service) | ja (afgeleid) | 90 dagen |
| `platform_signal_snapshots` | tijdreeks per signaal per fonds, met meegestempelde drempels | ja (nullable = platformbreed) | 180 dagen |
| `platform_signaal_config` | drempels/intervallen als data | nee (platformbreed) | n.v.t. |

**Gate-impact**: `app_errors` en `platform_signal_snapshots` dragen een eigen `fonds_id` en slaan gate A1 daarmee over; gate B vindt geen policies. `platform_signaal_config` heeft geen `fonds_id` en is toegevoegd aan de `globaal`-array van de structurele gates — zonder die registratie faalt A1 terecht. `fn_app_error_log` heeft een gepind `search_path` (gate E) en is ingetrokken bij `public` én `anon` (gate H). Geen `TRUNCATE`-recht aan wie dan ook (gate F).

**`app_errors` is geen auditspoor** en bewust niet append-only — zie besluit `0104`. Het onderscheid is gedragsmatig vastgelegd: `supabase/checks/2026_08_03_p5_monitoring.sql` toetst aan de ene kant dat `app_errors` opschoonbaar is, en aan de andere kant dat `platform_event_log` append-only blijft.

---

## 10. Wat bewust buiten scope bleef

| Onderdeel | Waarom |
|---|---|
| **Alerting** | Bestemming hangt aan de open maildomeinkeuze (compliance-gap 6). Drempels liggen als data klaar; de alerting-tranche hoeft alleen een bestemming toe te voegen, geen herdefinitie. |
| **`platform_incidents`, MTTR/MTTD (signaal 8)** | Incidentregistratie zonder detectie is handmatige invoer. Uptime wordt puur uit healthcheck-snapshots berekend en heeft de tabel niet nodig. |
| **`platform_rls_violations` (signaal 16), securitymonitoring** | Detectiedefinitie (TO §9.3) is niet triviaal en hoort bij P9. |
| **P6 log-inzage-UI / doorklik op signaal 14** | AVG-zwaar; hangt aan gate B14-3. Zie besluit `0106`. |
| **Sentry of een externe suite** | Besluit `0005` staat; heroverwegen vraagt een sub-verwerkersafweging. |
| **Gates A–H als periodiek signaal tegen productie** | Buiten dit ticket gehouden (opdrachtgever, 03-08-2026). Het uitvoeren van de gates als opleveringscontrole valt daar níet onder en is gedaan. |
| **De 178 losse `console.error`-regels omzetten** | Eigen opruimtranche; zie §2 correctie 3. |

---

## 11. Restrisico's

- **Dekking van `app_errors` is ≈28% van de routes.** Alles wat niet door `errorResponse` loopt, blijft ongedekt.
- **Fouten zonder sessie landen niet in `app_errors`** (contactformulier, publieke pagina's) — zie §3.1.
- **Een fout tijdens een DB-storing landt niet in `app_errors`** — al erkende schuld in `0005`; `console.error` is het tweede spoor.
- **Geen volumebegrenzing op `app_errors`.** Een route die in een lus faalt kan de tabel vullen; retentie is de backstop.
- **Tokentelling en latency zijn onvolledig van opzet** — expliciet gelabeld, zie §5.1.
- **De registry in code en de seed in de migratie zijn twee plekken met dezelfde getallen.** De sanity bewaakt interne consistentie, niet de gelijkheid met de seed.
- **`app_errors` is geen bewijsmateriaal.** Rate limiting is de compensating control onder de 72-uurs meldtermijn, maar deze tabel is 90 dagen, niet append-only en met de service-role verwijderbaar. Een incident dat meldplichtig kán zijn hoort dáárnaast een spoor in `platform_event_log` of `governance_log` te krijgen. Deze regels zijn signalen, geen vastlegging.
- **`voorbereiding` en `besluit-concept` schrijven geen `governance_log`-regel.** Dat is een pre-existente breuk met de guardrail "elke AI-interactie blijft herleidbaar" — niet door deze tranche veroorzaakt, wel erdoor blootgelegd doordat het tokensignaal die routes structureel mist. `besluit-concept` genereert besluittekst en is daarmee de meest besluitvormingsnabije AI-output in het product. Verdient een eigen tranche.
- **`app/(dashboard)/governance/page.tsx` doet `select("*")`** en haalt daarmee ook de nieuwe telemetrie op. Niet gerenderd en pre-existent, maar `duur_model_ms` en `tokens` hangen per rij aan `gebruiker_id` en zijn fondsbreed leesbaar. Dat is operationele telemetrie, uitdrukkelijk géén individuele prestatiemeting.
- **Productie-drift blijft structureel ongedekt.** CI toetst een schema-uit-migraties op een wegwerp-DB en raakt productie bewust nooit — precies het risico dat besluit `0096` als "gedetecteerd, niet voorkomen" accepteert. Buiten dit ticket gehouden; het risicoregister moet de actie wél juist beschrijven.

---

## 12. Verificatie

- `./node_modules/.bin/tsc --noEmit --skipLibCheck` — exit 0
- `npm run sanity` — "Alle sanity-suites groen" (inclusief de `app-fout`-tests met zes negatieve controles, en de `monitoring-signalen`-suite; die laatste is met blok A+D uitgebreid met de aggregatie-, periodesamenvatting- en code-only-negatieve controles)
- `npm run lint:colors`, `npm run lint:boundaries` — schoon
- `bash scripts/cross-tenant-ci.sh` — app-laag groen (136 tests); de DB-laag draait in CI met een test-DB
- `supabase/checks/2026_07_31_r1_structurele_gates.sql` — handmatig tegen de doeldatabase, ná de migratie
- `supabase/checks/2026_08_03_p5_monitoring.sql` — gedragscheck, aangehaakt in `scripts/cross-tenant-ci.sh`

**Lokaal niet uitvoerbaar:** de DB-laag van `cross-tenant-ci.sh` en de gates A–H vereisen psql/docker/supabase-CLI, en die zijn op de ontwikkelmachine niet aanwezig. De DB-laag draait in CI tegen een ephemere database; de gates zijn een handmatige opleveringsstap tegen de doeldatabase. Zolang die twee niet gedraaid zijn, is de SQL geverifieerd op leesniveau en niet op uitvoering — dat onderscheid hoort expliciet te blijven.

---

## 13. Wat de reviews hebben veranderd

Vier subagent-reviews (`supabase-rls-reviewer`, `audit-evidence-reviewer`, `ai-governance-reviewer`, `code-reviewer`) hebben het ontwerp op negen punten aangescherpt. De belangrijkste, omdat ze alle drie dezelfde vorm hadden — een monitoringlaag die stil het verkeerde meldt:

1. **`Number(null) === 0`** maakte signaal 3 groen op nooit gemeten gesprekken. Alle rijen van vóór deze tranche zouden als 0 ms meetellen.
2. **De trendlijn plotte onderdrukte waarden** en sprak ze uit in het `aria-label`, terwijl de pagina in dezelfde component belooft dat gebruikssignalen onder n<10 worden onderdrukt.
3. **`duur_ms` sloeg de map-reduce-lus over** — de trage tak. Het signaal heette "AI-respons-latency" maar mat de eindgeneratie, en trok de p95 juist omlaag bij precies de beurten waarvoor je latencybewaking inricht.

Verder: de RPC was een onbegrensd schrijfpad voor elke ingelogde gebruiker (volumeklep + `bron`-kolom toegevoegd), de append-only-regressiecheck kon vacuüm slagen op een lege tabel (seed-eerst, en nu ook `governance_log` en UPDATE), er was geen positieve controle dat `service_role` er wél bij kan, de healthz-route logde via een pad dat daar niet werkt, de leeslimiet werd stil overschreden ondanks een comment die het tegendeel beloofde, en het dekkingsvoorbehoud stond in een veld dat met één SQL-update leeg te maken was.

Wat de reviews **niet** hebben gevonden: geen cross-tenant lek, geen service-role op de gedeelde surface, geen aantasting van het bestaande auditspoor, en geen wijziging aan de AI-prompt of aan wat de AI beslist.

---

## Referenties

- Werkopdracht "monitoringbasis beheer-surface (P5-light + P4-light)" v0.3
- Besluiten `0005`, `0055`, `0065`, `0066`, `0092`, `0096`, `0097`, `0101`, en nieuw: `0104`, `0105`, `0106`
- FO Increment P v0.3 §12, §17, §18.1, §18.2, §19, §20.1; TO Increment P v1.1 §9
- `supabase/migrations/2026_08_03_p5_monitoring.sql`
