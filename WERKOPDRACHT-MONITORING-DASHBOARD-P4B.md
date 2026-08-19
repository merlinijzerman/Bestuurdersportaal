# Werkopdracht: integraal monitoringdashboard met fondsfilter (P4-light, tranche B)

| | |
|---|---|
| **Versie** | v0.3 — 2026-08-07 (v0.2: blok C — doorvoer en doorlooptijd bij de uploads; v0.3: blok D — periodekeuze en de leeslimiet) |
| **Surface** | Platform-back-office (`beheer.bestuurdersportaal.com`, route-groep `(platform)`) |
| **Herkomst** | Analyse 07-08-2026 op `/platform/monitoring`, geverifieerd tegen de code van vandaag; `VOORSTEL-MONITORING-HERONTWERP.md` §2–§5 |
| **Besluitkader** | `decisions/0005` (monitoring in-stack), `0055` (n-drempel), `0097`/`0101` (kleur nooit enige drager), `0104`–`0106` blijven ongewijzigd leidend |
| **Impactklasse** | **Blok A en D: alleen UI-of-frontend.** **Blok B en C: alleen UI-of-frontend + drie data-seeds** (INSERT in `platform_signaal_config`; géén schemawijziging, géén policy, géén grant, géén `SECURITY DEFINER`). Drie dingen kunnen die weging omgooien — zie §4 |

---

## Werkopdracht

**Doel & context** — De monitoringtab meet goed maar toont slecht. De pagina rendert één kaart per signaal **per fonds**: 8 kaarten bij één fonds, 29 bij vier, 57 bij acht — zonder filter, zonder samenvatting en zonder sortering op ernst. Er is nergens één uitspraak over de gezondheid van de keten. Tegelijk staan er per kaart zes regels metatekst terwijl juist de informatie die betekenis geeft ontbreekt: het absolute getal onder een trendpercentage, het fail-open-deelgetal onder de rate-limit-incidenten, en per signaal wie eigenaar is en wat de opvolgactie is.

Deze tranche verandert **niets aan de waarborgen en niets aan de bronnen**. Het is een herontwerp van de presentatielaag, plus drie meetdefinities op tabellen die vandaag al gevuld worden: het fail-open-getal dat al berekend wordt maar nergens zichtbaar is (blok B), en de doorvoer en doorlooptijd van de documentketen die wél in `document_processing_jobs` staan maar nooit worden gelezen (blok C).

**Waarom blok C erbij hoort — een detectiegat, geen verfraaiing.** De twee bestaande ingest-signalen zijn een *momentopname* (wachtrij) en een *ratio* (faalpercentage). Beide missen de tijd- en de volumedimensie, met twee gevolgen die in de code te reproduceren zijn:

- **Een stilgevallen verwerkingsworker is onzichtbaar zolang er minder dan tien documenten wachten.** `meetExtractieAchterstand()` telt open jobs (`wachtend` of `bezig`) en kleurt oranje vanaf 10. De healthcheck `checkDocumentverwerking()` telt alleen jobs met status `bezig` die langer dan 30 minuten lopen, plus mislukte jobs. Een job die nooit geclaimd wordt blijft `wachtend`: niet "hangend", en bij acht stuks ook niet "achterstand". Acht documenten kunnen dus dagen blijven staan terwijl alles groen is.
- **Een faalpercentage zonder noemer is niet te wegen.** "3,4% mislukt" is iets heel anders bij 58 documenten dan bij 3. Dat is dezelfde regel als bij tokenverbruik (begrijpelijkheidsregel 3 uit het voorstel): nooit een relatief getal zonder zijn absolute basis.

**Goedgekeurd ontwerp/plan** — `VOORSTEL-MONITORING-HERONTWERP.md` §4 (het driedelige dashboard), §4.1 (de zeven begrijpelijkheidsregels) en §5 (wat expliciet niet verandert) zijn leidend. `MOCKUP-monitoring-herontwerp-v0.1.html` is de visuele referentie voor indeling en informatiehiërarchie — **niet** voor opmaak: die mockup gebruikt losse `rgb()`-waarden, de bouw gebruikt uitsluitend de bestaande tokens. `MONITORING-P5-ONTWERP.md` §7 (zelfmonitoring) en §8 (dashboard) blijven van kracht en worden bij oplevering bijgewerkt, niet vervangen.

---

## 1. Uitgangspunt: wat er al ligt

*Feit — geverifieerd tegen de code op 07-08-2026.*

