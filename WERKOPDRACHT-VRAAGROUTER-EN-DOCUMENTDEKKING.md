# Werkopdracht: betrouwbare vraagrouter en aantoonbare documentdekking

> Overdracht van productieanalyse op 17-08-2026. Plak deze werkopdracht als eerste bericht
> in een nieuwe Codex-/codesessie in de repo-root. Lees vóór uitvoering `HANDOVER.md`,
> `CLAUDE.md`, `WERKOPDRACHT-TEMPLATE.md` en de relevante decisions. Begin in
> Plan-modus en wijzig pas na expliciet akkoord.

---

## Doel en aanleiding

De AI-assistent herkent niet altijd goed **wat voor vraag** de gebruiker stelt en
**hoeveel van het bronmateriaal** nodig is om die vraag verantwoord te beantwoorden.
Daardoor kan een documentbrede vraag via de gerichte top-N-retrieval lopen en kan het
antwoord ten onrechte suggereren dat onderdelen niet in een document staan.

Productiewaarneming bij het geüploade Transitieplan van Stichting Pensioenfonds voor
Huisartsen:

- de assistent meldde dat alleen losse pagina's/fragmenten beschikbaar waren;
- de assistent stelde dat onder meer effectberekeningen, de
  evenwichtigheidsverantwoording en de omgang met opgebouwde aanspraken niet in de
  fragmenten stonden;
- het antwoord toonde tien genummerde bronchips;
- controle van de bron-PDF laat zien dat het document 43 PDF-pagina's heeft, waarvan
  42 pagina's tekst bevatten, en dat de genoemde onderwerpen **wel** in het document
  staan;
- de eerdere productie-indexatie van dit document leverde 203 chunks op.

De kern van het probleem is daarom niet primair extractie of indexatie, maar de keuze
tussen **gerichte passage-retrieval** en **volledige documentanalyse** en de manier waarop
het antwoord zijn dekkingsniveau formuleert.

## Geverifieerd vertrekpunt in de code

### 1. De breedteclassificatie is een smalle trefwoordheuristiek

`core/lib/vraagtype.ts` bepaalt met `BREED_PATRONEN` of een vraag `breed` of
`specifiek` is. De lijst herkent onder meer `samenvatt`, `beoordeel`, `overzicht`,
`welke risico`, `welke aandachtspunt` en `kernpunten`.

Relevante formuleringen ontbreken, waaronder:

- volledig / volledigheid;
- aansluitingstoets / sluit dit aan op;
- alle onderdelen / hele document;
- wat ontbreekt / ontbrekende onderdelen;
- toets aan / controleer tegen;
- is alles meegenomen / heb je alles gelezen;
- integrale analyse / dekkende beoordeling.

Default is `specifiek`. Niet-herkende documentbrede vragen vallen dus stil terug op
gerichte retrieval.

### 2. Volledige dekking is alleen bereikbaar bij een actieve documentscope

In `app/api/chat/route.ts` wordt `full_document` of `map_reduce` uitsluitend gekozen als:

1. een documentscope actief is; en
2. de vraag als `breed` is geclassificeerd, of de expliciete doorgrond-flow actief is.

Zonder actieve documentscope blijft ook een semantisch brede vraag in de gewone
bibliotheekroute.

### 3. De gewone route ziet hooguit een selectie

De huidige constante `CHUNK_BUDGET` is 10. Bij gerichte retrieval krijgt het
antwoordmodel dus een selectie van maximaal tien chunks, eventueel met parent-context,
niet het hele document. De tien bronchips in de productiewaarneming passen bij dit pad.

### 4. Het antwoordcontract maakt onvoldoende onderscheid tussen afwezig en niet gevonden

Bij top-N-retrieval kan alleen worden geconcludeerd dat iets **niet in de geselecteerde
passages is gevonden**. De conclusie dat iets **niet in het document staat** vereist een
volledige-documentroute of een aantoonbaar dekkende zoekstrategie. Dit onderscheid moet
technisch worden afgedwongen en in het auditspoor zichtbaar zijn.

---

## Goedgekeurde oplossingsrichting

Bouw geen vrije, autonome tussenagent. Breid de bestaande retrievalorkestratie uit met
een kleine, gecontroleerde **vraagrouter** die een gesloten, gestructureerd routebesluit
oplevert. Gebruik een hybride aanpak:

1. deterministische regels voor duidelijke gevallen;
2. alleen bij twijfel een lichte modelclassificatie met structured output;
3. server-side validatie en begrenzing van het routebesluit;
4. een aparte dekkings-/bewijscontrole vóór het antwoord;
5. querydecompositie voor samengestelde volledigheids- en aansluitingstoetsen.

De router mag uitsluitend kiezen uit vooraf gedefinieerde waarden, bijvoorbeeld:

```json
{
  "taak": "volledigheidstoets",
  "scope": "genoemd_document",
  "dekking": "volledig_document",
  "strategie": "map_reduce",
  "bewijsniveau": "uitputtend",
  "vertrouwen": 0.94,
  "signalen": ["aansluitingstoets", "volledig"]
}
```

Het modelbesluit is advies aan de applicatie, geen autorisatie. De applicatie valideert
scope, fonds, documenttoegang, toegestane strategie en kostenlimieten zelf.

## Scope

### M1 — expliciet en herbruikbaar routecontract

Definieer een pure, getypeerde route-uitkomst met minimaal deze assen:

- **taak**: feitopzoeking, uitleg, samenvatting, volledigheidstoets,
  aansluitingstoets, vergelijking, risicoanalyse, besluitrijpheid of onbekend;
- **scope**: geselecteerd document, genoemd document, agendapuntstukken,
  fondscollectie, fonds plus algemeen kader;
- **dekking**: targeted, volledig_document of samengesteld;
- **bewijsniveau**: indicatief, onderbouwd of uitputtend;
- **vertrouwen en signalen**: reproduceerbare verklaring van de routekeuze.

Leg dit contract op één plaats vast en gebruik het voor retrieval, promptkeuze,
voortgangsweergave en auditmetadata. Voeg geen tweede losstaand classificatiesysteem toe
naast `vraagtype.ts`; migreer of omhul de bestaande logica.

### M2 — deterministische herkenning uitbreiden

Breid de pure regels en meetset minimaal uit voor:

- volledig, volledigheid, integraal, gehele/hele document;
- toets, aansluitingstoets, controleer tegen, vergelijk alle onderdelen;
- wat ontbreekt, ontbrekende onderdelen, hiaten;
- alles meegenomen, alles gelezen, alle passages;
- per hoofdstuk, per criterium, per vereiste;
- samengestelde vragen met meerdere expliciete deelonderwerpen.

Neem tegenvoorbeelden op. `"Is de transitiedatum volledig verstreken?"` mag bijvoorbeeld
niet vanwege het woord `volledig` automatisch een volledige documentanalyse starten.
Patronen moeten dekkingsintentie herkennen, niet alleen losse woorden.

### M3 — documentscope veilig afleiden of expliciet bevestigen

De route moet een ondubbelzinnig document kunnen koppelen wanneer:

- de gebruiker vanuit `/ai?doc=<id>` komt;
- een document via de doorgrond-flow is gekozen;
- de gebruiker één unieke documenttitel noemt;
- de vraag ondubbelzinnig naar het zojuist geselecteerde/geüploade document verwijst.

Bij meerdere kandidaten of twijfel: niet gokken. Vraag de gebruiker welk document bedoeld
wordt of toon een expliciete scopekeuze. Tenant- en documenttoegang blijven server-side
onder RLS gevalideerd; een model mag nooit zelf een vrij document-id afdwingen.

### M4 — lichte modelrouter uitsluitend bij ambiguïteit

Ontwerp een korte modelcall die alleen vuurt wanneer de deterministische regels geen
voldoende zekere route leveren. Eisen:

- bestaand Anthropic-contract en bestaande verwerker; geen nieuwe leverancier;
- gesloten JSON-schema / structured output;
- `temperature: 0`, korte timeout en begrensde tokens;
- geen documentinhoud meesturen als vraag plus veilige metadata voldoende is;
- fail-safe terugval naar de veilige, deterministische route;
- geen vrije toolkeuze of autonome vervolgacties;
- route, vertrouwen, reden, model, latency en eventuele fallback in
  `retrieval_meta` vastleggen.

Meet eerst of de extra call werkelijk nodig is. Als een verbeterde deterministische
router de acceptatieset voldoende haalt, mag de modelrouter achter een featureflag
blijven of vervallen.

### M5 — querydecompositie voor samengestelde toetsen

Een volledigheids- of aansluitingstoets is geen gewone semantische zoekvraag. Splits zo'n
opdracht deterministisch of gecontroleerd op in toetsbare deelvragen, bijvoorbeeld:

1. transitie-effecten en effectberekeningen;
2. compensatie;
3. evenwichtigheidsverantwoording;
4. opgebouwde aanspraken en rechten;
5. uitvoerbaarheid en planning;
6. wettelijke of beleidsmatige vereisten uit het opgegeven toetsingskader.

De deelvragen vormen een expliciet analyseplan. Rapporteer per criterium: gevonden bewijs,
bronlocaties, ontbrekend bewijs en onzekerheid. Voeg pas daarna het eindantwoord samen.
Een generieke vaste lijst mag niet stil als juridisch compleet toetsingskader worden
gepresenteerd; het gebruikte kader moet benoemd en gelogd zijn.

### M6 — dekkings- en bewijscontrole

Voeg vóór de eindgeneratie een afdwingbaar dekkingscontract toe:

- `targeted`: nooit beweren dat iets niet in het hele document staat;
- `full_document`/`map_reduce`: registreer totaal aantal chunks, verwerkte chunks,
  pagina-/sectiedekking, batches en afkapping;
- bij afkapping of mislukte batch: antwoord zichtbaar als gedeeltelijk markeren;
- bij nul treffers in targeted-modus: formuleer `niet gevonden in de geselecteerde
  passages`, niet `staat niet in het document`;
- een uitputtende conclusie mag alleen als alle geplande delen aantoonbaar zijn verwerkt;
- bronverwijzingen moeten naar het juiste hoofddocument wijzen en mogen aanvullende
  kaders niet als onderdeel van dat document presenteren.

Maak deze regels zoveel mogelijk codegedreven. Alleen een promptinstructie is
onvoldoende.

### M7 — gerichte vervolgvraag na een beperkte route

Wanneer de eerste beantwoording via `targeted` liep, moet de applicatie waar relevant
een gerichte vervolgstap kunnen aanbieden:

> Dit antwoord is gebaseerd op 10 geselecteerde passages, niet op het volledige
> document. Wilt u dat ik het hele document analyseer?

Met een duidelijke actie, bijvoorbeeld `Volledige analyse uitvoeren`.

Toon dit aanbod alleen als:

- één concreet, toegankelijk document geselecteerd of ondubbelzinnig herkend is;
- de feitelijke eerste route `targeted` was;
- de vraag mogelijk bredere dekking vraagt, het antwoord een dekkingsbeperking noemt,
  of het antwoord meldt dat relevante informatie niet is gevonden;
- volledige verwerking technisch binnen de ingestelde limieten mogelijk is.

Toon het niet standaard na eenvoudige feitvragen zoals `Wat is de transitiedatum?`.
Voorkom zo interface-ruis, onnodige kosten en volledige analyses zonder duidelijke
gebruikersbehoefte.

De actie mag niet als een gewone chatbeurt met alleen `ja` worden afgehandeld. Stuur een
gestructureerde vervolgactie met minimaal:

```json
{
  "vervolgactie": "volledige_documentanalyse",
  "document_id": "<server-side gevalideerd document-id>",
  "oorspronkelijke_vraag": "<de eerdere gebruikersvraag>",
  "oorspronkelijke_audit_id": "<id van de beperkte beantwoording>",
  "strategie": "map_reduce"
}
```

De server valideert het document opnieuw onder de actuele sessie en fondscontext,
hergebruikt de oorspronkelijke vraag, zet het document expliciet als hoofddocument en
dwingt `full_document` of `map_reduce` af. De router hoeft de intentie dus niet opnieuw
uit een kort antwoord als `ja` af te leiden. Het resultaat is een nieuwe, herkenbare
**volledige heranalyse**, gekoppeld aan de oorspronkelijke beperkte beantwoording.

Als het document te groot is, de kostenlimiet wordt geraakt of niet alle batches slagen,
meld dit vóór of in het resultaat expliciet en presenteer het antwoord niet als volledig.

### M8 — transparantie in de gebruikersinterface

Toon compact welke aanpak is gebruikt, bijvoorbeeld:

- `Gerichte zoekactie · 10 passages geselecteerd`;
- `Volledige documentanalyse · 203 van 203 passages verwerkt`;
- `Gedeeltelijke analyse · 6 van 8 batches verwerkt`.

Gebruik voor de vervolgactie uit M7 hetzelfde bestaande interactiepatroon als andere
vervolgacties/chips. Maak vóór uitvoering herkenbaar dat dit langer kan duren en meer
AI-verbruik veroorzaakt, zonder technische modelnamen in de gewone gebruikersinterface.

