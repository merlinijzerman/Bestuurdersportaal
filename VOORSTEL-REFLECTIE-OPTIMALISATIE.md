# Voorstel — optimalisatie reflectiefunctie (Human in the Loop)

**Status:** voorstel ter besluitvorming — nog geen code
**Datum:** 12 augustus 2026
**Basis:** de werkende implementatie (plateau B, live 05-08-2026), ontwerp v1.0 §9, besluiten 0108–0113, 0121, 0123, 0126
**Scope-grens:** volledig binnen de bestaande reflectiefunctie. Geen documentvergelijking, geen dossierconsistentie, geen nieuwe platformmodules.

---

## A. Kritische beoordeling van de huidige functie

### Wat sterk is en onaangeroerd moet blijven

1. **De privacyarchitectuur is afdwingbaar, niet declaratief.** Geen reflectiemarkering in `modus`, `retrieval_meta`, auditspoor of enige fondsbrede projectie; de flowstatus is auteur-only en verdwijnt met het gesprek; een fail-closed allowlist laat een sanitytest falen zodra iemand er een veld bij zet. Dit is het beste onderdeel van het ontwerp en is de reden dat de functie überhaupt uitlegbaar is aan een bestuur.
2. **De toestandsmachine is server-controlled.** De client stuurt een *actie*, nooit een eindstatus; de RPC leest de status opnieuw uit en valideert daartegen. Vijf misbruikpogingen zijn als SQL-check tegen de doeldatabase gedraaid.
3. **Geen retrieval tijdens reflectie.** Strenger dan het oorspronkelijke ontwerp: er is geen pad dat de bevroren bronset kan omzeilen, omdat er geen pad loopt. Persoonlijke twijfel wordt nooit een zoekquery.
4. **De non-directiviteit is tekstueel scherp vastgelegd** en met een hash gepind. Het onderscheid spiegelen-versus-diagnosticeren staat als voorbeeldpaar in de code.
5. **De labelhygiëne.** "Niet opslaan", "Niets bewaren", "Alleen voor mij bewaren" en "Verwijderen" zijn programmatisch verboden omdat ze zouden liegen over waar de dialoog staat.

### Wat eenvoudiger kan

6. **Acht ingangen is een taxonomie, geen uitnodiging.** De set vraagt de bestuurder om zijn eigen aarzeling te classificeren vóórdat hij hem heeft verwoord — precies de volgorde die niet werkt. Bovendien overlappen ze: "ik twijfel aan de onderbouwing" en "ik mis informatie" zijn in de praktijk vaak hetzelfde moment.
7. **De flow stuurt feitelijk naar drie vragen.** Ontwerpmatig "één tot drie", in de code alleen bereikbaar via het beurtplafond. Zie H-2 hieronder.
8. **De besluitmoment-variant van de openingsvraag is dode code.**

### Waar UX- of governancerisico zit

| # | Risico | Ernst |
|---|---|---|
| H-1 | **"Aanpassen" verwijst naar de normale invoerbalk, en een beurt daar beëindigt de reflectie.** De knop breekt zijn belofte op het gevoeligste moment: de bestuurder ziet een concept van zijn eigen twijfel, wil het bijstellen, en verliest de context | Hoog — beloftebreuk |
| H-2 | **De conceptweergave is alleen bereikbaar bij het beurtplafond.** Het model heeft geen manier om "ik heb genoeg" te signaleren; "Reflectie afronden" stuurt `afbreken` (dus zónder concept). Netto: drie keer doorvragen, of geen opbrengst | Hoog — voelt als intake |
| H-3 | **De proactieve uitnodiging hangt aan `antwoordmodus = sparring`**, een brede en vaak geraakte modus. Dit is de meest waarschijnlijke oorzaak van "verschijnt te vaak" | Middel |
| H-4 | **Er is geen enkele meting, per ontwerp.** Elke verkeerde aanname blijft onopgemerkt tot iemand het zegt | Structureel |
| H-5 | **Het toetsrecord van de verplichte gebruikerstoets ontbreekt (OP-B1).** De labels en triggers die we nu willen wijzigen zijn precies de werkhypothesen die die toets had moeten valideren | Hoog — governance |

---

## A-bis. Het punt dat de rest bepaalt: adaptieve verdieping is inhoudsclassificatie

Dit moet expliciet op tafel voordat we iets bouwen.

De huidige functie kent **één harde architecturale belofte** die verder gaat dan privacy:

> Er wordt nooit op inhoud geclassificeerd — niet met een regex, niet met een model, niet met een heuristiek. Wat de gebruiker in dít veld typt is per definitie een reflectieantwoord. Een classificatie op inhoud zou betekenen dat het systeem beoordeelt of iemands zin "twijfel genoeg" is. Dat is precies het oordeel dat deze functie niet mag vellen.

Een reflectieplanner die uit de woorden van de bestuurder een *richting* afleidt om de volgende vraag te kiezen, **is** een classificatie op inhoud. Punt 2 en 3 van het feedbackvoorstel zijn dus niet louter een verfijning: het is een **herziening van een vastgesteld ontwerpprincipe**, en die hoort als zodanig te worden vastgelegd — anders staat er over een half jaar een principe in de code dat de code zelf niet meer waarmaakt.

