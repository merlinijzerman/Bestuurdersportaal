# Werkopdracht: monitoringbasis beheer-surface (P5-light + P4-light)

| | |
|---|---|
| **Versie** | v0.3 — 2026-08-03 (v0.2: DoD + documentatiehaak getoetst aan `CLAUDE.md` en `release-template.md`; v0.3: zelfmonitoring snapshot-job, handmatige opleveringsstappen) |
| **Surface** | Platform-back-office (`beheer.bestuurdersportaal.com`, route-groep `(platform)`) |
| **Herkomst** | Analyse 03-08-2026 op `06 Roadmap/Kritische review beheer-surface (Increment P) v0.1`, geverifieerd tegen de code van vandaag |
| **Besluitkader** | `decisions/0005` (monitoring in-stack) blijft leidend — bevestigd 03-08-2026 |
| **Impactklasse** | **Data-impact** (twee nieuwe tabellen) + **RLS-impact** (nieuw schrijfpad). Daarmee valt deze tranche binnen de documentatiehaak van `CLAUDE.md` §Definition of Done en het gate-criterium van `release-template.md` — dit is géén kleine release waarbij `HANDOVER.md` volstaat. Zie §6 |

---

## Werkopdracht

**Doel & context** — De beheer-surface heeft geen monitoringlaag. Er zijn ruwe bronnen (rate-limit-events, pipeline-jobs, het platform-event-log), maar niets dat ze aggregeert, niets dat de gezondheid van de keten meet, en geen plek waar iemand ernaar kijkt. Fouten landen uitsluitend in `console.error` → Vercel-logs.

Dat is niet alleen een gemis aan comfort. Detectie is inmiddels de compensating control onder meerdere bewust geaccepteerde risico's: rate limiting is fail-open bij een DB-storing, de malwarescan is gestubd en zichtbaar als `overgeslagen`-job waar niemand naar kijkt, en de datalekprocedure (art. 33/34) is niet uitvoerbaar zonder detectie — het risicoregister noteert er letterlijk bij *"detectie zwak zonder monitoring"*. Een 72-uurs meldtermijn zonder detectiemechanisme is een papieren termijn.

Deze tranche bouwt de **eerste basis**: de ontbrekende bronnen operationeel maken, de bestaande bronnen ontsluiten, en één stoplichtpagina op de beheer-surface waar het samenkomt.

**Goedgekeurd ontwerp/plan** — `04 Technische inrichting/Bestuurdersportaal - Increment P platform back-office technisch ontwerp v1.1` §9 (observability, signaalbronnen, healthchecks) is leidend voor de technische vorm. `03 Functioneel ontwerp/Bestuurdersportaal - Platform-beheermodule Increment P functioneel ontwerp v0.3` §12 (P5), §18.1 (`app_errors`-model) en §19 (signaalcatalogus) zijn leidend voor de functionele eisen en de drempels. Besluit `0005` (in-stack, geen Sentry) is bevestigd als uitgangspunt en staat in deze tranche niet ter discussie.

---

## 1. Uitgangspunt: wat er al ligt, en wat niet

*Feit — geverifieerd tegen migraties en code op 03-08-2026.* De signaalbronnentabel in TO §9.1 is op twee punten optimistischer dan de werkelijkheid. Ga niet uit van die tabel; ga uit van deze.

| Bron | TO §9.1 zegt | Werkelijk aangetroffen |
|---|---|---|
| `app_errors` | "deels (status opzet) — operationeel maken" | **Bestaat niet.** Nul migraties. `core/lib/api-errors.ts` schrijft alleen naar `console.error`; de Sentry-hook in de kop is nooit ingevuld |
| Rate-limiting | ja | ✅ `rate_limit_events` + `fn_rate_limit_check` (`2026_06_10_rate_limiting.sql`), in gebruik in 13 routes |
| Upload-/pipeline-events | "bouwen" | ✅ **Bestaat al** — `document_processing_jobs` (`2026_06_24_p1_generieke_curatie.sql`), met `stap`, `status`, `foutcode`, `retry_count`, `correlatie_id`. Deny-by-default RLS, bewust geen policy |
| `platform_event_log` | gebouwd in P0 | ✅ Hash-geketend, `fase` = `attempt`/`result`, `uitkomst`, `correlatie_id` |
| `retrieval_meta` | "`gesprekken.retrieval_meta`" | ✅ Bestaat, maar **op `governance_log`**, niet op `gesprekken` (`2026_05_30_rag_ranking.sql`). FO §19 verwijst naar de verkeerde tabel |
| Model-/tokenlogs | "deels" | ⚠️ **Geen bron.** `core/lib/llm-providers/anthropic.ts` berekent `tokens: {in, out}` uit `usage`, maar niets persisteert dat voor het tenant-chatpad. Alleen AQLab legt tokens vast |
| Healthchecks | "bouwen" | ❌ Geen enkel `/healthz`-endpoint in de codebase |
| `platform_signal_snapshots` | snapshot-cron | ❌ Bestaat niet |
| Cron-infrastructuur | — | ✅ **Bestaat al** — `vercel.json` draait `/api/aqlab/worker` elke minuut. Een snapshot-job is een nieuwe route, geen nieuwe bouwsteen |