### M9 — audit, monitoring en kosten

Breid `retrieval_meta` uit met het routebesluit zonder bestaande velden te verwijderen:

- routerversie en gekozen route;
- deterministische signalen;
- modelrouter toegepast ja/nee, model en vertrouwen;
- gevraagde en feitelijke scope;
- dekkingsniveau en verwerkingsgraad;
- decompositie/deelvragen;
- aangeboden en gekozen vervolgactie, plus koppeling met de oorspronkelijke auditregel;
- afkapping, timeouts en fallbackreden;
- router-, retrieval-, map- en totale latency;
- tokengebruik per fase.

Voeg signalen toe voor verkeerde of kostbare routing: aandeel modelrouter, aandeel
map-reduce, gedeeltelijke analyses, nul-treffer-targeted-antwoorden en routefallbacks.

## Niet in scope

- Een autonome multi-agentarchitectuur met vrije taakdelegatie.
- Een nieuwe AI-, zoek- of documentverwerker in de keten.
- Een vector database buiten Supabase.
- Het verhogen van `CHUNK_BUDGET` als zelfstandige oplossing; dat vergroot kosten en
  context zonder volledige dekking te garanderen.
- Een inhoudelijk juridisch oordeel over het Transitieplan.
- De bestaande fonds-/tenantgrenzen, RLS of bronstatuspoorten versoepelen.
- Stilzwijgend elke brede vraag via map-reduce sturen; kosten en wachttijd moeten bewust
  worden begrensd.

## Besluitpunten voor de planfase

Leg vóór implementatie ter akkoord voor:

1. het exacte routecontract en de toegestane waarden;
2. de patroonlijst plus positieve en negatieve meetset;
3. de onzekerheidsdrempel waarbij de modelrouter vuurt;
4. hoe een genoemd document ondubbelzinnig wordt opgelost;
5. maximale batches, tokens, timeout en kosten per volledige analyse;
6. het precieze afwezigheids-/dekkingscontract voor antwoorden;
7. de exacte voorwaarden waaronder de vervolgactie uit M7 verschijnt;
8. welke UI-indicatie en eventuele gebruikersbevestiging nodig is;
9. featureflags en rollbackpad.

## Acceptatiecriteria

1. Een expliciet geselecteerd Transitieplan plus `Is dit plan volledig en welke
   onderdelen ontbreken?` kiest aantoonbaar `map_reduce` of een equivalente volledige
   documentstrategie.
2. `Doe een aansluitingstoets op dit hele document` wordt als samengestelde,
   uitputtende taak herkend en levert een gelogd analyseplan met deelvragen.
3. `Wat is de transitiedatum?` blijft targeted en veroorzaakt geen onnodige volledige
   analyse.
4. `Wat staat er over evenwichtigheid?` blijft targeted, tenzij de gebruiker expliciet
   volledige dekking vraagt.
5. Een gewone chatvraag die `het Transitieplan` noemt, koppelt alleen automatisch als
   exact één toegankelijk document daarmee overeenkomt; anders volgt een scopevraag.
6. Zonder actieve/afgeleide documentscope wordt nooit stil beweerd dat informatie in
   het hele document ontbreekt.
7. In targeted-modus wordt afwezigheid geformuleerd als `niet gevonden in de
   geselecteerde passages`.
8. In volledige modus toont het auditspoor dat alle chunks/batches zijn verwerkt; een
   afgekapt pad wordt zichtbaar als gedeeltelijk antwoord teruggegeven.
9. Na een beperkte, mogelijk documentbrede beantwoording over één concreet document
   verschijnt de actie `Volledige analyse uitvoeren` met een correcte dekkingsmelding.
10. Na een eenvoudige feitvraag zoals `Wat is de transitiedatum?` verschijnt deze actie
    niet.
11. De vervolgactie verstuurt een gestructureerde opdracht, valideert document en fonds
    opnieuw op de server en hergebruikt de oorspronkelijke vraag; een losse chatbeurt
    `ja` wordt niet gebruikt om de route opnieuw te laten raden.
12. De volledige heranalyse is in het auditspoor gekoppeld aan de oorspronkelijke
    beperkte beantwoording en registreert de feitelijke documentdekking.
