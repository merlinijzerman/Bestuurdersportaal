# Betrouwbare vraagrouter en aantoonbare documentdekking

**Versie:** 1.0
**Datum:** 17 augustus 2026
**Status:** geïmplementeerd achter fondsgerichte feature flags; Preview-validatie en productie-go/no-go open

## 1. Doel en functioneel gedrag

De AI-assistent maakt vóór retrieval een expliciet onderscheid tussen een gerichte vraag en een vraag die het hele geselecteerde document vereist. Het antwoord toont daarna wat technisch is verwerkt. Daardoor kan de assistent niet langer op basis van enkele relevante passages stellen dat iets in het volledige document ontbreekt.

Er zijn twee hoofdpaden:

1. **Gericht zoeken.** Voor een feit, vindplaats of beperkte uitleg zoekt de assistent de meest relevante passages. De UI zegt `Gericht gezocht`. Als iets niet is gevonden, is de vaste formulering: `Niet gevonden in de geselecteerde passages. Dit is geen uitspraak over het volledige document.`
2. **Volledige analyse.** Alleen bij één server-side gevalideerd geselecteerd of ondubbelzinnig genoemd document wordt de volledige technisch beschikbare documentversie geladen. Kleine documenten gaan in één modelcontext; grotere documenten via begrensde map/reduce. Alleen na aantoonbaar volledige verwerking mag een afwezigheidsclaim op documentniveau worden gedaan.

Een eerste gerichte beantwoording kan een zichtbare vervolgactie `Analyseer het volledige document` aanbieden. Die actie is geen vrije prompt: de server valideert gebruiker, fonds, gesprek, oorspronkelijke logregel en exact document opnieuw.

## 2. Gesloten routercontract

`Vraagroute` bevat uitsluitend gesloten waarden:

- `taak`: `feitopzoeking`, `uitleg`, `samenvatting`, `volledigheidstoets`, `aansluitingstoets`, `vergelijking`, `risicoanalyse`, `besluitrijpheid` of `onbekend`;
- `scope`: `geselecteerd_document`, `genoemd_document`, `agendapuntstukken`, `fondscollectie` of `fonds_plus_algemeen_kader`;
- `dekking`: `targeted`, `volledig_document` of `samengesteld`;
- `bewijsniveau`: `indicatief`, `onderbouwd` of `uitputtend`;
- `bron`: `deterministisch`, `model`, `veilige_terugval` of `expliciete_vervolgactie`.

De deterministische router is leidend en reproduceerbaar. Zonder gevalideerde documentscope kan hij nooit een volledige-documentroute activeren. Een optionele Haiku-router mag alleen uitkomsten in de ambiguïteitsband 0,55–0,79 verfijnen. Zijn output wordt opnieuw tegen het gesloten contract en de servergrenzen gevalideerd. Timeout, schemafout of providerfout valt veilig terug op de deterministische route.

Een genoemd document wordt alleen automatisch gekoppeld als de titel binnen de voor deze gebruiker onder RLS toegankelijke documentset exact één kandidaat oplevert. Geen of meerdere kandidaten betekent geen stille volledige analyse.

## 3. Dekkingsbewijs en taalgrens

`DocumentDekking` legt per beurt vast:

- modus `targeted`, `volledig` of `gedeeltelijk`;
- geselecteerde, verwerkte en—waar aantoonbaar—totale passages;
- verwerkte en totale batches;
- waar beschikbaar verwerkte/totale pagina’s en secties;
- afkapredenen (`chunk_cap`, `token_cap`, `batch_cap`, `batch_timeout`, `batch_fout` of `retrieval_fout`).

`uitputtend` is uitsluitend mogelijk als alle getelde passages en alle geplande batches zonder afkapreden zijn verwerkt. Een timeout, fout of cap maakt het resultaat code-gedreven `gedeeltelijk`; het model kan dat label niet opwaarderen. Bij gerichte of gedeeltelijke dekking verbiedt het systeem documentbrede afwezigheidsclaims.

## 4. Uitvoeringsgrenzen

| Onderdeel | Grens |
|---|---:|
| Volledig document in één context | maximaal 48.000 geschatte tokens |
| Map-batch | maximaal 16.000 geschatte tokens |
| Map-batches | maximaal 8 |
| Parallelle map-calls | 2 |
| Timeout per map-call | 20 seconden |
| Timeout totale map-fase | 60 seconden |
| Timeout eindgeneratie | 45 seconden |
| Vervolgaanbod preflight | maximaal 640 passages |
| Technische chunk-loader | maximaal 5.000 passages, met telling en paginering |
| Modelrouter | 2,5 seconden, maximaal 300 outputtokens |

De batchlimiet is een technische en kostenmatige begrenzing, geen garantie op een providerbedrag. Documenten boven de effectieve grens eindigen zichtbaar gedeeltelijk; de gebruiker krijgt geen schijnzekerheid.

## 5. Analyseplan

Brede toetsen worden vóór generatie opgesplitst in een gesloten analyseplan. De ondersteunde onderdelen zijn `effecten`, `compensatie`, `evenwichtigheid`, `opgebouwde_aanspraken`, `uitvoerbaarheid`, `risicos`, `besluitrijpheid`, `aansluiting_kader` en `volledigheid`. Alleen deze identifiers worden gelogd en in map/reduce geïnjecteerd. De modeltekst kan het plan niet stil uitbreiden.