**Consequentie voor de planning:** de pipeline-bron hoeft niet gebouwd te worden (scheelt werk), maar de tokenbron wél (kost werk dat niet in de roadmap staat). Netto ongeveer gelijk; de verdeling is anders dan het TO aanneemt.

---

## 2. Scope

### Wel

**Blok 1 — `app_errors` operationeel maken.**
Sluit de openstaande helft van besluit `0005` (rate limiting werd gebouwd, error-logging niet). Tabel volgens FO §18.1 met de tien foutcategorieën + severity, gevuld vanuit de bestaande `errorResponse`-helper in `core/lib/api-errors.ts`, met `correlatie_id` naar `platform_event_log` waar een platformhandeling de fout veroorzaakte. Alle 13+ routes die de helper al gebruiken profiteren automatisch — er is geen route-voor-route-aanpassing nodig.

**Blok 2 — Healthcheck-endpoints.**
`/healthz`-stijl per component conform TO §9.2: tenant-app, back-office, Supabase-connectiviteit, storage, model-API, embedding/retrieval, documentverwerking. Elke check levert groen/oranje/rood plus een responstijd. Geen inhoud, geen fondsdata, geen gebruikersgegevens in de uitkomst.

**Inclusief de monitor zelf.** FO §18.2 benoemt beschikbaarheid op drie niveaus, waarvan het derde *back-office-observability* is: *"monitoring/logging zelf (een blinde monitor is een risico)"*. Concreet: het dashboard toont wanneer de laatste snapshot is geschreven, en een snapshot die te oud is maakt het betreffende signaal **grijs/onbekend — nooit groen**. Een stilgevallen cron mag niet als "alles in orde" lezen. Dit is dezelfde faalvorm als bevinding T-01 (`npm run sanity` stopte bij de eerste rode suite, waardoor 45 suites twee weken niet draaiden zonder dat iemand het zag); die les hoort in de monitoringlaag zelf te landen.

**Blok 3 — `platform_signal_snapshots` + snapshot-cron.**
Tabel voor tijdreeksen, plus een geplande route die periodiek de signaalset draait en wegschrijft. Hergebruikt het cron-patroon van `/api/aqlab/worker`. **Bronneutraal**: elke signaalquery groepeert op `fonds_id`, ook nu er één fonds is (TO §9, FO §20.1) — dat is de voorwaarde om later zonder herontwerp naar N fondsen of een externe suite te kunnen.

**Blok 4 — P4-light dashboard op de beheer-surface.**
Eén pagina achter `platform.observability.read` met stoplichten per signaal en een trendlijn per signaal uit de snapshots. De landingspagina `(beveiligd)/page.tsx` is nu een linkmenu; deze pagina komt ernaast, niet ervoor in de plaats.

**Signaalset voor deze tranche — acht van de negentien uit FO §19,** gekozen omdat hun bron ná dit ticket bestaat:

| # | Signaal | Bron na dit ticket | Bijzonderheid |
|---|---|---|---|
| 1 | Embedding-/indexeringsfouten | `app_errors` + `document_processing_jobs` | — |
| 2 | Extractie-/OCR-achterstand | `document_processing_jobs.status` | Bron bestaat al |
| 3 | AI-respons-latency (p95) | `governance_log.retrieval_meta` | **Te verifiëren in Plan-modus** of de duur al in `retrieval_meta` zit; zo niet, toevoegen |
| 4 | Lege-antwoord-ratio | `governance_log` | — |
| 5 | Rate-limit-incidenten | `rate_limit_events` | Bron bestaat al |
| 6 | Tokenverbruik per fonds | *ontbreekt* | **Vergt persistentie** van de `tokens {in, out}` die de adapter al berekent |
| 7 | Uptime kernfunctionaliteit | healthchecks (blok 2) | — |
| 14 | Audit-volledigheid (`attempt` zonder `result`) | `platform_event_log.fase` | Bron bestaat al; privacyklasse **hoog** |

**Blok 5 — Retentie per nieuwe tabel.**
`app_errors` en `platform_signal_snapshots` zijn nieuwe verwerkingen. Bewaartermijnen zijn projectbreed nog niet gedefinieerd (compliance-gap 2, open). Leg voor **deze twee tabellen** een termijn vast bij aanleg, inclusief technische opschoning. Zonder dit vergroot een monitoringtranche de compliance-schuld die hij moet helpen verkleinen.

### Niet

- **Geen alerting.** Geen e-mail, geen push, geen notificaties op rode drempels. Bewust uitgesteld (opdrachtgever, 03-08-2026); volgt als eigen tranche. Ontwerp de drempels wél al als data (config), zodat alerting later alleen een bestemming hoeft toe te voegen en geen herdefinitie vraagt. *Achtergrond bij het uitstel: de bestemming hangt aan de open maildomeinkeuze (Mailgun-sandbox, compliance-gap 6) — dat maakt uitstel hier een verstandige volgorde, geen schuld.*
- **Geen `platform_incidents`, geen MTTR/MTTD (signaal 8).** Incidentregistratie zonder detectie is handmatige invoer; die hangt logisch aan de alerting-tranche. Uptime (signaal 7) wordt in deze tranche puur uit healthcheck-snapshots berekend en heeft de incidenttabel niet nodig.
- **Geen gates A–H, geen driftdetectie tegen productie.** Buiten dit ticket gehouden (opdrachtgever, 03-08-2026). Zie §5 voor de registercorrectie die hier wél uit voortkomt.
- **Geen `platform_rls_violations`** (signaal 16) en geen securitymonitoring (P9). Detectiedefinitie TO §9.3 is niet triviaal en hoort bij P9.
- **Geen Sentry, geen externe observability-suite.** Besluit `0005` staat; heropening vraagt een eigen beslisnotitie met sub-verwerkersafweging.
- **Geen P6 log-inzage-UI** (cross-tenant `platform.logs.read`). Signaal 14 toont in deze tranche alleen het **aantal** onvolledige audit-paren, geen doorklik naar logregels. Doorklik is AVG-zwaar en hangt aan de retentie-/toegang-gate B14-3, die nog open staat.
- **Geen wijziging aan RLS-policies van bestaande tabellen**, geen wijziging aan het tenant-datamodel, geen wijziging aan het bestaande auditspoor.

---

## 3. Architectuur- en risicopunten die in Plan-modus beslist moeten worden

**1. Waar `app_errors` staat en wie erbij kan.** De tabel bevat foutcontext die naar een fonds herleidbaar kan zijn. Deny-by-default zoals `document_processing_jobs` (bewust géén policy, alleen service-role) is het bestaande precedent op deze surface. Leg expliciet vast: welke rol schrijft, welke rol leest, en of `fonds_id` op de rij staat. Let op de valkuil dat een errorlogger die zelf via de anon-key schrijft een nieuw schrijfpad naar een platformtabel opent.

**2. Wat er níet in een foutregel mag landen.** Supabase-foutmeldingen kunnen kolomnamen, tabelnamen en rij-data bevatten — dat is precies waarom `api-errors.ts` bestaat. De helper saniteert nu richting de *gebruiker*; bij het wegschrijven naar de database moet apart worden bepaald wat wél mag worden bewaard. Prompts, documentinhoud, deelnemergegevens en vraagteksten horen er niet in. Beschrijf de sanitatieregel in het plan.

**3. Een fout tijdens een DB-storing landt niet in `app_errors`.** Besluit `0005` benoemt dit al als aanvaarde schuld. Bepaal wat er dan wél gebeurt (blijft `console.error` staan als tweede spoor?) en zorg dat het wegschrijven **nooit** de oorspronkelijke response kan blokkeren of vertragen — een falende logger mag geen falende request worden.