Dat is geen reden om het niet te doen. Het is wél reden om precies te bepalen wat we opgeven en wat we terugkrijgen.

**Wat we opgeven:** determinisme. Twee bestuurders met dezelfde woorden kunnen een andere vraag krijgen. En omdat er geen telemetrie is, merkt niemand het als de vraagkeuze systematisch de plank misslaat.

**Wat we behouden — en waar ik het voorstel op aanscherp:**

| Guardrail | Invulling |
|---|---|
| De classificatie **poort niets af** | Elke richting leidt tot exact dezelfde volgende stap. Er is geen pad dat "te vaag" of "niet genoeg twijfel" oplevert |
| De classificatie **wordt nergens opgeslagen** | Niet in `gesprek_reflectie_state`, niet in `retrieval_meta`, nergens. Ze leeft alleen binnen één request |
| De classificatie **wordt nooit als conclusie getoond** | De vraag mag nooit zeggen wat de twijfel ís; hoogstens twee richtingen aanbieden mét uitweg |
| De vraag **kent een verplichte uitweg** | "…of zit dat ergens anders?" is een vormeis, geen stijlkeuze — machinaal getoetst |
| De **deterministische vraag blijft de vloer** | Faalt de generatie of de validatie, dan valt de functie terug op de vaste vraag per ingang. De huidige garantie is daarmee het minimum, niet het maximum |
| De vraag **wordt niet gestreamd** | Een verdiepingsvraag is twee zinnen. Genereren → valideren → tonen. Zo is de guardrail preventief in plaats van cosmetisch |

Die zes samen maken het verschil tussen "het systeem duidt uw twijfel" en "het systeem biedt u twee ingangen aan en laat de deur open". Ik adviseer ze alle zes als niet-onderhandelbaar bij dit onderdeel.

---

## B. Nieuwe compacte ingang — **vier**

### Definitief voorstel

*Besluit opdrachtgever 12-08-2026: "Ik zie een risico" gaat als vierde ingang mee, met de mogelijkheid hem later te verwijderen. Mijn oorspronkelijke advies was drie; de afweging staat hieronder volledig, inclusief waarom deze keuze goed verdedigbaar is.*

| # | Sleutel | Label | Subtekst (één regel, onder het label) |
|---|---|---|---|
| 1 | `mis_iets` | **Ik mis iets** | Informatie, onderbouwing, een perspectief of een alternatief dat u hier niet terugziet |
| 2 | `twijfel` | **Ik twijfel** | Aan de redenering, de aannames, de evenwichtigheid — of aan iets dat u nog niet kunt plaatsen |
| 3 | `risico` | **Ik zie een risico** | Een gevolg, een afhankelijkheid of een uitkomst die u zorgen baart |
| 4 | `overtuigt` | **Dit overtuigt mij** | U wilt vastleggen wat uw vertrouwen hier draagt |

Volgorde bewust: drie varianten van "hier klopt iets nog niet", en daarna de positieve. Zo is met één blik zichtbaar dat de functie niet alleen voor bezwaar is.

### De afweging bij de vierde ingang

**Wat ervoor pleit — en dit is het sterkste argument:** "ik zie een risico" is psychologisch géén twijfel. Wie een concreet risico ziet, twijfelt niet — die constateert iets. Voor die bestuurder is "Ik twijfel" een onterecht relativerend label ("ik twijfel niet, ik zie dit gewoon"), en een verkeerd label op het startmoment is duurder dan een knop te veel. Risico is bovendien in pensioenbestuur de meest voorkomende vorm van bestuurlijke aarzeling; hem wegstoppen onder een verzamelknop maakt de vaakst gebruikte route de minst herkenbare.

**Wat ertegen pleit:** overlap. Een deel van wat bestuurders als risico benoemen, komt in de praktijk als twijfel binnen en omgekeerd. Vier knoppen waarvan er twee dicht tegen elkaar aan liggen, kan de aarzeling terugbrengen die de acht ingangen veroorzaakte.

**Waarom nu-erbij de betere volgorde is dan later-toevoegen.** Dit is het argument dat mij overtuigt van de keuze. Met vier ingangen kan de gebruikerstoets *waarnemen* of de vierde zijn plaats verdient: wordt hij gebruikt, en aarzelt iemand zichtbaar tussen twee knoppen? Met drie ingangen kun je alleen vaststellen dat iemand hem miste — en dat is veel moeilijker te zien, want mensen passen zich stil aan en kiezen dan maar "Ik twijfel". **Afwezigheid van een knop laat geen sporen na; aanwezigheid wel.** Voor een functie die per ontwerp geen telemetrie heeft, is dat een reëel voordeel.

### Voorwaarde: leg het verwijdercriterium nu vast

"Eventueel later weghalen" wordt alleen echt als nu is opgeschreven wanneer dat gebeurt. Anders blijft de knop staan omdat niemand het aandurft hem weg te halen — het patroon dat OP-C1 in deze repo al eens heeft opgeleverd.