| Onderdeel | Stand |
|---|---|
| `haalMonitoringOverzicht()` | ✅ Levert al alles wat dit dashboard nodig heeft: per (signaal × fonds) de laatste waarde, `n`, status vóór en ná verouderingscorrectie, drempels, `meta` en een gemaskeerde trend van 7 dagen, plus `leesfout` en `trendAfgekapt` |
| Suppressie vóór de client | ✅ `maskeerTrendwaarde` draait in de leeslaag, dus de data die de component bereikt is al geschoond (`core/lib/suppressie.ts` schrijft dit patroon voor) |
| `meta` per signaal | ✅ Wordt gelezen en meegegeven — maar in `page.tsx` **alleen gerenderd voor `uptime_kern`**. `limietchecks_mislukt`, `tokens_laatste_24u`, `daggemiddelde_basisperiode`, `basisdagen`, `waargenomen_runs`/`verwachte_runs` en `afgekapt` bereiken het scherm nooit |
| `Trendlijn.tsx` | ✅ Bestaat, pure SVG, met drempelbanden. Hergebruiken; **niet** een tweede grafiekcomponent bouwen |
| `Stoplicht.tsx` + legenda | ✅ Kleur + woord + vorm. Hergebruiken, ongewijzigd |
| Fail-open-telling | ✅ Wordt al berekend in `meetRateLimitIncidenten()` en weggeschreven als `meta.limietchecks_mislukt` — er is **geen nieuwe bron nodig** om er een eigen signaal van te maken |
| `platform_signal_snapshots.signaal` | ✅ Geen FK en geen CHECK op de signaalnaam; een nieuw signaal is schrijfbaar zonder schemawijziging |
| Tijdstempels op de ingest-jobs | ✅ `document_processing_jobs` draagt `aangemaakt`, `start`, `eind`, `retry_count` en `foutcode`. **Doorlooptijd en doorvoer zijn dus meetbaar zonder migratie en zonder wijziging aan de verwerkingsketen** |
| `leesJobs()` | ⚠️ Selecteert vandaag alleen `document_id, status` — de tijdstempels worden opgehaald noch gebruikt. Uitbreiden, niet vervangen; het `sindsVeld`-mechanisme (`aangemaakt` vs. `eind`) zit er al in |
| Twee schrijfmodellen voor jobs | ⚠️ `generiek-pipeline.ts` schrijft **één job per stap** (validatie…indexering) met `start` en `eind`; `ingest-orchestrator.ts` schrijft **één job voor de hele keten** met `stap` als instapfase. Doorlooptijd per fase is daarom alleen zinvol op het generieke-bibliotheekpad; op het fondspad is het de ketenduur. Dit hoort als dekkingsvoorbehoud op het nieuwe signaal, niet als aanname |
| `HANGEND_MINUTEN` | ✅ 30 minuten is al de bestaande grens voor "hangende job" in `monitoring-health.ts`. Hergebruiken als drempel, geen nieuw getal verzinnen |
| `platform_signaal_config.eenheid` | ⚠️ Draagt een **CHECK** op `('percentage','aantal','milliseconden','trend_percentage')`. Een nieuwe eenheid toevoegen is dus een schemawijziging — zie architectuurpunt 9 |
| Fondsfilter | ❌ Bestaat niet; `page.tsx` leest geen `searchParams` |
| Aggregatie over fondsen | ❌ Bestaat niet |
| Eigenaar / opvolgactie / domein per signaal | ❌ Staan niet in `SignaalConfig`, terwijl FO §19 ze wél voorschrijft |
| Doorvoer en doorlooptijd | ❌ Worden nergens gemeten of getoond |

**Consequentie voor de planning:** blok A raakt geen enkele meetquery, geen migratie en geen RLS. Vrijwel al het werk zit in `page.tsx`, in nieuwe componenten en in twee pure functies in `monitoring-signalen.ts`. Blok B en C voegen meetdefinities toe op bronnen die er al zijn — geen nieuwe tabellen, geen wijziging aan de verwerkingsketen.

---

## 2. Scope

### Wel — blok A: het driedelige dashboard (geen migratie)

**A1 — Ketenstatusbalk.** Eén platformbrede uitspraak (*In orde / Aandacht / Verstoord / Onbekend*) met daaronder vier domeintegels: Beschikbaarheid · Verwerking · AI-kwaliteit · Beveiliging en audit. Per tegel de slechtste status binnen het domein plus het aantal afwijkende en onbekende metingen. Tegels zijn klikbaar als domeinfilter.

De bestaande meldingen boven de balk (leesfout / nog nooit gemeten / aantal verouderd) blijven **ongewijzigd staan** en gaan vóór de balk.

**A2 — Signaaltabel.** Eén rij per signaal — acht rijen, ongeacht het aantal fondsen. Kolommen: Signaal (met betekenisregel) · Status · Waarde en norm · Trend (7 dagen) · Laatst gemeten · Dekking. Standaardsortering op ernst, omschakelbaar naar domeinvolgorde. Schakelaar "alleen afwijkingen".

**A3 — Fondsfilter.** `Alle fondsen` (standaard) of één fonds. Bij "alle fondsen" toont de rij de slechtste status over de fondsen, een verdelingsindicator met tekstueel equivalent, en de naam van het slechtst scorende fonds. Bij één fonds de waarde van dat fonds; platformbrede signalen blijven zichtbaar en zijn als zodanig gelabeld.

**A4 — Detaillaag per rij** (uitklappen, geen aparte pagina): grote trendlijn, meetdefinitie, interval/venster, meegestempelde drempels, dekkingsvoorbehoud, **de volledige `meta`**, en de uitsplitsing per fonds.

**A5 — Begrijpelijkheid.** De zeven regels uit `VOORSTEL-MONITORING-HERONTWERP.md` §4.1. Concreet in deze tranche:
- betekenisregel per signaal (code-only tekst, zie blok B);
- getal met duiding in dezelfde regel (`3,2 s — binnen norm`);
- bij tokenverbruik het absolute verbruik uit `meta` naast het trendpercentage;
- **fix van de drempeltekst.** `beschrijfDrempels()` in `page.tsx` bevat `richting === "lager_is_slechter" ? "vanaf" : "vanaf"` — beide takken geven "vanaf". Bij uptime staat er daardoor *"aandacht vanaf 99,5%"* terwijl aandacht **onder** 99,5% begint. Vervang door "onder" / "vanaf" en borg het met een sanity-test;
- **een onbekende status toont geen getal.** Vandaag wordt bij een verouderde meting de opgeslagen waarde nog getoond; dat leest als een bewering over nu. Toon `—` met de reden, en de laatst gemeten waarde uitsluitend als context met het label dat hij nu niets zegt.

### Wel — blok B: registry-uitbreiding en het fail-open-signaal

**B1 — `SignaalConfig` uitbreiden met vier velden, alle vier CODE-ONLY.** `domein`, `betekenis`, `eigenaar`, `opvolgactie`. Dezelfde redenering als bij `platformbreed` en `dekkingsvoorbehoud` (ontwerp §5.1): het zijn eigenschappen van de meetdefinitie en van de organisatieafspraak, geen instellingen. `combineerConfig()` negeert ze wanneer ze uit de database zouden komen, en de sanity toetst dat.

**B2 — Dekkingsniveau als eigenschap.** Voeg `dekkingsniveau` toe met de waarden `volledig` | `gedeeltelijk` | `indicatief` | `niet_in_werking`, eveneens code-only. Het bestaande `dekkingsvoorbehoud` blijft de tekst; het niveau is de badge in de tabel. `niet_in_werking` is gereserveerd voor signalen waarvan de bron een stub is — die mogen nooit groen tonen.

**B3 — Nieuw signaal `rate_limit_fail_open`.** Splits de twee tegengestelde grootheden die vandaag in één getal zitten:

| Signaal | Betekent | Drempels |
|---|---|---|
| `rate_limit_incidenten` (bestaand, herdefinieerd) | 429-responses — de rem wérkte | oranje 20 / rood 40 per 24 u |
| `rate_limit_fail_open` (nieuw) | mislukte limietchecks — de rem viel wég | oranje 1 / rood 2 per 24 u |

Geen nieuwe bron: `meetRateLimitIncidenten()` telt beide al. Lever twee `Meting`-sets uit dezelfde query in plaats van één.

**B4 — Seed-regel voor het nieuwe signaal** in `platform_signaal_config`, zodat de drempel data blijft en geen deploy vraagt (besluit `0105`). Eén INSERT, geen schemawijziging. Controleer dat `chk_signaal_n_drempel` niet bijt (het nieuwe signaal draagt geen n-drempel).

### Wel — blok C: doorvoer en doorlooptijd bij de uploads

Bron voor alle drie: `document_processing_jobs`, die deze gegevens al draagt. Geen wijziging aan de verwerkingsketen, geen nieuwe tabel.

**C1 — Doorvoer als context bij de twee bestaande ingest-signalen (géén eigen rij).**
Een permanent groene tegel "aantal verwerkte documenten" is precies de ruis die deze tranche wegneemt. Toon het getal daarom waar het betekenis geeft:
- bij *Documenten die niet verwerkt kunnen worden*: de noemer in de waarderegel — `3,4% — 2 van 58 verwerkte documenten (24 u)`;
- bij *Documenten die nog wachten op verwerking*: de doorvoer van de afgelopen 24 uur als tweede regel — `14 wachtend · 58 verwerkt in 24 u`;
- in de detaillaag van beide: de uitsplitsing `geslaagd / mislukt / overgeslagen` en het aantal jobs met `retry_count > 0`, uit `meta`.

Technisch: `meetEmbeddingFouten()` telt de noemer al (afgeronde jobs in het venster) maar gooit hem weg na de deling. Zet hem in `meta` in plaats van hem opnieuw te berekenen.

**C2 — Nieuw signaal `ingest_stilstand`** — de leeftijd van de **oudste openstaande ingest-job** (`wachtend` of `bezig`), per fonds.

Dit is het signaal dat het gat uit *Doel & context* dicht: het detecteert een stilgevallen worker onafhankelijk van het aantal wachtende documenten. Eén document dat drie dagen blijft staan is even alarmerend als tien.

| | |
|---|---|
| Eenheid | tijdsduur (zie architectuurpunt 9 — géén nieuwe eenheidswaarde) |
| Venster | momentopname |
| Interval | 15 min (gelijk aan de andere ingest-signalen) |
| Oranje / rood | ≥30 min / ≥120 min — 30 sluit aan op het bestaande `HANGEND_MINUTEN` |
| n-drempel | geen |
| Bijzonderheid | Lege wachtrij = geen openstaande job = **groen**, niet onbekend. Leg dat expliciet vast; "niets te doen" is een geldige gezonde toestand en mag geen grijs vlak opleveren |

**C3 — Nieuw signaal `ingest_doorlooptijd_p95`** — p95 van de tijd tussen `aangemaakt` en `eind` van afgeronde ingest-jobs, per fonds, over 24 uur.

| | |
|---|---|
| Eenheid | tijdsduur (architectuurpunt 9) |
| Venster | 24 u, gefilterd op `eind` (`sindsVeld: "eind"` bestaat al in `leesJobs`) |
| Interval | 60 min |
| Oranje / rood | **richtwaarden, te kalibreren**: >30 min / >2 u. FO §19 stelt drempels expliciet als richtwaarden die bij bouw worden vastgesteld — meet eerst een week mee en stel dan bij via de configtabel, niet via een deploy |
| Minimum-n | 5 — zie architectuurpunt 10 (dit is een **betekenis**drempel, geen privacydrempel) |
| Dekkingsvoorbehoud | Meet de ketenduur inclusief wachttijd in de wachtrij, niet de rekentijd. Op het generieke-bibliotheekpad bestaan per-stap-jobs, op het fondspad één job voor de hele keten; de uitsplitsing per fase is daarom niet platformbreed beschikbaar |

**C4 — Seed-regels** voor `ingest_stilstand` en `ingest_doorlooptijd_p95`, zelfde vorm als B4.

### Wel — blok D: periodekeuze (24 uur / 7 dagen)

**Wat een periodekeuze hier wél en niet kan betekenen — dit vooraf scherp, anders bouwen we een leugen.**

De signaalvensters zitten in de méting (`venster_minuten`: momentopname, 60 min of 24 uur) en worden bij het meten meegestempeld. Een periodekeuze kan de meting dus **niet herberekenen**. Wat wél kan, is de reeks snapshots over een langere periode tonen en daar eerlijke statistiek op doen.

**D1 — Periodekeuze `24 uur` / `7 dagen`** (standaard 7 dagen), naast het fondsfilter in dezelfde bedieningsrij. Bepaalt de lengte van de trendlijnen en de basis onder de periodesamenvatting.

**D2 — Periodesamenvatting per rij**, in de detaillaag: over de gekozen periode het aandeel metingen in orde, het aantal drempeloverschrijdingen, de langste aaneengesloten afwijking en het aantal metingen zonder geldige uitkomst. Dit is het antwoord op "doet de keten het goed over tijd" — de tweede gebruiksvraag naast "is er nú iets stuk".

**Drie harde grenzen op wat de samenvatting mag zeggen:**

| Grens | Waarom |
|---|---|
| De periodekeuze raakt de **ketenstatusbalk, de laatste stand en de status per rij niet** | Zelfde valkuil als bij het fondsfilter: een rustige maand mag een rode toestand van nu niet groen kleuren. De balk gaat over "nu", de samenvatting over "de periode" |
| **Nooit een percentiel over percentielen.** Voor `ai_latency_p95` en `ingest_doorlooptijd_p95` bestaat er geen geldige "p95 over 7 dagen" — je zou percentielen middelen | Toon in plaats daarvan de hoogste en de mediane snapshotwaarde, met het label "hoogste gemeten p95 in de periode". Hetzelfde geldt voor `tokenverbruik`: een trendpercentage is niet optelbaar |
| Onderdrukte en verouderde punten tellen als **onbekend**, niet als in orde | Anders levert een week met een stilgevallen cron een prachtige beschikbaarheidsscore |