**4. Authenticatie van de healthcheck- en cron-routes.** `/healthz`-endpoints zijn per definitie onbeveiligd bereikbaar of juist niet; kies bewust. Een publieke healthcheck die Supabase-connectiviteit en model-API-status lekt is een informatiebron voor een aanvaller. Voorstel om te toetsen: healthchecks alleen intern aanroepbaar door de snapshot-job (gedeeld geheim), dashboard leest de snapshots. De cron-route zelf volgt het bestaande beveiligingspatroon van `/api/aqlab/worker` — verifieer dat patroon en wijk er niet van af.

**5. Twee Vercel-projecten sinds variant C.** Beheer draait als apart project met geïsoleerde service-role (besluiten `0066`/`0083`). De cron-definitie in `vercel.json` vuurt in **beide** projecten — de AQLab-worker houdt daar al rekening mee (zie de comment bij regel 48 van die route). Bepaal in welk project de snapshot-job hoort te draaien en hoe dubbele runs worden voorkomen.

**6. Kosten en belasting van de snapshotfrequentie.** Acht signaalqueries op een productiedatabase, periodiek. Bepaal de frequentie per signaal (uptime vraagt een andere cadans dan tokenverbruik) en onderbouw dat de queries geïndexeerd zijn. `document_processing_jobs` heeft al een partiële index op `status`; controleer of de overige bronnen dat ook hebben.

**7. Drempels als data, niet als code.** TO §9 laat de plek open (`platform_feature_flags` of een eigen `platform_signaal_config`-rij). Kies expliciet. Dit is de haak waar de latere alerting-tranche op landt; een drempel die hardcoded in een query staat moet dan opnieuw worden verplaatst.

**8. Signaal 6 vraagt een wijziging in het chatpad.** Tokenpersistentie raakt `app/api/chat/route.ts` en de provider-adapter — een pad met een bestaand, geborgd auditcontract. Beoordeel of de tokens in `governance_log.retrieval_meta` horen (bestaande jsonb, geen migratie) of in een eigen kolom, en bevestig dat de wijziging geen bestaande logregel verplaatst of dupliceert. **Als dit het plan te breed maakt: laat signaal 6 uit deze tranche vallen en lever zeven signalen op.** Dat is een acceptabele uitkomst; een halve wijziging in het auditpad is dat niet.

---

**Relevante bestanden / modules** — `core/lib/api-errors.ts` (schrijfpad `app_errors`; de hook staat al beschreven in de kop), `supabase/migrations/` (nieuwe migraties: `app_errors`, `platform_signal_snapshots`, retentie), `vercel.json` + `app/api/aqlab/worker/route.ts` (cron-patroon als referentie), `app/(platform)/platform/(beveiligd)/` (nieuwe dashboardpagina + `page.tsx` als navigatie-aanhaakpunt), `platform/lib/platform-wrapper.ts` en `platform/lib/platform-capabilities.ts` (capability `platform.observability.read` bestaat al — hergebruiken, niet toevoegen), `core/lib/llm-providers/anthropic.ts` + `app/api/chat/route.ts` (alleen bij signaal 6). Claude Code verifieert tegen de werkelijke code.

**Guardrails (zie `CLAUDE.md`)** — bevestig naleving van: RLS per `fonds_id` (alleen anon-key), append-only audit, human-in-the-loop, migratie-eerst-dan-deploy, snapshot-integriteit, geen schijnzekerheid. Specifiek voor deze opdracht:

- **Bronneutraal groeperen.** Elke signaalquery groepeert op `fonds_id`, ook bij één fonds. Een query die dat overslaat "omdat er er maar één is" is precies de rework die FO §20.1 uitsluit.
- **Monitoring is geen auditgebeurtenis.** Snapshots en foutregels gaan **niet** naar `governance_log`, `governance_events` of `platform_event_log`. Het bestaande auditspoor blijft ongewijzigd; controleer dat er geen logregel verplaatst of gedupliceerd wordt.
- **Aggregaat-first met n-drempel.** Het dashboard toont geen individu-herleidbare gegevens. FO §17 schrijft een n-drempel voor bij gebruikssignalen wegens her-identificatierisico bij kleine fondsen; pas die toe waar een signaal op gebruikersgedrag leunt.
- **Platformhandelingen niet in de tenant-rol.** Het dashboard hangt aan `platform.observability.read`, niet aan de tenant-`beheerder`. Dit is no-regret-besluit 1 uit FO §20.1 en de expliciet benoemde valkuil ("voor nu even monitoring via `beheerder` doen").
- **`npm run lint:colors` blijft groen** — stoplichten gebruiken uitsluitend de bestaande `ok`/`warn`/`err`-tokens. **En kleur is nooit de enige drager** (besluit `0097`, aangescherpt in `0101`): elke stoplichtstatus krijgt een label of icoon.
- **Gates A–H draaien vóór afronding.** `CLAUDE.md` stelt dit als niet-onderhandelbare guardrail bij elke policy-, grant-, `SECURITY DEFINER`- of datamodelwijziging: *"Toets de uitkomst in de database, niet de intentie in de migratie."* Deze tranche voegt twee tabellen toe en valt daar dus onder. Draai `supabase/checks/2026_07_31_r1_structurele_gates.sql` tegen de doeldatabase; schoon op A1, A2, B, C, C2, E, F, G, H en D. *Let op het onderscheid: het bouwen van een periodieke gate-run als monitoringsignaal is buiten scope (§2), het uitvoeren van de gates als opleveringscontrole is dat niet.*
- **`revoke … from public, anon`, niet alleen `from public`.** Komt er een `SECURITY DEFINER`-functie bij (opschoning, aggregatie), dan geldt het patroon uit `CLAUDE.md`: expliciet intrekken bij `public` **én** `anon`, daarna gericht teruggeven aan de rol die de aanroeper werkelijk gebruikt, en een gepind `search_path` (gate E).
- **`TRUNCATE` nooit aan `anon` of `authenticated`.** Direct relevant voor blok 5: de retentie-opschoning mag geen TRUNCATE-recht introduceren. Postgres evalueert daarbij geen enkele policy — gate F detecteert dit, maar bouw het niet in.
- **`supabase/schema.sql` bijwerken** als documentatie bij de nieuwe tabellen (achterlopen is toegestaan, maar niet stilzwijgend), en de migraties **eerst in Supabase draaien, dán code-deploy**.

**In te zetten subagents (zie `SUBAGENTS-ONTWERP.md` §4 trigger-matrix)** — `supabase-rls-reviewer` (verplicht: twee nieuwe tabellen met een nieuw schrijfpad); `code-reviewer` (verplicht); `audit-evidence-reviewer` (vaststellen dat het bestaande auditspoor ongewijzigd blijft en dat monitoring er niet in lekt); `ontwerp-sync-reviewer` vóór merge. `ai-governance-reviewer` alleen als signaal 6 in scope blijft (raakt het chatpad).

**Werkmodus** — begin in **Plan-modus**: lever eerst een implementatieplan met de acht punten uit §3, de bestandenlijst, RLS-impact, migratie-impact, testaanpak en risico's. Neem in het plan expliciet een voorstel op voor de retentietermijn per nieuwe tabel en voor de snapshotfrequentie per signaal. **Wijzig pas na expliciet akkoord.**

---

## 4. Acceptatiecriteria

1. Een fout in een willekeurige API-route landt als rij in `app_errors`, met categorie, severity en — waar van toepassing — een `correlatie_id` dat naar `platform_event_log` verwijst. Aantoonbaar met een bewust uitgelokte fout.
2. Een foutregel bevat aantoonbaar géén prompt-, document- of deelnemergegevens (negatieve controle).
3. Elk healthcheck-component levert groen/oranje/rood en een responstijd; een gesimuleerde storing op één component maakt dat component rood zonder de andere te beïnvloeden.
4. De snapshot-job draait op schema en vult `platform_signal_snapshots`; twee opeenvolgende runs leveren een zichtbare tijdreeks.
5. Elk signaal is per `fonds_id` gegroepeerd opvraagbaar, ook nu er één fonds is.
6. Het dashboard is bereikbaar met `platform.observability.read` en **niet** zonder; een platform-identiteit zonder die capability krijgt een weigering die in `platform_event_log` landt.
7. Elke stoplichtstatus draagt naast kleur ook een label of icoon.
8. Voor `app_errors` en `platform_signal_snapshots` is een bewaartermijn vastgelegd én is de opschoning technisch geïmplementeerd (niet alleen gedocumenteerd).
9. Een piek in extractie-/embeddingfouten voor één fonds is op het dashboard zichtbaar met genoeg context om te handelen (FO §12, acceptatiecriterium 1).
10. `./node_modules/.bin/tsc --noEmit --skipLibCheck` exit 0; `npm run sanity` groen — **lees de slotregel, niet alleen de exitcode**; `bash scripts/cross-tenant-ci.sh` groen (verplicht: de tranche raakt RLS en een auditgerelateerde tabel); `npm run lint:colors` groen.
11. `supabase/checks/2026_07_31_r1_structurele_gates.sql` gedraaid tegen de doeldatabase en schoon op alle gates (A1, A2, B, C, C2, E, F, G, H, D).
12. Een kunstmatig stilgezette snapshot-job maakt de betrokken signalen **grijs/onbekend**, niet groen, en het dashboard toont het tijdstip van de laatste snapshot.