**Voorstel:** verwijderen wanneer bij de gebruikerstoets **beide** onderstaande zich voordoen:

1. deelnemers aarzelen zichtbaar tussen "Ik twijfel" en "Ik zie een risico", of kiezen wisselend voor hetzelfde soort inbreng; **én**
2. de verdiepingsvraag die volgt is in beide gevallen inhoudelijk dezelfde — de ingang maakt dan geen verschil dat de bestuurder merkt.

Voldoet slechts één van beide, dan blijft hij staan. **Beslis dit bij de toets**, niet later: verwijderen ná ingebruikname kost opnieuw een migratie met datamapping, en een ingang die maanden in productie heeft gestaan haal je in de praktijk niet meer weg.

### Herkomst: waar gaan de acht heen?

| Huidige ingang | Nieuwe smaak | Blijft bestaan als |
|---|---|---|
| Ik mis informatie | `mis_iets` | verdiepingsrichting *informatie* |
| Ik mis een serieus alternatief | `mis_iets` | verdiepingsrichting *alternatief* |
| Ik twijfel aan de onderbouwing | `twijfel` (of `mis_iets` bij ontbrekend bewijs) | verdiepingsrichting *onderbouwing / aannames* |
| **Ik zie een uitvoeringsrisico** | **`risico`** | verdiepingsrichting *uitvoerbaarheid / afhankelijkheid* |
| Ik twijfel aan de evenwichtigheid | `twijfel` | verdiepingsrichting *evenwichtigheid* |
| Ik vind dit moeilijk uitlegbaar | `twijfel` | verdiepingsrichting *uitlegbaarheid* |
| Er klopt iets niet, maar ik kan het nog niet plaatsen | `twijfel` | verdiepingsrichting *niet-pluis*, inclusief de pre-mortemvraag |
| Ik wil vastleggen wat mij juist overtuigt | `overtuigt` | eigen ingang |

### Nuances die we niet mogen verliezen

1. **Uitlegbaarheid is bestuurlijk iets anders dan twijfel.** "Kan ik dit uitleggen aan deelnemers, aan het verantwoordingsorgaan, aan de toezichthouder?" is een zelfstandige toets. Die moet als verdiepingsrichting expliciet aanwezig blijven en actief worden aangeboden — anders verdwijnt hij feitelijk.
2. **Het niet-pluisgevoel moet een legitiem antwoord blijven.** De drie open vragen daarbij, inclusief de pre-mortem ("stel dat dit over twee jaar verkeerd is uitgepakt — wat was dan waarschijnlijk de oorzaak?"), zijn het inhoudelijk sterkste onderdeel van de huidige functie. Behouden als richting.
3. **Evenwichtigheid / belangenafweging** is in pensioenland geen detail. Behouden als richting, met de bestaande formulering ("welke groep of welk belang krijgt mogelijk onvoldoende gewicht?").
4. **Overtuiging als zelfstandige, zichtbare ingang.** Niet wegstoppen onder een verzamelknop: de functie is niet alleen voor twijfel, en dat moet je aan de kaart kunnen zien.
5. **Een verkeerd gekozen ingang mag niets kosten.** Zeg dat in de interface, en zorg dat de eerste vraag altijd een uitweg biedt.

### Iconografie en UX-richting

**Advies: geen iconen.** Iconen voor abstracte mentale toestanden (missen / twijfelen / overtuigd zijn) zijn onvermijdelijk interpretatief, en ze maken een kaart zwaarder die volgens haar eigen ontwerpprincipe *niet mag duwen*. Concreet: een uitroepteken of waarschuwingsdriehoek bij "Ik twijfel" dramatiseert, en een vinkje bij "Dit overtuigt mij" leest als goedkeuring — precies de betekenis die FR-22 ontkent.

In plaats daarvan:

- **Vier brede knoppen onder elkaar** in plaats van pills naast elkaar, elk met de labelregel in normale tekstkleur en de subtekst eronder in `text-muted`. De subtekst doet het werk dat een icoon zou moeten doen, en doet het preciezer. Bij vier ingangen is die subtekst geen luxe maar noodzaak: hij is de plek waar het onderscheid tussen "Ik twijfel" en "Ik zie een risico" zichtbaar wordt.
- Bestaande kaartstijl ongewijzigd: geen kleuraccent, geen badge, `role="group"`, geen focusroof.
- Onder de drie knoppen ongewijzigd: `Geen aanvullende reflectie` en de privacybelofte.
- Eén nieuwe regel, klein: *"Een andere ingang kiezen kan altijd — u zit nergens aan vast."*

---

## C. Nieuwe gebruikersflow