**D3 — De leeslimiet is nu al een probleem, en de periodekeuze maakt het zichtbaar.**
*Feit, na te rekenen:* uptime schrijft 288 rijen per dag (elke 5 min, platformbreed); de vier kwartiersignalen 4 × 96 = 384 rijen per dag **per fonds**; de drie uursignalen 3 × 24 = 72 per dag per fonds. Bij één fonds is dat 744 rijen per dag — en `LEESLIMIET` staat op 4000 over een venster van 7 dagen. **Dat is 5,4 dagen, niet 7.** De trend is bij één fonds dus vermoedelijk al afgekapt; de comment in `monitoring-lees.ts` gaat uit van "vanaf twee fondsen" en dat klopt niet met de rekensom. Blok B en C voegen er nog drie signalen aan toe.

Los dit op in deze tranche, en kies bewust:
- **de leeslimiet verhogen** — simpel, maar de payload gaat mee naar de client (architectuurpunt 1);
- **twee queries** — één kleine voor de laatste stand per (signaal × fonds), één voor de trend, eventueel met minder kolommen;
- **de trend uitdunnen** — één punt per uur in plaats van elk meetpunt.

Wat de keuze ook wordt: de bestaande `trendAfgekapt`-melding blijft, en het dashboard toont hoeveel dagen de trend werkelijk dekt in plaats van de gevraagde periode.

### Niet

- **Geen 30 of 90 dagen in deze tranche.** Dat vraagt een dagaggregaat in de database (een view of een dagstaat-tabel); ruwe snapshots over 90 dagen zijn niet leesbaar binnen enige redelijke limiet. Dat is **datamodelimpact**: documentatiehaak vuurt, gates A–H verplicht. Eigen tranche, met de retentie van 180 dagen als bovengrens — een periode die verder terugkijkt dan de retentie mag niet aanklikbaar zijn, want dan toont hij stilzwijgend minder.
- **Geen vrije datumkeuze.** Twee vaste knoppen; een datumkiezer suggereert een precisie die de meetvensters niet hebben.
- **Geen export of rapportagefunctie** op de periodesamenvatting.
- **Geen nieuwe bronnen en geen wijziging aan de verwerkingsketen.** Blok C leest uitsluitend `document_processing_jobs` zoals die vandaag gevuld wordt. Raakt `ingest-orchestrator.ts` of `generiek-pipeline.ts` in het plan: **stop en leg terug** — dat is een andere tranche met een ander risicoprofiel.
- **Geen doorlooptijd per fase.** Zie het dekkingsvoorbehoud bij C3; dat vraagt een uniform schrijfmodel over beide paden en hoort niet in een monitoringtranche.
- **Geen signalen 8–13 en 15–19 uit FO §19.** Die staan als M3 in `VOORSTEL-MONITORING-HERONTWERP.md` §7.
- **Geen alerting.** Ongewijzigd uitgesteld; drempels blijven data zodat de alerting-tranche alleen een bestemming toevoegt.
- **Geen doorklik naar logregels.** Signaal 14 blijft een aantal (P6, gate B14-3, besluit `0106`).
- **Geen wijziging aan de meetdefinities** van de overige zeven signalen, aan de snapshot-cadans, aan de retentie of aan de suppressie.
- **Geen wijziging aan RLS, policies, grants of `SECURITY DEFINER`-functies.**
- **Geen chart-library.** `Trendlijn.tsx` wordt hergebruikt; een compacte variant is een prop, geen tweede component. Importeer **niet** uit `app/(dashboard)/` — de platform-surface leest niet uit de tenant-surface (eslint-boundary T9).
- **Geen aparte tabs per domein.** Dat versnippert opnieuw wat deze tranche juist samenvoegt.
- **Geen kostenweergave in euro's** bij tokenverbruik (vergt een prijs-per-token als configuratie; apart besluit).

---

## 3. Architectuur- en ontwerppunten die in Plan-modus beslist moeten worden

**1. Het filter is client-side, en dat is een auditbeslissing — niet alleen een UX-keuze.**
`page.tsx` is een server component achter `withPlatformRead`, die per aanroep een `attempt`- én een `result`-event in `platform_event_log` schrijft. Wordt het fondsfilter via `searchParams` geïmplementeerd, dan levert **elke filterklik een extra auditpaar** en een extra databaselezing. Dat vervuilt het auditspoor met weergavehandelingen en maakt signaal 14 luidruchtiger op precies de tabel die dat signaal bewaakt.

Voorstel om te bevestigen: **één server-side lezing, filteren en aggregeren in een client component.** Dat mag omdat de leeslaag de suppressie al toepast vóórdat de data de client bereikt (`maskeerTrendwaarde`, conform `core/lib/suppressie.ts`) en er geen individu-herleidbaar gegeven in de payload zit. Toets die aanname expliciet: loop de velden van `SignaalWeergave` na en bevestig dat er niets in zit dat op de server had moeten blijven.

Als de filterstatus deelbaar moet zijn, gebruik dan een client-side `history.replaceState`-hash — geen server-navigatie.

**2. De `effect` in het auditspoor verandert niet.** Vandaag gaat alleen `{signalen, snapshotrijen}` mee. De filterkeuze, de fondsnaam en de meetwaarden blijven er nadrukkelijk buiten. Bevestig dit in de terugkoppeling.

**3. De aggregatie hoort als pure functie in `monitoring-signalen.ts`, niet in een component.**
Zelfde argument als `maskeerTrendwaarde`: een waarborg die in één regel van een component leeft, is programmatisch niet na te rekenen. Lever minimaal:
- `aggregeerStatus(statussen: SignaalStatus[]): SignaalStatus` — slechtste wint, met de volgorde `rood > oranje > onbekend > groen`;
- `samenvattingPerDomein(...)` — telt afwijkend en onbekend apart.