### Handmatige stappen bij oplevering (geen codetaak)

Er is geen migratierunner: migraties worden handmatig in de Supabase SQL-editor geplakt, en deployen loopt via GitHub Desktop (commit → push `main` → Vercel auto-deploy), **niet** via terminal-git. Bij deze tranche betekent dat concreet drie handelingen buiten Claude Code om, in deze volgorde:

1. De twee migraties in de SQL-editor draaien (**eerst de migratie, dán de code-deploy** — anders breken inserts op een tabel die nog niet bestaat).
2. De gates A–H in dezelfde editor draaien en de uitkomst controleren.
3. Deployen via GitHub Desktop.

Claude Code levert de migraties en het gate-commando aan; het uitvoeren is een handeling van de initiatiefnemer. Benoem dit expliciet in de terugkoppeling, zodat het niet als "gedaan" wordt afgevinkt.

---

## 5. Definition of Done

*Overgenomen uit `CLAUDE.md` §Definition of Done — daar staat de gezaghebbende lijst. Hieronder alleen de invulling voor deze tranche.*

- Functionaliteit volgens de acceptatiecriteria in §4.
- RLS-impact gecontroleerd op beide nieuwe tabellen; tenant-isolatie intact.
- Audit-logging meegenomen (toegang tot het dashboard landt in `platform_event_log`).
- Tests toegevoegd, of gemotiveerd niet toegevoegd.
- **UX consistent met bestaande patronen** — het dashboard volgt de bestaande beheer-surface-opmaak; geen eigen visuele taal.
- `tsc --noEmit --skipLibCheck` groen.
- **Gates A–H gedraaid tegen de doeldatabase en schoon** (verplicht bij datamodelwijziging).
- Ontwerpdoc opgesteld of bijgewerkt + ontwerp-sync-check groen.
- `HANDOVER.md` release-historie bijgewerkt.
- **Decision-log-entries**: retentietermijnen, en de gekozen plek van de drempelconfiguratie. Per `release-template.md` landen die in **`mvp/decisions/`** *én* samengevat in **`00 Overzicht en status/besluitenlog.md`** *én* **`02 Architectuur/architectuurbesluiten.md`** — alle drie, niet één ervan.

## 6. Documentatiehaak (verplicht bij deze tranche)

*Feit: `CLAUDE.md` §DoD laatste bullet laat de projectdocumentatie-actualisatie afhangen van de impactklasse — verplicht bij "een gate/mijlpaal of een increment met architectuur-, data-, security- of tenant-impact", bij een kleine release volstaat `HANDOVER.md`. Twee nieuwe tabellen = data-impact, dus de haak vuurt.* Loop `00 Overzicht en status/release-template.md` na; onderstaande items zijn de treffers voor deze tranche.

**Uit de release-checklist — wat hier "ja" scoort:**

- Nieuwe tabellen (`app_errors`, `platform_signal_snapshots`) → objectmodel + datadictionary.
- Tenantisolatie geraakt: krijgen de nieuwe tabellen een `fonds_id`? (= architectuurpunt 1 in §3).
- RLS aangepast: nieuwe policies of bewust deny-by-default.
- Auditlogs geraakt: `app_errors` is een nieuwe logtabel. **Bepaal expliciet of append-only-garanties van toepassing zijn** — het is geen auditspoor, maar wel een logtabel, en het onderscheid hoort vastgelegd, niet impliciet.
- Rollen/capabilities: naar verwachting **nee** (`platform.observability.read` bestaat al) — bevestig dat expliciet in de terugkoppeling.