```
AI-antwoord
   │
   ├─ rustige actie "Reflecteer op dit antwoord"      (altijd)
   └─ proactieve uitnodiging                          (alleen na besluitrijpheidsanalyse)
   │
   ▼
Kaart: "Wilt u nog iets toetsen voordat u uw oordeel vormt?"
   → [Ik mis iets] [Ik twijfel] [Ik zie een risico]      → keuze wordt gewoon gebruikersbericht
     [Dit overtuigt mij]
   │
   ▼
ÉÉN verdiepingsvraag                                   ← gekozen binnen guardrails, gevalideerd,
   │                                                      met deterministische terugval
   ▼
Antwoord in het gelabelde reflectieveld
   │
   ▼
CONCEPTWEERGAVE                                        ← direct, niet pas na drie vragen
   │
   ├─ [Klopt]                            → afgerond
   ├─ [Aanpassen]                        → herformuleren in hetzélfde reflectieveld → nieuw concept
   ├─ [Nog een stap verdiepen]           → één extra vraag (max 3 antwoorden totaal)
   ├─ [Wat pleit er tegen?]  (optioneel) → tegenperspectiefvraag, telt als verdiepingsbeurt
   └─ [Afronden zonder aparte notitie]   → afgerond
   │
   ▼
Afgerond → [Terug naar het gesprek]
```

Beoogde doorlooptijd bij de standaardroute: één keuze, één vraag, één antwoord, één concept. Ruim binnen twee minuten.

---

## D. Reflectieplanner — en waarom ik hem geen planner zou noemen

**Aanbeveling: bouw geen planner-laag.** De naam suggereert een component met eigen state en levenscyclus; wat nodig is, is een pure functie plus een promptsectie. Noem het **vraagkeuze**. Dat scheelt een architectuurlaag die niemand later kan verantwoorden.

### Functionele werking

```
gekozen ingang  ─┐
bestuurderswoorden ─┤
bevroren bronset ─┘   →  gesloten lijst richtingen (per ingang)
                            ↓
                      model kiest: {richting, vraag}
                            ↓
                      validator (vormeisen + verboden formuleringen)
                            ↓
                   geldig? → tonen     ongeldig? → deterministische vraag voor die ingang
```

### Gesloten lijst richtingen

| Ingang | Richtingen |
|---|---|
| `mis_iets` | informatie · onderbouwing · alternatief · perspectief · consequentie |
| `twijfel` | onderbouwing · aannames · redenering · evenwichtigheid · uitlegbaarheid · niet_pluis |
| `risico` | gevolg · afhankelijkheid · uitvoerbaarheid · planning · beheersbaarheid |
| `overtuigt` | dragend_argument · bewijs · ondersteunde_aanname · navolgbaarheid |

**Bewuste overlap tussen `twijfel` en `risico`:** *uitvoerbaarheid* staat alleen onder `risico`, maar de verplichte uitweg in elke vraag ("of zit dat ergens anders?") maakt dat een bestuurder die `twijfel` koos en eigenlijk een risico bedoelt, gewoon verder kan. Een verkeerd gekozen ingang mag nooit een doodlopende weg zijn — dat is ook de reden dat de richtinglijsten elkaar niet hoeven uit te sluiten.

De richting is **geen conclusie over de gebruiker** en wordt nergens vastgelegd. Ze bestaat om precies één ding te doen: de volgende vraag kiezen.

### Minimale technische invulling

- **Eén nieuw bestand:** `core/lib/reflectie-richtingen.ts` — pure functies, geen I/O:
  - de gesloten lijsten hierboven;
  - `standaardVraag(ingang)` → de deterministische terugval;
  - `valideerVerdiepingsvraag(tekst)` → `{ ok, reden }`.
- **Geen extra LLM-call.** De vraagkeuze gebeurt in dezelfde generatie die de vraag schrijft; een aparte plannercall verdubbelt latency en kosten voor hetzelfde resultaat.
- **Geen nieuwe tabel, geen nieuwe kolom, geen nieuwe route.**
- **Wel:** de reflectie-verdiepingsbeurt wordt **niet gestreamd** maar gebufferd, gevalideerd en dan getoond. Het is twee zinnen; de latency is verwaarloosbaar en de guardrail wordt er preventief van in plaats van achteraf-constaterend.

### Vormeisen van de validator (machinaal toetsbaar)

1. **Precies één vraagteken.** Eén vraag per beurt is al een promptregel; hier wordt hij afdwingbaar.
2. **Maximaal twee zinnen.**
3. **Verplichte uitweg:** bevat een variant uit een kleine allowlist — *"of zit dat ergens anders"*, *"of iets anders"*, *"of ziet u het anders"*.
4. **Verboden formuleringen** (blocklist, hoofdletterongevoelig): "waarschijnlijk", "komt voort uit", "u voelt", "kennelijk", "duidelijk is dat", "het lijkt erop dat u". Dit zijn de taalvormen waarin een diagnose zich verstopt.
5. **Geen nieuwe bronverwijzing** buiten de bevroren set.

Faalt één van deze, dan de deterministische vraag. Dat maakt de huidige garantie tot ondergrens.

---

## E. Vraagstrategie — één vraag, en de bestuurder beslist over de tweede

Het feedbackvoorstel noemt drie routes na de eerste vraag: A (systeem ziet voldoende scherpte → concept), B (systeem oordeelt dat één extra vraag nuttig is), C (bestuurder wil zelf verder).

**Advies: schrap B.** Vier redenen, in volgorde van gewicht:

1. **"Is dit antwoord scherp genoeg?" is een oordeel over de inbreng van de bestuurder.** Dat is precies de gatekeeping die deze functie niet mag doen. Het verschil met de vraagkeuze uit §D is wezenlijk: die kiest *welke* vraag volgt en poort niets af; B beslist óf de bestuurder verder moet.
2. **Het is per ontwerp onmeetbaar.** Er is geen telemetrie die ooit kan aantonen of het model hier goed in is. Een niet-toetsbaar model-oordeel in een functie zonder meetpunt is technische schuld met een gezicht.
3. **Het voegt een gestructureerd veld, een transitie en een faalpad toe** voor een beslissing die de gebruiker in één klik neemt.
4. **Het risico dat het probeert op te lossen — willekeurig doorvragen — verdwijnt vanzelf** als de gebruiker de knop heeft.

**Aanbevolen model: A + C.**

- Na élk reflectieantwoord genereert de assistent het concept. Server-side, in dezelfde beurt, precies zoals de flow nu al de conceptovergang zet nadat de conceptbeurt echt is gegenereerd.
- Onder het concept staan `Nog een stap verdiepen` en (optioneel, §G) `Wat pleit er tegen?`.
- **Het beurtplafond van drie blijft ongewijzigd als harde safety guardrail** — nu niet meer als stuurmiddel maar als vangnet. De knop verdwijnt bij `beurt = 3`; de RPC weigert de transitie ook als de client het toch probeert.

Netto: standaard één vraag; twee als de bestuurder dat wil; drie als hij dat echt wil; nooit meer. Het systeem duwt nergens.

---

## F. Conceptweergave

Het voorstel voor drie kopjes is een verbetering, met drie correcties.

**Correctie 1 — geen eerste persoon.** "Mijn overweging" betekent dat de AI in de ik-vorm van de bestuurder schrijft. Dat is de scherpst denkbare vorm van "het bestuurlijk oordeel formuleren namens de bestuurder". Houd de tweede persoon aan zolang het concept niet publiceerbaar is; de ik-vorm hoort pas thuis in plateau C, ná een expliciete bewerking en adoptie door de bestuurder zelf.

**Correctie 2 — "relevant" is een oordeel.** Het kopje "Wat hierbij relevant is" laat de AI selecteren wat ertoe doet. Gebruik de bestaande, neutralere formulering *"Wat hierover al vaststond"*: dat is een feitelijke mededeling, geen relevantieoordeel. Uitsluitend bronnen die in het oorspronkelijke antwoord al zijn aangehaald. Sectie vervalt volledig als er geen bronset is.

**Correctie 3 — verleden tijd, geen agenda.** "Wat ik eventueel nog wil toetsen" is vooruitkijkend en daarmee een voorstel voor vervolgstappen. Maak het een echo: *"Wat u nog wilde toetsen"*, uitsluitend gevuld met wat de bestuurder zélf als open vraag heeft benoemd, en volledig weggelaten als hij niets heeft benoemd.

### Aanbevolen format

```
Uw reflectie, in concept

Uw overweging
<ten hoogste vijf zinnen, zo veel mogelijk in zijn eigen woorden>

Wat hierover al vaststond                    ← alleen bij een bevroren bronset
- <feitelijke passage> [Bron 2]
- <feitelijke passage> [Bron 4]

Wat u nog wilde toetsen                      ← alleen als hij dit zelf noemde
- <echo van zijn eigen open vraag>

De reflectiedialoog blijft onderdeel van deze privéchat. Met deze keuze wordt
geen afzonderlijke reflectienotitie aangemaakt.
```

Twee van de drie secties zijn voorwaardelijk: in het meest voorkomende geval is het concept nauwelijks langer dan nu. De slotzin blijft letterlijk en verplicht.

### Voorbeeld (fictief, ter illustratie van de toon)

> **Uw reflectie, in concept**
>
> **Uw overweging**
> U vindt de planning voor de overgang naar het nieuwe pensioencontract krap, en uw aarzeling zit vooral bij de afhankelijkheid van één leverancier. U noemt dat u niet kunt overzien wat er gebeurt als de oplevering een kwartaal schuift.
>
> **Wat hierover al vaststond**
> - Het implementatieplan noemt één externe partij voor de datamigratie [Bron 2].
> - De opleverdatum is in de bestuursvergadering van juni vastgesteld [Bron 4].
>
> **Wat u nog wilde toetsen**
> - Wat er gebeurt als de oplevering een kwartaal opschuift.
>
> *De reflectiedialoog blijft onderdeel van deze privéchat. Met deze keuze wordt geen afzonderlijke reflectienotitie aangemaakt.*

Merk op wat er níet staat: geen oordeel of de zorg terecht is, geen advies, geen verband tussen de twee bronnen dat de bestuurder niet zelf heeft gelegd.

---

## G. Tegenperspectief — ja, maar de assistent lévert het argument niet

Dit is het onderdeel met het grootste governancerisico in het hele voorstel. Een assistent die het sterkste tegenargument formuleert, doet drie dingen tegelijk die verboden zijn: nieuwe inhoud toevoegen tijdens de reflectie, een positie innemen, en overtuigingskracht uitoefenen op een bestuurder die zijn oordeel nog vormt.