**Harde regel, met een test die hem bewijst: er wordt nooit over waarden geaggregeerd, alleen over statussen.** Waarden optellen over fondsen omzeilt de n-drempel — twee fondsen met n=6 worden samen n=12 en dan is besluit `0055` via de aggregatie uitgehold, terwijl het dashboard blijft beweren dat de drempel geldt. De sanity moet dit als negatieve controle vastleggen.

**4. `onbekend` mag de aggregatie nooit groener maken.** Drie gevallen die alle drie fout kunnen gaan:
- een signaal dat nog **nooit** is gemeten (`leegSignaal`) moet meetellen in de ketenbalk, anders verdwijnt het uit de noemer en kleurt de balk groen op afwezigheid;
- bij `leesfout === true` is de ketenstatus **onbekend**, niet groen — er is dan geen enkele geldige meting;
- bij `trendAfgekapt === true` blijft de bestaande melding staan en telt hij mee als voorbehoud op de trends, niet op de laatste stand.

**5. Deterministische selectie en sortering.** Bij "alle fondsen" wordt per rij de slechtst scorende meting getoond. Bij gelijke status moet de keuze **deterministisch** zijn (bijvoorbeeld op fondsnaam), anders wisselt het getoonde fonds tussen renders. Hetzelfde geldt voor de sortering op ernst: gelijke ernst valt terug op `SIGNAAL_VOLGORDE`.

**6. De definitiebreuk bij `rate_limit_incidenten` moet benoemd worden.** Het signaal gaat van "alle rate-limit-gebeurtenissen" naar "alleen 429-responses". Historische snapshots dragen de oude definitie; de drempels zijn meegestempeld, de *definitie* niet. Omdat het dashboard een trend van zeven dagen toont, heelt de breuk zichzelf binnen een week. Leg de omschakeldatum vast in een decision-record en toon in de detaillaag geen trend over de breuk heen zonder markering. Beoordeel in Plan-modus of een `definitie_versie`-veld in `meta` de goedkoopste borging is.

**7. Toegankelijkheid van de nieuwe interactie.** In de mockup is de hele tabelrij klikbaar; dat is voor de bouw niet goed genoeg. Gebruik een echte `<button>` met `aria-expanded` en `aria-controls`, volledige toetsenbordbediening, en zorg dat de verdelingsindicator een tekstueel equivalent draagt (`3 in orde, 1 aandacht`). Kleur blijft nooit de enige drager (`0097`/`0101`), ook niet in de nieuwe verdelingsblokjes en niet in de domeintegels.

**8. Eigenaar en opvolgactie zijn input, geen bouwbeslissing.** Blok B kan niet worden afgerond zonder deze vier regels. Onderstaand concept is een **voorstel ter validatie door de opdrachtgever** — vul of corrigeer vóór de bouw; een verzonnen eigenaar is schijnzekerheid:

| Domein | Voorgestelde eigenaar | Voorgestelde opvolgactie bij rood |
|---|---|---|
| Beschikbaarheid | Platformbeheer | Componentuitsplitsing openen, storingsroute van de rode component volgen; bij >15 min impact incident vastleggen |
| Verwerking | Beheer documentketen | Controleren of de verwerkingsworker draait; bij aanhoudende achterstand handmatig herverwerken en het fonds informeren dat recente stukken nog niet vindbaar zijn |
| AI-kwaliteit | AI-beheer | Vaststellen of het aan curatie (geen actueel document) of aan retrieval/model ligt; bij curatie een actie richting het fonds |
| Beveiliging en audit | Platformbeheer en compliance | Elke waarneming afzonderlijk nagaan; bij fail-open of een auditgat incident vastleggen en beoordelen of melding nodig is |

**9. Geen nieuwe eenheidswaarde — de CHECK is de reden.**
`platform_signaal_config.eenheid` draagt een CHECK op vier waarden. Een waarde `minuten` toevoegen vraagt een `alter table … drop constraint … add constraint`, en dát is een **datamodelwijziging**: dan vuurt de documentatiehaak én worden de gates A–H verplicht. Voor twee tijdsduursignalen is dat een onevenredige prijs.

Voorstel om te bevestigen: **hergebruik `milliseconden` als opslageenheid en breid de formatter uit.** `formatteerWaarde()` schakelt nu al tussen ms en s; voeg minuten en uren toe (`45 min`, `2 u 10 min`). De opslag blijft numeriek en vergelijkbaar, de weergave wordt leesbaar, en er verandert niets aan het schema. Borg de formatter met sanity-tests op de grensgevallen (999 ms, 1 s, 90 s, 60 min, 125 min).

Blijkt bij de bouw dat dit niet werkbaar is: **stop en leg terug.** De impactklasse verschuift dan en dat is een scopebeslissing (§4).

**10. Minimum-n is iets anders dan de n-drempel — houd ze uit elkaar.**
De n-drempel uit besluit `0055` is een **privacy**maatregel bij signalen die op gebruikersgedrag leunen. C3 leunt op documenten, niet op bestuurders; `0055` is daar niet van toepassing en mag er ook niet op geplakt worden, want dat verwatert waar de drempel voor staat.

Wat C3 wél nodig heeft is een **betekenis**drempel: een p95 over drie documenten is de traagste van drie, geen percentiel. Voorstel: onder vijf afgeronde jobs geen waarde tonen, met de reden "te weinig waarnemingen voor een percentiel" — zichtbaar onderscheiden van "onderdrukt (n<10)". Gebruik hiervoor géén nieuw configveld als het met de bestaande `nDrempel` kan; wel moet de **reden** in de UI verschillen, anders leest een statistische beperking als een privacymaatregel. Beoordeel in Plan-modus wat de goedkoopste vorm is en leg de keuze vast.

**11. Welke klok meet C3.**
Leg de definitie expliciet vast, net als bij `duur_model_ms` in de vorige tranche: **`eind − aangemaakt`**, dus inclusief de wachttijd in de wachtrij. Dat is wat de gebruiker ervaart ("wanneer is mijn document doorzoekbaar"). `eind − start` (alleen rekentijd) zou de wachttijd juist wegpoetsen op het moment dat de wachtrij vol staat — precies de verkeerde kant op, en dezelfde fout als het meten van alleen de eindgeneratie bij de AI-latency. Zet de rekentijd desgewenst als tweede getal in `meta`, zodat de decompositie zichtbaar is.