13. De Transitieplan-regressietest vindt aantoonbaar passages over effectberekeningen,
   evenwichtigheid en opgebouwde aanspraken en noemt die niet langer ten onrechte
   afwezig.
14. Minimaal 50 gelabelde routevragen met brede, specifieke, samengestelde en ambigue
    gevallen behalen de vooraf vastgestelde classificatiedoelen; rapporteer ook de
    verwarringsmatrix, niet alleen een totaalpercentage.
15. De modelrouter is niet actief bij duidelijke deterministische gevallen en valt bij
    timeout/schemafout veilig terug.
16. Routekeuzes zijn reproduceerbaar: dezelfde invoer en scope leveren tien keer
    dezelfde route-uitkomst op.
17. RLS-/cross-tenant-tests tonen dat scopeafleiding geen document van een ander fonds
    kan selecteren of lekken.
18. Bestaande specifieke documentvragen, agendapuntvragen, doorgrond-flow en
    bronverwijzingen blijven groen.
19. Rapporteer vóór/na voor tijd-tot-eerste-token, totale doorlooptijd, input-/outputtokens
    en geschatte kosten voor targeted, router-bij-twijfel en volledige map-reduce.
20. `tsc --noEmit --skipLibCheck`, relevante sanity-suites en de volledige bestaande
    regressiesuite zijn groen.

## Verwachte relevante bestanden

Verifieer dit in Plan-modus tegen de actuele code:

- `core/lib/vraagtype.ts` — bestaande vraagtype- en intentieheuristiek;
- `core/lib/vraagtype.sanity.ts` — pure routertests;
- `app/api/chat/route.ts` — scope- en strategiekeuze, promptopbouw en audit;
- `core/lib/rag.ts` — retrievalmetadata en documentchunks;
- `core/lib/doorgrond.ts` — bestaande expliciete documentanalyse;
- `core/lib/audit-meta.ts` en sanitytest — classificatie van nieuwe metavelden;
- AI-assistentcomponenten voor de route-/dekkingsindicatie;
- `ai-quality-lab/` — gelabelde regressieset en meting;
- relevante ontwerpdocumenten, `HANDOVER.md` en een nieuwe `decisions/`-entry.

## Impactklasse en guardrails

**Impactklasse: architectuur en AI-governance.** De wijziging bepaalt welke broninhoud
onder een bestuurlijk antwoord ligt en wanneer een conclusie als volledig mag worden
gepresenteerd. Er wordt geen datamodelwijziging verwacht. Blijkt een migratie nodig, leg
die afwijking en de structurele-gate-aanpak eerst ter akkoord voor.

Bijzondere guardrails:

- fonds- en documenttoegang altijd server-side onder RLS valideren;
- documentstatus en bronherkomst herkenbaar houden;
- geen volledige of juridische conclusie zonder aantoonbare dekking;
- promptwijzigingen beperkt en expliciet reviewbaar houden;
- alle modelcalls met timeout, kostenlimiet en deterministische instellingen;
- auditinhoud volgens de bestaande scheiding tussen basis-, bron- en inhoudsniveau;
- geen nieuwe externe verwerker of leverancier.

## Werkmodus en Definition of Done

Begin in **Plan-modus**. Lever eerst de negen besluitpunten, een code-impactanalyse, de
baseline van de Transitieplan-casus, de meetset en een kosten-/latentie-inschatting.
**Wijzig pas na expliciet akkoord.**

Volg verder `CLAUDE.md` §Definition of Done. Opdrachtspecifiek:

- leg het route- en dekkingscontract vast in een ontwerpdocument;
- voeg een decision-record toe voor de hybride vraagrouter en bewijsgrens;
- voeg de Transitieplan-casus geanonimiseerd toe aan de regressieset;
- actualiseer `HANDOVER.md` en, omdat de documentatiehaak vuurt, de relevante
  `00–09` as-built-documentatie en pas daarna de marker in
  `00 Overzicht en status/doc-actualisatie-log.md`;
- registreer restrisico's met eigenaar in
  `00 Overzicht en status/openstaande-punten-en-risicos.md`;
- lever een expliciet release-/rollbackadvies voor Preview en vervolgens Productie.

## Terugkoppeling

Rapporteer: samenvatting, gekozen routecontract, aangepaste bestanden,
RLS/security-impact, audit-impact, datamodel/migratie-impact, test- en meetresultaten,
kosten-/latentie-effect, Preview-acceptatie, productiebesluit en openstaande risico's.