**Advies: bouwen, maar strikt als vráág.** De assistent vraagt de bestuurder om het tegenargument; hij levert het niet.

- **Alleen op initiatief van de bestuurder.** Nooit automatisch. Een automatische tegenvraag na uitgesproken overtuiging leest als tegenspraak van de AI.
- **Als tweede knop naast "Nog een stap verdiepen", niet als apart mechanisme.** Zelfde transitie, zelfde beurtplafond, alleen een andere promptvariant. Nul extra state.
- **De assistent mag ankeren in de bevroren bronset** ("in de stukken staat ook X — weegt dat mee?"), maar mag geen argument construeren dat daar niet staat.

### Formuleringen

| Situatie | Aanbevolen formulering |
|---|---|
| Na `twijfel` of `mis_iets` | *"Wat pleit er, in de stukken of in uw eigen ervaring, het sterkst de andere kant op?"* |
| Na `overtuigt` | *"Welk gegeven zou uw vertrouwen hier aan het wankelen kunnen brengen?"* |
| Knoplabel | **Wat pleit er tegen?** |

**Eén correctie op de voorgestelde formulering.** "Wat het sterkste argument tégen uw huidige oordeel zou zijn" veronderstelt dat de bestuurder al een oordeel heeft — terwijl de hele functie ervan uitgaat dat hij dat nog aan het vormen is. Dat is subtiel sturend: het duwt hem in een positie zodat hij die kan verdedigen. "De andere kant op" doet hetzelfde werk zonder die aanname.

---

## H. Aanpassen-flow

**Het probleem:** "Aanpassen" voert geen transitie uit en zet de focus op de normale invoerbalk. Een beurt daar stuurt server-side `afbreken` — dat is de correcte regel (FR-56, het invoerkanaal bepaalt alles), maar het maakt de knop onbruikbaar. De reflectie eindigt, en de herformulering wordt een gewone chatvraag mét retrieval.

**Oplossing — één nieuwe actie, geen nieuwe status, geen schemawijziging:**

```
conceptweergave ──[Aanpassen]──▶ het gelabelde reflectieveld opent opnieuw
                                 label: "Vul aan of herformuleer uw overweging"
                                 voorgevuld met zijn eigen laatste antwoord
                                       │
                                       ▼
                                 actie `herformuleren`
                                 status blijft conceptweergave, beurt ongewijzigd
                                       │
                                       ▼
                                 nieuw concept, inclusief de aanvulling
```

- **Databasewijziging:** geen. Geen nieuwe statuswaarde, geen kolom, geen tabel. Alleen `create or replace` op `reflectie_transitie` om twee nieuwe acties te accepteren.
- **API:** de actie-allowlist uitbreiden. Geen nieuwe route.
- **Frontend:** één extra tak in het invoercomponent.
- **Voorvullen met zijn eigen laatste antwoord**, nooit met de AI-tekst van het concept — anders bewerkt hij AI-formuleringen en wordt het langzaam de tekst van het model.
- **De normale invoerbalk blijft de reflectie beëindigen.** Dat is correct gedrag en moet blijven; wel moet onder het concept dezelfde waarschuwing staan die nu onder het verdiepingsveld staat.
- **Geen limiet op herformuleren** (het verhoogt de beurt niet). Bewust: het is de eigen tekst van de bestuurder, en een teller zou registratie van reflectiegedrag zijn. De knop staat uit tijdens het genereren.

---

## I. Wijzigingen in de toestandsmachine

Statuswaarden **ongewijzigd** — de CHECK-constraint op `status` hoeft niet open. Twee acties erbij:

| Van | Actie | Naar | Beurt | Toelichting |
|---|---|---|---|---|
| `conceptweergave` | `herformuleren` *(nieuw)* | `conceptweergave` | ongewijzigd | H — de bestuurder scherpt zijn eigen tekst aan |
| `conceptweergave` | `verdiepen` *(nieuw)* | `verdieping_{beurt}` | ongewijzigd | E/G — één stap extra; geweigerd bij `beurt >= 3` |

Ongewijzigd: `start`, `antwoord`, `concept`, `afronden`, `afbreken`, het beurtplafond van 3, de fail-safe van 24 uur, de RLS-opzet, de grants, de bronsetbevriezing.

Gedragswijziging zonder transitiewijziging: de chatroute roept `concept` voortaan **na elk** reflectieantwoord aan, niet alleen bij het bereikte plafond. De spiegelfunctie die dat nu bepaalt, wordt daarop aangepast en opnieuw gepind.

Wel een migratie nodig voor de **CHECK op `ingang`** (acht waarden → drie) met mapping van eventueel bestaande rijen. Die rijen zijn per definitie kortlevend (24-uurs fail-safe, cascade bij verwijderen), maar een migratie die op bestaande data stukloopt is geen migratie.

---

## J. Promptwijzigingen

De blokken zijn gehasht en gepind; elke wijziging betekent een nieuwe pin plus een aangescherpte sanityassertie.