Let op twee randgevallen die een p95 stil kunnen vervalsen: jobs met `eind` maar zonder `start`, en jobs met status `overgeslagen` (die zijn niet verwerkt en horen niet in de doorlooptijd). Filter beide expliciet — `Number(null) === 0` is de faalvorm die de vorige tranche al een keer heeft opgeleverd (`MONITORING-P5-ONTWERP.md` §13).

**12. De periodekeuze woont naast het fondsfilter, en om dezelfde reden client-side.**
Zelfde argument als architectuurpunt 1: een periodeknop mag geen server-navigatie en dus geen extra auditpaar opleveren. Consequentie: de langste periode wordt in één keer gelezen en de kortere periode is een filter op diezelfde data — niet een tweede query. Dat maakt de keuze bij D3 (leeslimiet) bepalend voor de payloadgrootte; weeg die twee samen, niet los.

**13. De periodesamenvatting is een pure functie, geen componentlogica.**
`vatPeriodeSamen(trend, config): { aandeelInOrde, overschrijdingen, langsteAfwijking, onbekend }` hoort in `monitoring-signalen.ts` naast de aggregatiefuncties, om dezelfde reden: de regel "onderdrukt en verouderd tellen als onbekend, niet als in orde" moet programmatisch na te rekenen zijn. Neem als negatieve controle een reeks waarin de helft van de punten gemaskeerd is en toets dat het aandeel-in-orde daar niet door omhoog gaat.

---

**Relevante bestanden / modules** — `app/(platform)/platform/(beveiligd)/monitoring/page.tsx` (server component: lezen + omhulsel), `.../monitoring/_components/` (nieuw: `Ketenstatus.tsx`, `SignaalTabel.tsx` als client component, `SignaalDetail.tsx`; bestaand: `Stoplicht.tsx` en `Trendlijn.tsx` hergebruiken), `platform/lib/monitoring-signalen.ts` (registryvelden + pure aggregatiefuncties), `platform/lib/monitoring-signalen.sanity.ts` (nieuwe tests), `platform/lib/monitoring-queries.ts` (blok B: `meetRateLimitIncidenten` splitsen; blok C: `leesJobs` uitbreiden met de tijdstempels, twee nieuwe meetfuncties, noemer in `meta` bij `meetEmbeddingFouten`), `platform/lib/monitoring-lees.ts` (naar verwachting **geen** wijziging — `leesfout` en `trendAfgekapt` worden al geleverd; bevestig dat), `supabase/seeds/schema/<datum>_p4b_signalen_seed.sql` (blok B + C: drie INSERT-regels). **Niet aanraken:** `platform/lib/ingest-orchestrator.ts` en `platform/lib/generiek-pipeline.ts` — blok C leest alleen. Claude Code verifieert tegen de werkelijke code.

**Guardrails (zie `CLAUDE.md`)** — bevestig naleving. Specifiek voor deze opdracht:

- **De zes waarborgen uit `VOORSTEL-MONITORING-HERONTWERP.md` §5 blijven intact.** Verouderd → grijs en nooit groen; leesfout onderscheiden van nooit-gemeten; kleur nooit enige drager; suppressie op drie plekken; meegestempelde drempels; aggregaat-first zonder doorklik. Loop ze bij oplevering één voor één na en rapporteer per waarborg hoe hij is geborgd.
- **Nooit aggregeren over waarden.** Zie architectuurpunt 3. Dit is een privacygrens, geen voorkeur.
- **Monitoring is geen auditgebeurtenis.** Geen extra logregels naar `governance_log`, `governance_events` of `platform_event_log`; het bestaande auditpad blijft ongewijzigd en het aantal auditparen per paginabezoek gaat **niet** omhoog (architectuurpunt 1).
- **Code-only velden blijven code-only.** `domein`, `betekenis`, `eigenaar`, `opvolgactie`, `dekkingsniveau`, `platformbreed` en `dekkingsvoorbehoud` worden door `combineerConfig()` genegeerd als ze uit de database komen. Test dit als negatieve controle.
- **`npm run lint:colors` en `npm run lint:boundaries` blijven groen.** Uitsluitend bestaande `ok`/`warn`/`err`/`accent`-tokens; geen losse hex- of `rgb()`-waarden uit de mockup overnemen; geen import uit `app/(dashboard)/`.
- **Registry en seed blijven in de pas.** Blok B raakt beide; wijzig ze in dezelfde commit en benoem in de terugkoppeling dat de sanity interne consistentie bewaakt en niet de gelijkheid met de seed (bekend restrisico uit `MONITORING-P5-ONTWERP.md` §11).
- **Migratie eerst, dán deploy** — ook bij een enkele INSERT.

**In te zetten subagents (zie `SUBAGENTS-ONTWERP.md` §4 trigger-matrix)** — `code-reviewer` (verplicht); `audit-evidence-reviewer` (verplicht: de opdracht raakt het aantal auditparen per paginabezoek en de inhoud van `effect`); `ontwerp-sync-reviewer` vóór merge. `supabase-rls-reviewer` **alleen bij blok B** en dan gericht op de vraag of de seed-INSERT werkelijk geen policy-, grant- of constraint-oppervlak raakt — luidt het antwoord "nee", dan is dat de review-uitkomst en geen reden voor een volledige RLS-analyse. `ai-governance-reviewer` niet nodig: de AI-prompt, de retrieval en wat de AI beslist blijven onaangeraakt.

**Werkmodus** — begin in **Plan-modus**: lever eerst een implementatieplan met de dertien punten uit §3, de bestandenlijst, de testaanpak en de risico's. Neem in het plan expliciet op: (a) de bevestiging dat `SignaalWeergave` volledig client-veilig is, (b) de vorm van de pure aggregatie- en samenvattingsfuncties, (c) de gekozen oplossing voor de leeslimiet mét de payloadgrootte die daaruit volgt, en (d) of A+D en B+C als één of als twee opleveringen gaan — A en D leveren samen de leesbaarheid, B en C samen de nieuwe signalen. **Wijzig pas na expliciet akkoord.**