**Bij te werken documenten:**

| Document | Waarom |
|---|---|
| `00/huidige-status.md`, `00/release-status.md` | Nieuwe module op de beheer-surface |
| `00/openstaande-punten-en-risicos.md` | Restrisico's + bewust uitgestelde onderdelen (alerting, incidenten, signaal 6 indien uitgevallen), **mét eigenaar** |
| `02/architectuurlandschap.md` + `02/applicatiecomponenten.md` + `02/visualisaties/` | Nieuwe component. Let op: **`02 Architectuur/visualisaties/09-beheer-en-monitoring.md` bestaat al** en beschrijft de beoogde situatie — die moet mee |
| `03/functioneel-overzicht.md` | P5/P4-light functionaliteit |
| `04/technische-schuld.md` | Besluit `0005` is met deze tranche voor het eerst volledig ingelost |
| `05/security-risicos-en-maatregelen.md` | De rij "Geen error-monitoring/alerting (WP7)" verandert van status — **niet afvoeren**: alerting blijft open |
| `06/releasehistorie.md` | Release-entry |
| `08/testresultaten.md` + `08/release-acceptatie.md` §1 | Testuitkomsten + vrijgavebesluit |
| `09/logisch-objectenmodel.md`, `09/fysiek-datamodel.md`, `09/datadictionary.md`, `09/datagebruik-in-landschap.md`, `09/visualisaties/` | Twee nieuwe tabellen, ER-diagram |
| As-built Word-doc | Gate-scoped en verplicht bij data-impact. **Loopt al achter** (staat t/m T7, met T8–T11 + AQLab gebatcht) — voeg deze tranche aan die batch toe in plaats van een losse actualisatie |
| `00/doc-actualisatie-log.md` | Marker **pas verschuiven ná** de Word-doc-actualisatie, nooit vooruit (les uit OP-D2) |

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md` (samenvatting, aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's). Rapporteer daarbij expliciet: de gekozen snapshotfrequentie per signaal en de gemeten querylast, en of signaal 6 in scope is gebleven.

---

## 7. Documentatiecorrecties die uit deze analyse volgen

*Los van de bouw; hoort bij de documentatie-herijking (blok A uit de beheer-surface-review).*

1. **TO §9.1 signaalbronnentabel** — `document_processing_jobs` staat als "bouwen" maar bestaat sinds `2026_06_24_p1_generieke_curatie.sql`. `app_errors` staat als "deels (opzet)" maar bestaat in het geheel niet.
2. **FO §19 signaal 3 en 4** — verwijzen naar `gesprekken`/`retrieval_meta`; de kolom staat op `governance_log`.
3. **FO §19 signaal 6** — "model-logs" bestaat niet als bron; tokenverbruik wordt berekend maar niet gepersisteerd voor het tenant-pad.
4. **Register-actie #34 ("structurele gates A–H in CI opnemen")** — feitelijk al uitgevoerd: `scripts/cross-tenant-ci.sh` roept `2026_07_31_r1_structurele_gates.sql` aan (regel 143) en `.github/workflows/rls-cross-tenant.yml` draait dat script op elke push én pull request. Wat werkelijk open staat, is tweeledig en verdient twee aparte regels in het register:
   - **(a)** De job is niet blokkerend — branch protection op `main` met deze job als required status check. Dat is actie **#37**, al apart genoemd.
   - **(b)** CI toetst een schema-uit-migraties op een wegwerp-DB en raakt productie bewust nooit. **Productie-drift is daarmee structureel niet gedekt** — precies het risico dat besluit `0096` als "gedetecteerd, niet voorkomen" accepteert. Dit vraagt een periodieke gate-run tégen productie en is géén CI-actie. Nu niet belegd; buiten dit ticket gehouden (opdrachtgever, 03-08-2026), maar het register moet de actie wel juist beschrijven, anders wordt hij afgevinkt zonder gedekt te zijn.
5. **Beheer-surface-review §3.1** (blast radius onder variant B) is achterhaald — variant C is uitgevoerd (besluiten `0066`/`0083`).