1. **`SP_REFLECTIE_REGELS`** — toevoegen: de gesloten lijst richtingen voor de gekozen ingang, de vormeisen van de vraag (één vraagteken, ten hoogste twee zinnen, verplichte uitweg), en het expliciete verbod op de diagnosetaal uit de blocklist. Ongewijzigd blijft alles onder "WAT U NIET DOET".
2. **`SP_REFLECTIE_CONCEPT_REGELS`** — de drie kopjes, de voorwaardelijkheid van kop 2 en 3, de tweede persoon, en het verbod om samenhang te leggen die de bestuurder zelf niet heeft gelegd.
3. **Nieuw: `SP_REFLECTIE_TEGENPERSPECTIEF`** — klein blok, alleen actief bij de knop. Kern: *u vraagt om het tegenargument, u levert het niet.*
4. **Structured output:** minimaal. Voor de verdiepingsbeurt volstaat `{ richting, vraag }`; het is geen argument voor een schema-brede aanpak elders in de codebase.
5. **Ongewijzigd:** de toon-systeemprompt (staat op de "niet doen zonder expliciet voorstel"-lijst) en alle bestaande gepinde blokken buiten de reflectie.

---

## K. Privacy- en securityimpact

**Bevestiging: de privacybelofte blijft volledig overeind.** Per principe:

| Principe | Effect van dit voorstel |
|---|---|
| Geen registratie dat een uitnodiging is getoond | Ongewijzigd — `sessionStorage`, geen database |
| Geen registratie dat iemand heeft gereflecteerd | Ongewijzigd — geen markering in `modus`, `retrieval_meta` of enig auditspoor |
| Geen registratie van welke ingang iemand kiest | **Verbetert** — `ingang` gaat van acht naar vier waarden en wordt dus minder onderscheidend. Blijft auteur-only en verdwijnt met het gesprek |
| Geen registratie van hoeveel vragen zijn beantwoord | Ongewijzigd — `beurt` bestaat al, blijft auteur-only, en wordt in de standaardroute juist lager |
| Geen registratie van twijfel of overtuiging | **De richting uit de vraagkeuze wordt nergens opgeslagen.** Vast te leggen als expliciete assertie in de audit-sanitytest |
| Reflectie-inhoud blijft privé | Ongewijzigd — geen retrieval, geen nieuwe uitgaande dataroute. De bestuurderstekst ging al naar de modelleverancier als onderdeel van de beurt; daar verandert niets aan |
| Geen psychologische profilering | De richtingclassificatie is functioneel (welke vraag volgt) en niet persoonsgericht; ze poort niets af, wordt niet getoond als conclusie en wordt niet bewaard. **Vast te leggen in een decision-record**, want zonder die vastlegging is het onderscheid over een jaar niet meer navolgbaar |
| Geen stilzwijgende publicatie | Ongewijzigd — plateau C is buiten scope; er komt geen knop bij die iets deelt |
| Transparantie | **Verbetert** — de kaart krijgt een regel dat een verkeerd gekozen ingang niets kost, en het concept zegt expliciet wat er niet gebeurt |

**Securityimpact:** `create or replace` op één bestaande `SECURITY DEFINER`-functie plus een gewijzigde CHECK-constraint. Geen nieuwe policy, geen nieuwe grant, geen nieuwe tabel, geen service-role. De structurele gates A–H moeten desondanks draaien — dat is een niet-onderhandelbare eis bij elke wijziging aan een definer-functie of het datamodel, en die staat voor plateau B toch al open (OP-B9).

---

## L. Testplan

**Functioneel**

- Vier ingangen tonen; keuze wordt gewoon gebruikersbericht; kaart laat niets achter bij wegklikken.
- Standaardroute: keuze → één vraag → antwoord → concept. Geen tweede vraag zonder klik.
- `Nog een stap verdiepen` verdwijnt bij `beurt = 3`.
- `Aanpassen` opent het reflectieveld, niet de chatbalk; het concept wordt opnieuw opgebouwd; de reflectie blijft actief.
- Een gewone vraag in de normale invoerbalk beëindigt de reflectie — óók vanuit de conceptweergave.

**Toestandsmachine** (TypeScript-sanity + SQL-check, beide)

- Volledige transitietabel opnieuw bevroren, inclusief het aantal geweigerde combinaties.
- `verdiepen` vanuit `conceptweergave` bij `beurt = 3` faalt.
- `herformuleren` verhoogt `beurt` niet en wijzigt `ingang` en bronset niet.
- `verdiepen` en `herformuleren` vanuit elke andere status falen.
- De vijf misbruikpogingen uit AC-18 blijven falen; cascade bij verwijderen blijft werken.
- Oude ingangwaarden worden door de CHECK geweigerd; de migratiemapping laat geen rij achter.

**Prompt** (uitbreiden in `evals/` en het bestaande AI-quality-lab)

- Per ingang een set realistische bestuurdersantwoorden; assert dat de gegenereerde vraag de validator passeert: één vraagteken, ten hoogste twee zinnen, uitweg aanwezig, geen blocklistterm, geen bron buiten de bevroren set.
- Negatieve set: forceer diagnosetaal en assert dat de terugval intreedt.
- Conceptweergave: assert de kop, de voorwaardelijkheid van sectie 2 en 3, de letterlijke slotzin, en de afwezigheid van advies- en conclusiewoorden.
- Tegenperspectief: assert dat de output een vraag is en geen argument.