---

## 4. Impactklasse — weging vastgelegd

*Het sjabloon vraagt de weging expliciet vast te leggen, ook als de uitkomst "klein" is.*

**Blok A — alleen UI-of-frontend.** Geen nieuwe tabel, geen kolom, geen policy, geen grant, geen `SECURITY DEFINER`, geen wijziging aan het tenant-datamodel. → Documentatiehaak vuurt **niet**; `HANDOVER.md` volstaat. Gates A–H **niet** vereist.

**Blok B en C — alleen UI-of-frontend + drie data-seeds.** Drie INSERT-regels in `platform_signaal_config` (`rate_limit_fail_open`, `ingest_stilstand`, `ingest_doorlooptijd_p95`). Dat is *data*, geen *datamodel*: er verandert niets aan schema, policies, grants of functies, en blok C leest uitsluitend uit een bestaande tabel. → Documentatiehaak vuurt **niet**. Gates A–H **niet** vereist.

**Blok D — alleen UI-of-frontend.** De periodekeuze filtert op data die al gelezen wordt; er komt geen tabel, geen view en geen RPC bij.

**Drie dingen kunnen deze weging omgooien**, en alle drie zijn in Plan-modus te herkennen:

1. een nieuwe waarde in de CHECK op `platform_signaal_config.eenheid` (architectuurpunt 9);
2. een nieuw configveld of een nieuwe kolom voor de betekenisdrempel van C3 (architectuurpunt 10);
3. een oplossing voor de leeslimiet (D3) die een **databaseobject** vraagt — een view, een RPC of een dagaggregaat in plaats van een andere query of een hogere limiet.

Gebeurt één van de drie, dan is het **datamodelimpact**: documentatiehaak vuurt, gates A–H worden verplicht en de weging hieronder klopt niet meer. Stop en leg terug.

**Drie dingen die desondanks wél gebeuren**, omdat "klein" geen vrijbrief is:

1. **`MONITORING-P5-ONTWERP.md` §5 (signaalset) en §8 (dashboard) worden bijgewerkt** — §8 beschrijft nu de kaartweergave die deze tranche vervangt, §5 telt elf signalen na deze tranche in plaats van acht. Ontwerp-sync-check daarna groen.
2. **Vier decision-records**: (a) de herdefinitie van `rate_limit_incidenten` plus de omschakeldatum, (b) de regel dat aggregatie over fondsen uitsluitend op statussen plaatsvindt, (c) de definitie van doorlooptijd als `eind − aangemaakt` inclusief wachttijd, met de reden waarom niet `eind − start`, en (d) de gekozen oplossing voor de leeslimiet plus de vastgestelde bovengrens van de periodekeuze. Per `release-template.md` landen die in `mvp/decisions/` **én** in `00 Overzicht en status/besluitenlog.md` **én** in `02 Architectuur/architectuurbesluiten.md` — alle drie.
3. **`05 Security en compliance/security-risicos-en-maatregelen.md`**: het detectiegat uit *Doel & context* (stilgevallen worker onzichtbaar onder tien wachtende documenten) wordt als gesloten genoteerd met de verwijzing naar `ingest_stilstand` — en niet stilzwijgend, want het bestond ongemerkt sinds de ingest-worker.

Twijfelt Claude Code bij de bouw of de haak alsnog vuurt (bijvoorbeeld omdat blok B toch een kolom nodig blijkt te hebben): **stop en leg de vraag terug.** De klasse is een scopebeslissing, geen bouwbeslissing.

---

## 5. Acceptatiecriteria

**Weergave en filter**

1. Bij vier actieve fondsen toont de pagina **acht signaalrijen** (negen na blok B), niet 29 kaarten. Aantoonbaar met een dataset van vier fondsen.
2. De ketenstatusbalk toont één statusuitspraak, het tijdstip van de laatste meting en vier domeintegels met per domein de slechtste status en het aantal afwijkende én onbekende metingen.
3. Het fondsfilter wijzigt de tabel maar **niet** de ketenstatusbalk; die blijft platformbreed en is als zodanig gelabeld.
4. Een filterklik veroorzaakt **geen extra rij in `platform_event_log`**. Aantoonbaar: tel de auditparen vóór en ná tien filterklikken op één paginabezoek.
5. De `effect`-payload van het paginabezoek bevat uitsluitend tellingen — geen fondsnaam, geen filterkeuze, geen meetwaarde.
6. Sortering op ernst is deterministisch: twee renders van dezelfde data geven dezelfde volgorde en hetzelfde getoonde fonds per rij.

**Waarborgen (regressie op wat er al was)**

7. Een kunstmatig stilgezette snapshot-job maakt de betrokken signalen grijs/onbekend, **niet groen** — zowel in de rij als in de domeintegel als in de ketenbalk.
8. Een signaal dat nog nooit is gemeten telt mee in de ketenbalk en verdwijnt niet uit de noemer.
9. Bij `leesfout === true` is de ketenstatus **onbekend**, niet groen, en staat de bestaande leesfoutmelding boven de balk.
10. Een meting onder de n-drempel toont "onderdrukt", plot geen trendpunt en spreekt geen waarde uit in het `aria-label`.
11. **Negatieve controle op de aggregatie**: er bestaat geen codepad dat waarden over fondsen optelt of middelt. Vastgelegd als sanity-test, niet alleen als codereview-opmerking.
12. **Negatieve controle op de code-only velden**: een `platform_signaal_config`-rij met een afwijkende `domein`, `eigenaar`, `opvolgactie` of `dekkingsniveau` wordt genegeerd; de code wint.

**Begrijpelijkheid**