## 6. Security, tenantgrens en human-in-the-loop

- Elke documentscope wordt server-side onder de sessie en bestaande RLS opnieuw opgelost; er is geen service-role-pad.
- Een vreemd-fonds of niet-toegankelijk document kan niet via een titel of vervolgactie worden geselecteerd.
- De vervolgactie accepteert geen client-antwoord als bewijs, maar verifieert de eerdere eigen `governance_log`- en inhoudsregel.
- De assistent analyseert en signaleert; hij neemt geen besluit en claimt geen juridische volledigheid.
- Het bestaande AI-toegangs-, limiet- en auditpad blijft leidend. De modelrouter loopt via dezelfde centrale AI-poort.

## 7. Audit en monitoring

Op basisniveau worden `vraagrouter`, `vraagrouter_uitvoering`, `analyseplan`, `documentdekking` en `volledige_analyse` geclassificeerd. Identiteiten van documenten en eerdere logregels zijn bronniveau; letterlijke vraag/antwoordtekst blijft in de inhoudslaag. De SQL-projectie gebruikt een allowlist en verwijdert bronidentiteiten op basisniveau.

Preview-acceptatie vergelijkt vóór en na minimaal:

- aandeel routes per taak/dekking/bron en model-fallbacks;
- gerichte versus volledige/gedeeltelijke antwoorden;
- retrieval-, router-, map- en totale duur voor zover in de runmetadata beschikbaar;
- model-/maptokens, batchaantallen en afkapredenen;
- fout- en timeoutpercentage;
- aantal aangeboden en uitgevoerde volledige analyses;
- menselijke RQ-01-beoordeling op alle vijf thema’s en onterechte afwezigheidsclaims.

Er is nog geen operationeel dashboard dat deze velden fondsbreed aggregeert. De Preview-meting en de aggregatiequery zijn daarom een harde productievoorwaarde, geen afgerond onderdeel van deze codewijziging.

## 8. Feature flags en gefaseerde uitrol

De flags zijn standaard en bij leesfouten uit:

1. `vraagrouter_v2` — deterministische router, dekkingscontract en UI-labels;
2. `volledige_analyse_vervolg` — zichtbare, server-gevalideerde vervolgactie;
3. `vraagrouter_model` — optionele modelverfijning; alleen werkzaam als `vraagrouter_v2` aanstaat.

Uitrol:

1. **Technische voorbereiding:** auditprojectiemigratie in Preview toepassen; structurele gates draaien; code met alle flags uit deployen.
2. **Preview A:** één synthetische/vrijgegeven fondsgerichte tenant, alleen `vraagrouter_v2=true`; RQ-01 vijfmaal uitvoeren en metrics vastleggen.
3. **Preview B:** na akkoord `volledige_analyse_vervolg=true`; gerichte beantwoording plus expliciete volledige vervolgactie testen, inclusief timeout/cap/foutscenario.
4. **Preview C:** `vraagrouter_model=true` alleen als de ambiguïteitsmeting aantoonbaar meerwaarde laat zien zonder slechtere scopekeuze.
5. **Productiecanary:** één fonds, eerst uitsluitend deterministische router; aparte menselijke go/no-go na 24–48 uur en vergelijking met de Preview-baseline.
6. **Verbreding:** fonds voor fonds; de modelrouter blijft optioneel en kan uit blijven.

Rollback begint altijd met de drie flags uitzetten. Daarna kan code worden teruggedraaid. De auditprojectiemigratie is additief en hoeft alleen terug als daar een afzonderlijke reden voor bestaat; daarvoor is een rollbackbestand aanwezig.

## 9. Acceptatiegrens voor productie

Geen productie-go zolang een van de volgende punten openstaat:

- RQ-01 is niet 5/5 inhoudelijk en qua route/dekking goedgekeurd;
- een gerichte run presenteert zich als documentvolledig of doet een onterechte documentbrede afwezigheidsclaim;
- tenant-/vervolgactie-tests of structurele databasegates zijn rood;
- timeout, foutpercentage, latency of tokengebruik heeft geen gemeten en geaccepteerde grens;
- auditmetadata is niet zichtbaar op het bedoelde autorisatieniveau;
- rollback via flags is niet in Preview gesmoked.

## 10. Bestanden en bewijs

De besliskern staat in `core/lib/vraagrouter.ts`, de bewijsgrens in `core/lib/document-dekking.ts`, de optionele providerschil in `core/lib/vraagrouter-model.ts` en de integratie in `app/api/chat/route.ts`. De AQLab-case RQ-01 en FIX-23 vormen de geanonimiseerde regressie. Besluit 0184 legt de architectuurafweging vast.

De uitvoerbare Preview-volgorde, de beheerbediening en het read-only
acceptatiebewijs staan in `VRAAGROUTER-DOCUMENTDEKKING-PREVIEW-RUNBOOK.md` en
`supabase/checks/2026_08_19_vraagrouter_preview_acceptatie.sql`.