**Privacy**

- `audit-meta.sanity.ts`: nog steeds geen reflectiesleutel in enige allowlist; expliciete assertie dat `richting` nergens voorkomt.
- SQL-check: kolomscan op "reflectie" blijft schoon binnen de bestaande smalle allowlist.
- Handmatig: één volledige reflectie doorlopen en daarna `governance_log`, `retrieval_meta` en `profiel_log` controleren op elk spoor.

**Gebruikerstoets** — blokkerend, en dit is het moment om OP-B1 te sluiten

Drie tot vijf bestuurders, papieren of klikbare mockups, vóór de bouw van onderdeel 2:

| # | Te valideren | Kritiek bij |
|---|---|---|
| 1 | Zijn de vier ingangen herkenbaar en dekkend? | Deelnemer kan zijn eigen aarzeling niet kwijt |
| 2 | **Verdient "Ik zie een risico" zijn plaats?** Aarzelt iemand zichtbaar tussen die knop en "Ik twijfel", en verschilt de vraag die erop volgt? | Beide verwijdercriteria uit §B doen zich voor — dan gaat de knop eruit vóór ingebruikname |
| 3 | Voelt één vraag als genoeg? | Deelnemer verwacht meer, of ervaart één vraag als afgeraffeld |
| 4 | Wordt "Aanpassen" begrepen als het bijstellen van eigen tekst? | Gelezen als weggooien |
| 5 | Leest het concept als *zijn* overweging of als AI-tekst? | Als AI-tekst — dan is de spiegel mislukt |
| 6 | Is "Wat pleit er tegen?" behulpzaam of betuttelend? | Ervaren als tegenspraak |
| 7 | Verschijnt de proactieve uitnodiging op een logisch moment? | Ervaren als storend |

Leg het toetsrecord vast onder `08 Test en acceptatie/` met deelnemers, scenario's, bevinding per criterium en doorgangsoordeel, en verwijs ernaar vanuit `HANDOVER.md` en `huidige-status.md`. Zonder dat record herhalen we de fout die OP-B1 beschrijft.

---

## M. Implementatievolgorde

### 1. Noodzakelijke fixes — geen ontwerpwijziging, geen toets nodig

- **H-1:** `herformuleren`-actie + de Aanpassen-flow.
- **H-3:** de `sparring`-proxy uit de triggerlogica; alleen `besluitrijpheid` blijft over.
- De besluitmoment-variant van de openingsvraag daadwerkelijk meegeven.
- De ongebruikte tweede fail-safe-parameter opruimen of verantwoorden.

Los te releasen, klein, en het haalt de scherpste beloftebreuk direct weg.

### 2. Compacte UX — vergt gebruikerstoets vooraf

- Vier ingangen, nieuwe labels en subteksten, kaartlayout.
- Migratie voor de CHECK op `ingang` met mapping.
- Eén vraag als standaard + `verdiepen`-transitie en -knop.
- Nieuw conceptformat.

### 3. Adaptieve verdieping

- `reflectie-richtingen.ts` met richtinglijsten, terugval en validator.
- Niet-gestreamde, gevalideerde verdiepingsbeurt.
- Promptwijziging plus nieuwe pins.
- Decision-record over de herziening van het non-classificatieprincipe.

### 4. Optionele verfijning

- `Wat pleit er tegen?`.
- T1 (na een agendapuntvoorbereiding) als deterministische trigger, als dat goedkoop blijkt.
- **Eventueel `risico` weer verwijderen**, uitsluitend wanneer bij de toets beide verwijdercriteria uit §B zich voordoen. Beslis dit vóór ingebruikname; daarna kost het opnieuw een migratie.

**Vaste volgorde-eis:** onderdeel 1 kan meteen. Onderdeel 2 pas ná de gebruikerstoets — dezelfde gate die besluit 0122 al oplegde, en die we vorige keer op een mondelinge bevestiging hebben gepasseerd.

---

## Benodigde besluitrecords

Volgens de Definition of Done is een afwijking van vastgesteld ontwerp per definitie een herziening en moet die als zodanig worden vastgelegd. Dit voorstel vergt er vier:

| # | Onderwerp | Herziet |
|---|---|---|
| 1 | Vier reflectie-ingangen in plaats van acht, mét het verwijdercriterium voor `risico` | Ontwerp v1.0 §9.3 |
| 2 | Eén verdiepingsvraag als standaard; verdieping op initiatief van de bestuurder | Ontwerp v1.0 §9.6; besluit 0113-context |
| 3 | Adaptieve vraagkeuze binnen guardrails — herziening van het non-classificatieprincipe, mét de zes guardrails uit §A-bis | De expliciete regel "nooit classificeren op inhoud" |
| 4 | `herformuleren` als expliciete transitie; de normale invoerbalk blijft beëindigend | Besluit 0110 (transitietabel) |

Daarnaast: functioneel ontwerp naar v1.1, en het technisch ontwerp bijwerken op §6.1.