13. Bij een signaal met `richting = lager_is_slechter` staat er "onder 99,5%" en niet "vanaf 99,5%". Vastgelegd als sanity-test op `beschrijfDrempels`.
14. Een rij met status `onbekend` toont geen meetwaarde als kerngetal, maar `—` met de reden.
15. Bij tokenverbruik staat naast het trendpercentage het absolute verbruik en het daggemiddelde van de basisperiode uit `meta`.
16. `meta.limietchecks_mislukt` is zichtbaar — na blok B als eigen signaalrij met eigen drempels (oranje ≥1, rood ≥2).
17. Elke rij toont in de detaillaag een betekenisregel, een eigenaar en een opvolgactie; geen enkel veld is leeg of gevuld met een placeholder.
18. Elke status draagt kleur **én** woord **én** vorm; de verdelingsindicator draagt een tekstueel equivalent.

**Doorvoer en doorlooptijd (blok C)**

19. Het faalpercentage toont zijn noemer: `3,4% — 2 van 58 verwerkte documenten (24 u)`. Bij nul afgeronde jobs staat er geen percentage maar de reden.
20. De wachtrij-rij toont naast de stand de doorvoer over 24 uur; de detaillaag splitst uit naar geslaagd / mislukt / overgeslagen en toont het aantal jobs met `retry_count > 0`.
21. **Het detectiegat is dicht**: met acht jobs die drie dagen op `wachtend` blijven staan, kleurt `ingest_stilstand` **rood** terwijl de wachtrij-rij groen blijft. Aantoonbaar met een dataset waarin de worker niet draait — dit is het criterium dat blok C rechtvaardigt.
22. Een lege wachtrij levert `ingest_stilstand` = **groen**, niet onbekend en niet grijs.
23. `ingest_doorlooptijd_p95` meet `eind − aangemaakt`, niet `eind − start`. Vastgelegd als sanity-test op een fixture met een lange wachttijd en korte rekentijd: de uitkomst volgt de wachttijd.
24. Jobs zonder `start`, jobs met status `overgeslagen` en `null`-tijdstempels tellen niet mee in de p95. Negatieve controle, geen codereview-opmerking.
25. Onder vijf afgeronde jobs toont `ingest_doorlooptijd_p95` geen waarde, met een reden die zichtbaar **verschilt** van de privacy-onderdrukking bij n<10.
26. De tijdsduurformatter geeft leesbare uitkomsten op de grenzen 999 ms, 1 s, 90 s, 60 min en 125 min, en de opslag blijft in milliseconden zonder wijziging aan de CHECK op `eenheid`.

**Periodekeuze (blok D)**

27. De periodekeuze (24 uur / 7 dagen) verandert de trendlijnen en de periodesamenvatting, en verandert **niet** de ketenstatusbalk, de laatste stand of de status per rij. Aantoonbaar: bij een rode huidige status blijft de rij rood, ongeacht de gekozen periode.
28. De periodesamenvatting toont over de gekozen periode: het aandeel metingen in orde, het aantal drempeloverschrijdingen, de langste aaneengesloten afwijking en het aantal metingen zonder geldige uitkomst.
29. Er wordt **geen percentiel over percentielen** getoond en geen gemiddelde over aggregaten. Voor `ai_latency_p95` en `ingest_doorlooptijd_p95` toont de samenvatting de hoogste en de mediane snapshotwaarde, expliciet gelabeld als "hoogste gemeten p95 in de periode" — niet als "p95 over de periode".
30. Bij een afgekapte leesquery toont het dashboard hoeveel dagen de trend werkelijk dekt, en niet de gevraagde periode. De bestaande `trendAfgekapt`-melding blijft leidend.

**Technisch**

31. `./node_modules/.bin/tsc --noEmit --skipLibCheck` exit 0.
32. `npm run sanity` groen — **lees de slotregel, niet alleen de exitcode**.
33. `npm run lint:colors` en `npm run lint:boundaries` groen.
34. `bash scripts/cross-tenant-ci.sh` groen (de tranche raakt geen RLS, maar de leeslaag van een platformtabel wél).

### Handmatige stappen bij oplevering (geen codetaak)

Alleen bij blok B, en in deze volgorde:

1. De seed-INSERT in de Supabase SQL-editor draaien (**eerst de migratie, dán de code-deploy** — anders schrijft de cron een signaal weg waarvoor geen configregel bestaat en draait het op de registry-fallback).
2. Deployen via GitHub Desktop.
3. Eén snapshot-run afwachten en controleren dat er rijen voor `rate_limit_fail_open` verschijnen.

Claude Code levert de migratie aan; het uitvoeren is een handeling van de initiatiefnemer. Benoem dit expliciet in de terugkoppeling, zodat het niet als "gedaan" wordt afgevinkt.

---

## 6. Definition of Done

*Volg `CLAUDE.md` §Definition of Done — daar staat de gezaghebbende lijst. Opdracht-specifieke invulling:*

- Functionaliteit volgens §5.
- **Ontwerpdoc**: `MONITORING-P5-ONTWERP.md` §8 bijgewerkt naar het driedelige dashboard; ontwerp-sync-check groen.
- **Decision-records**: herdefinitie `rate_limit_incidenten` + omschakeldatum; aggregatie uitsluitend op statussen. In `mvp/decisions/` én `besluitenlog.md` én `architectuurbesluiten.md`.
- **Tests**: de negatieve controles 11, 12 en 13 zijn sanity-tests, geen handmatige checks.
- **UX consistent met bestaande patronen** — de beheer-surface-opmaak en de bestaande tokens; geen eigen visuele taal uit de mockup overnemen.
- `HANDOVER.md` release-historie bijgewerkt.
- **Openstaande punten mét eigenaar** in `00 Overzicht en status/openstaande-punten-en-risicos.md`: de elf niet-gebouwde signalen uit FO §19 (M3), het ontbreken van alerting (M4), de ~28% dekking van `app_errors`, en het feit dat `voorbereiding` en `besluit-concept` geen `governance_log`-regel schrijven waardoor de drie AI-signalen structureel incompleet zijn. Deze vier bestonden al; deze tranche maakt ze zichtbaar en dat is geen belegging.

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md`. Rapporteer daarbij expliciet: (a) per waarborg uit §5 van het voorstel hoe hij is geborgd, (b) het aantal auditparen per paginabezoek vóór en na, en (c) of blok B in scope is gebleven.
