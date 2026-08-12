# Addendum — het zichtbare reflectie-antwoordpad

**Status:** voorstel ter besluitvorming — nog geen code
**Datum:** 12 augustus 2026
**Hoort bij:** `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` (§A–M). Dit addendum vult dat voorstel aan op de zichtbare vorm van een reflectiebeurt en vervangt niets.
**Scope-grens:** ongewijzigd. Geen documentvergelijking, geen dossierconsistentie, geen nieuwe platformcapability.

---

## 0. Beoordeling van de aanvullende feedback

**Ik volg de richting volledig.** De drie verplichte koppen zijn de belangrijkste oorzaak van het geconstrueerde gevoel, en de argumentatie klopt: een reflectiebeurt is geen analyse, dus hij hoort er ook niet als analyse uit te zien. Drie dingen wil ik wel scherpstellen voordat we het bouwen.

### 0.1 Wat de koppen deden, en waarmee we ze vervangen

De koppen waren niet cosmetisch. Ze waren de **zichtbare bewijsdiscipline**: ze maakten met het blote oog controleerbaar welke zin van de bestuurder kwam, welke uit de bevroren bronset, en welke de vraag van de assistent was. Halen we ze weg zonder vervanging, dan houden we een interne belofte over waar eerst een zichtbare garantie stond — en juist een vloeiend geschreven zin is de plek waar dossierfeit en modelgevolgtrekking ongemerkt in elkaar overlopen.

**Vervangende regel, en die is strenger dan de koppen waren:**

> Elke uitspraak over het dossier draagt een expliciete attributie — *"in de stukken…"*, *"in het eerdere antwoord…"*, met `[Bron N]` waar van toepassing. Alles wat niet zo is gemarkeerd, is de inbreng van de bestuurder of de vraag van de assistent. Een eigen constatering van de assistent bestaat niet.

Daarmee is de scheiding niet langer een rubriek maar een eigenschap van elke zin. Dat is natuurlijker om te lezen én preciezer om te toetsen.

### 0.2 De sterkste van je voorbeelden wordt op dit moment niet ondersteund

Dit is het belangrijkste punt van dit addendum.

Je noemt als voorbeeld waar broncontext wél helpt:

> *"In het eerdere antwoord is een deel rechtstreeks gebaseerd op uw stukken en een deel aangevuld vanuit algemene wetskennis. Welk deel wilt u als eerste scherper krijgen?"*

Dat is inhoudelijk het beste voorbeeld in de hele aanvulling: het is feitelijk, niet-diagnostisch, en het maakt een vage twijfel meteen adresseerbaar. **Maar de reflectiebeurt beschikt op dit moment niet over die informatie.** De bevroren bronset bevat de passages uit de bibliotheek; of het oorspronkelijke antwoord daarnaast op algemene modelkennis of op geverifieerde webbronnen leunde, zit in een ander deel van de antwoordmetadata en wordt niet meegegeven aan de reflectiebeurt.

Er zijn twee routes, en het verschil is principieel:

| Route | Wat er gebeurt | Oordeel |
|---|---|---|
| **A. Het model leidt het af** | De assistent concludeert uit de context dat er "waarschijnlijk ook algemene kennis" is gebruikt | **Verwerpen.** Dat is een bewering over de herkomst van een eerder antwoord op basis van een gok. Schijnzekerheid over bronherkomst is precies wat dit portaal nergens doet |
| **B. De server geeft het feitelijk mee** | Bij het bevriezen van de bronset wordt de feitelijke samenstelling van het oorspronkelijke antwoord meegegeven: alleen dossier / dossier + algemene kennis / dossier + web / alleen algemene kennis | **Aanbevolen.** Kleine wijziging, geen nieuwe opslag, en de uitspraak is dan waar |

Concreet: één extra veld in de reflectiecontext, afgeleid uit de metadata van het antwoord waarop wordt gereflecteerd, en een promptregel die de samenstellingszin **uitsluitend** toestaat wanneer dat veld is meegegeven. Geen veld, geen zin.

Dit valt onder tranche 3 en kost weinig — maar zonder deze stap is de mooiste variant uit je voorbeelden een uitspraak die het model verzint.

### 0.3 Antwoordchips zijn de vragenlijst die door de achterdeur terugkomt

Je signaleert dit zelf in punt 8, en ik wil het scherper stellen dan "spaarzaam gebruiken".

Het oorspronkelijke bezwaar was: *acht ingangen voelt als een vragenlijst*. Chips bij elke beurt maken van één vragenlijst-vooraf een vragenlijst-per-beurt. Er is bovendien een tweede kostenpost die zwaarder weegt: **een chipantwoord is niet de formulering van de bestuurder maar die van het systeem.** Klikt hij op "De redenering", dan hebben we een categorie geleerd en geen overweging — en de conceptweergave, die zijn eigen woorden moet spiegelen, komt dan uit op *"U twijfelt aan de redenering"*. Dat is precies de uitkomst waarop de gebruikerstoets zal afrekenen met "dit leest als AI-tekst, niet als mijn overweging".

**Voorstel dat het voordeel behoudt zonder de kosten:** een chip is geen antwoord maar een **opener**. Klikken vult het reflectieveld voor met het fragment ("In de redenering") en zet de cursor erachter; de bestuurder vult aan of verstuurt zoals het is. De cognitieve drempel gaat omlaag — dat is waar chips voor zijn — maar het antwoord blijft zijn eigen tekst.

Aanvullende regels:

- Alleen bij de **eerste** verdiepingsbeurt. Daarna is het gesprek op gang en zijn chips ruis.
- **Ten hoogste drie**, plus een verplichte open uitweg.
- Labels komen **uit de gesloten richtinglijst of rechtstreeks uit de bevroren bronset** — nooit vrij geformuleerd door het model. Dat is machinaal toetsbaar en voorkomt dat een chip een richting suggereert die niet uit het dossier volgt.
- **Tranche 4, optioneel.** De open vraag is de kern; chips zijn een verbetering die we pas bouwen als de toets uitwijst dat de open vraag te veel drempel geeft.

### 0.4 Twee gevolgen die je aanvulling elders heeft

- **De conceptweergave wordt belangrijker.** Als de beurt zelf niet meer samenvat, is het concept de enige plek waar de bestuurder zijn eigen woorden terugziet. Dat is een argument te meer voor het voorwaardelijke format uit `VOORSTEL` §F — en het verhoogt de weging van toetscriterium 5 ("leest het concept als *zijn* overweging?").
- **Niet-streamen wordt vanzelfsprekend.** Een beurt van veertig woorden streamen heeft geen functie. Genereren, valideren, tonen. De guardrail wordt daarmee preventief in plaats van constaterend — zie `VOORSTEL` §A-bis.

---

## 1. Nieuwe systeemprompt voor reflectiebeurten

Vervangt `SP_REFLECTIE_REGELS`. Nieuwe hashpin vereist.

```
U begeleidt een REFLECTIE: de bestuurder onderzoekt zijn eigen afweging bij een
eerder antwoord. Dit is geen informatievraag. U beantwoordt niets, u lost niets
op, u adviseert niet.

VORM VAN UW BEURT
- Ten hoogste één korte spiegelzin die aansluit op wat de bestuurder heeft
  gekozen of gezegd. Laat die zin weg wanneer de vraag ook zonder haar
  natuurlijk leest.
- Ten hoogste één korte contextzin uit de eerder vastgestelde broninformatie,
  en alleen wanneer die de vraag concreter maakt. Géén contextzin is de normale
  uitkomst, niet de uitzondering.
- Precies één verdiepingsvraag. Die vraag is de kern van de beurt.
- Samen ten hoogste ongeveer zestig woorden, in doorlopende tekst. Geen koppen,
  geen rubrieken, geen opsomming, geen markering in hoofdletters.

ONDERSCHEID DAT U INTERN STRIKT BEWAAKT MAAR NIET ALS RUBRIEK TOONT
  1. wat de bestuurder zelf heeft ingebracht;
  2. wat al uit de eerder vastgestelde broninformatie blijkt;
  3. de vraag die u stelt.
Noemt u iets uit het dossier, dan is dat als zodanig herkenbaar ("in de
stukken…", "in het eerdere antwoord…") met [Bron N] waar van toepassing. Alles
wat u niet zo markeert, is de inbreng van de bestuurder of uw vraag. Een eigen
constatering van u bestaat niet.

WAT U NIET DOET
- U duidt de twijfel niet, u diagnosticeert niet, en u schrijft de bestuurder
  geen motief, gevoel of oordeel toe.
- U stelt niet gerust en u wakkert niet aan. Een reflectie hoeft niet in een
  conclusie te eindigen.
- U voegt geen nieuwe feiten, cijfers of bronnen toe. Er is niet gezocht; wat u
  heeft is wat u heeft.
- U herhaalt de gekozen ingang hoogstens één keer en kort, en u citeert hem
  niet ("U geeft aan: …").
- U beschrijft niet wat de bestuurder nog niet heeft gezegd ("u specificeert
  nog niet…", "het is nog niet duidelijk of…").
- U vat het eerdere antwoord niet samen en u geeft geen bronanalyse, tenzij de
  bestuurder daar uitdrukkelijk om vraagt.
- U benoemt niet dat dit een "reflectie" is als proces, u geeft er geen naam of
  etiket aan, en u legt de werkwijze niet uit.
- U doet geen uitspraak over waar het eerdere antwoord zijn informatie vandaan
  haalde, tenzij de samenstelling hieronder expliciet is meegegeven.

TOON
Een ervaren, rustige gesprekspartner. Korte zinnen, gewone taal, één vraag
tegelijk, ruimte voor zijn eigen woorden.

Is er geen broninformatie beschikbaar, dan reflecteert u uitsluitend op het
eerdere antwoord en op de woorden van de bestuurder. U verzint geen
dossiercontext.
```

**Server-injectie, alleen wanneer feitelijk vastgesteld** (zie §0.2) — één regel, direct boven het bronblok:

```
SAMENSTELLING VAN HET EERDERE ANTWOORD: <alleen uw stukken | uw stukken en
algemene kennis van het model | uw stukken en geverifieerde webbronnen>.
U mag dit noemen; u mag het niet aanvullen of afleiden.
```

Ontbreekt de regel, dan verbiedt het promptblok hierboven elke uitspraak over herkomst. Dat is de hele beveiliging tegen een verzonnen samenstellingszin.

---

## 2. Voorbeeldbeurten per ingang

Steeds drie: zonder context, met context, en een tweede beurt na doorvragen. Woordentelling erbij, omdat die de acceptatiecriteria uit §8 raakt.

### Ik mis iets

> **A — zonder context** *(12 woorden)*
> Wat ontbreekt voor u om hier een oordeel over te kunnen vormen?

> **B — met context** *(34 woorden)*
> De stukken onderbouwen vooral de kosten en de planning; over de uitvoerbaarheid bij de uitvoerder staat weinig [Bron 3]. Is dat wat u mist, of iets anders?

> **C — tweede beurt** *(21 woorden)*
> U mist zicht op de gevolgen voor gepensioneerden. Welk gevolg zou u als eerste bevestigd willen zien?

### Ik twijfel

> **A — zonder context** *(16 woorden)*
> Waar zit uw twijfel vooral: in de feiten, de aannames, de redenering — of ergens anders?

> **B — met context** *(31 woorden)*
> De conclusie leunt sterk op de aanname dat de uitvoerder in het derde kwartaal gereed is [Bron 2]. Zit uw twijfel daarin, of ergens anders?

> **C — tweede beurt, richting uitlegbaarheid** *(17 woorden)*
> U twijfelt of dit goed uit te leggen is. Aan wie denkt u dan het eerst?

### Dit overtuigt mij

> **A — zonder context** *(7 woorden)*
> Wat weegt hier voor u het zwaarst?

> **B — met context** *(33 woorden)*
> In het eerdere antwoord staan twee argumenten: de lagere uitvoeringslast en de kostenbesparing [Bron 1, Bron 4]. Welk van beide draagt uw vertrouwen het meest?

> **C — tegenperspectief, alleen na een klik** *(14 woorden)*
> Welk gegeven zou uw vertrouwen hier aan het wankelen kunnen brengen?

### Ik zie een risico

> **A — zonder context** *(11 woorden)*
> Welk gevolg of welke afhankelijkheid baart u hier vooral zorgen?

> **B — met context** *(30 woorden)*
> In de stukken worden de planning en de afhankelijkheid van één leverancier genoemd [Bron 2]. Zit uw zorg daarin, of ziet u een ander risico?

> **C — tweede beurt** *(19 woorden)*
> U noemt de opleverdatum. Wat zou er volgens u als eerste misgaan wanneer die schuift?

Let op het verschil met de ingang `twijfel`: hier wordt niet gevraagd *of* er iets niet klopt, maar *wat* het gevolg is. De bestuurder heeft al iets geconstateerd; de vraag helpt hem dat te concretiseren, niet om het alsnog ter discussie te stellen. **Een vraag die de constatering impliciet in twijfel trekt** ("weet u zeker dat dat een risico is?") is hier de belangrijkste fout — voeg die toe aan de evalset als negatief geval.

---

## 3. Goed versus te sturend

| Te sturend of onjuist | Wat er misgaat | Wel |
|---|---|---|
| "Uw twijfel komt waarschijnlijk voort uit de leveranciersafhankelijkheid." | Diagnose. De assistent bepaalt wat de bestuurder voelt | "In de stukken worden planning en leveranciersafhankelijkheid genoemd [Bron 2]. Zit uw twijfel daarin, of ergens anders?" |
| "U specificeert nog niet welk deel van de onderbouwing u bedoelt." | Beschrijft wat hij níet zei; creëert afstand en een impliciet tekort | "Welk onderdeel van de onderbouwing voelt nog niet stevig?" |
| "U geeft aan: 'Ik twijfel aan de onderbouwing.' **WAT U INBRENGT** — u twijfelt aan de onderbouwing…" | Citaat plus rubriek plus herhaling: drie keer hetzelfde | "U twijfelt aan de onderbouwing. Waar zit die vooral?" |
| "Het is begrijpelijk dat u hierover twijfelt; veel besturen worstelen hiermee." | Geruststelling en een toegeschreven gevoel | Weglaten. De vraag alleen is beter |
| "Terecht dat u dit opmerkt — de planning is inderdaad krap." | Oordeel over de inbreng, en een eigen constatering over het dossier | "In de stukken staat de opleverdatum in juni [Bron 4]. Is dat waar uw zorg zit?" |
| "Zal ik de belangrijkste risico's voor u op een rij zetten?" | Biedt een nieuw inhoudelijk antwoord aan; de reflectie wordt een analyse | Weglaten. Wie een analyse wil, stelt een gewone vraag in de invoerbalk |
| "Een deel van het antwoord kwam waarschijnlijk uit algemene kennis." | Gok over bronherkomst — schijnzekerheid | Alleen toegestaan als de server de samenstelling feitelijk meegaf (§0.2) |
| "Goed dat u dit toetst — dat hoort bij zorgvuldige besluitvorming." | Uitleg van de methodiek tijdens de reflectie; belerend | Weglaten |
| Na `risico`: "Weet u zeker dat dit een risico is? De stukken noemen mitigerende maatregelen." | Trekt de constatering van de bestuurder in twijfel en weerlegt hem met bronnen. Bij deze ingang is er niets te weerleggen — hij heeft al iets gezien | "Welk gevolg baart u hier vooral zorgen?" |

---

## 4. Vereenvoudigde bronweergave tijdens reflectie

**Uitgangspunt: een reflectiebeurt is visueel lichter dan een regulier antwoord.** Vandaag krijgt een reflectiebeurt de volledige bronbalk en het onderbouwingspaneel, waardoor hij eruitziet als opnieuw een analyse.

**Voorstel — drie standen:**

| Situatie | Weergave |
|---|---|
| De beurt bevat **geen** dossieruitspraak | **Niets.** Geen bronbalk, geen onderbouwingspaneel, geen bronkaarten |
| De beurt bevat **wel** een dossieruitspraak | Eén regel, klein en gedempt: *Zelfde bronbasis als het eerdere antwoord · **Bronnen bekijken*** — uitklapbaar naar het bestaande bronkaartcomponent, ongewijzigd |
| Conceptweergave | Zelfde regel, alleen wanneer de sectie "Wat hierover al vaststond" gevuld is |

Verder tijdens reflectie **niet** tonen: vervolgvraag-chips (die staan al uit via G1), de webbronsectie, de modelkennissectie, en elke inline-melding over antwoordmodus.

**Belangrijk, om een goedbedoelde opruimactie te voorkomen:** dit is uitsluitend een **weergave**wijziging. De beurt wordt onveranderd gelogd als gewone chatbeurt, met dezelfde bronvermeldingen, zonder enige markering dat het reflectie betrof. Wie de logging "meeneemt" in deze opschoning, raakt het auditspoor en daarmee besluit 0112 en de logging-guardrail tegelijk.

**Let op de gedeelde renderer:** `/ai` en de agendapuntchat gebruiken één antwoordweergave (besluit 0079). Een wijziging landt altijd op beide, en `AI-WEERGAVE-ONTWERP.md` moet mee.

---

## 5. Compacte antwoordchips — voorstel

Zie de afweging in §0.3. Samengevat als bouwspecificatie:

- **Wanneer:** alleen bij de eerste verdiepingsbeurt, en alleen wanneer de vraag richtingen aanbiedt.
- **Hoeveel:** ten hoogste drie, plus altijd de open uitweg **Iets anders**.
- **Herkomst van de labels:** uit de gesloten richtinglijst (§`VOORSTEL` D) óf letterlijk uit de bevroren bronset. Nooit vrij geformuleerd door het model — machinaal toetsbaar.
- **Semantiek:** een chip is een **opener**, geen antwoord. Klikken vult het reflectieveld voor met het fragment en plaatst de cursor erachter; versturen kan direct of na aanvulling.
- **Uitweg:** *Iets anders* vult niets voor en zet alleen de cursor in het lege veld.
- **Toon:** zelfde rustige stijl als de ingangknoppen. Geen kleuraccent, geen iconen.
- **Tranche 4, optioneel.** Bouw eerst de open vraag.

Voorbeeld zoals het eruitziet:

```
U twijfelt aan de onderbouwing. De conclusie leunt sterk op de aanname
dat de uitvoerder in het derde kwartaal gereed is [Bron 2].

Zit uw twijfel daarin, of ergens anders?

[ In die aanname ]  [ In de feiten ]  [ In de redenering ]  [ Iets anders ]

Uw antwoord op deze verdiepingsvraag
┌──────────────────────────────────────────────┐
│ In die aanname▌                              │
└──────────────────────────────────────────────┘

Zelfde bronbasis als het eerdere antwoord · Bronnen bekijken
```

---

## 6. Impact op componenten en toestandsmachine

**Toestandsmachine: geen enkele wijziging door dit addendum.** Geen nieuwe status, geen nieuwe actie, geen migratie. De wijzigingen uit `VOORSTEL` §I (`herformuleren`, `verdiepen`) blijven staan zoals ze zijn.

| Component | Wijziging | Aard |
|---|---|---|
| `core/lib/generatie-kern.ts` | Nieuwe `SP_REFLECTIE_REGELS`; nieuwe hashpin | Prompt + pin |
| `core/lib/reflectie-richtingen.ts` *(nieuw, uit tranche 3)* | Validator uitgebreid: woordplafond, koppendetectie, attributieregel, uitgebreide blocklist | Code |
| `app/api/chat/route.ts` | Verdiepingsbeurt niet streamen; samenstellingsmarker meegeven; validator aanroepen met terugval | Code |
| `core/components/AntwoordWeergave.tsx` (+ `AI-WEERGAVE-ONTWERP.md`) | Lichte reflectiestand van de bronweergave | UI |
| `core/components/ReflectieInvoer.tsx` | Chips met voorvul-semantiek | UI + kleine code |
| `app/(dashboard)/ai/_components/AssistentClient.tsx` en `.../AgendapuntChat.tsx` | Doorgeven van de lichte weergavestand; chipafhandeling | UI |

### Wat is prompt/UI en wat vergt code?

| Alleen prompt (plus verplichte hashpin) | Alleen UI | Vergt code |
|---|---|---|
| Vorm van de beurt, koppen weg, toonregels, verbod op herhaling en samenvatting, attributieregel | Lichte bronweergave; verbergen van web- en modelkennissecties; chipweergave en layout | Woordplafond en vormvalidatie met terugval; niet-streamen; samenstellingsmarker; chip-voorvulling; nieuwe eval-suite |

Nuttig gevolg: **de kern van dit addendum — de vorm en de toon van de beurt — is een promptwijziging.** Dat maakt hem goedkoop om te bouwen en, belangrijker, goedkoop om bij te stellen na de gebruikerstoets. De code eromheen dient uitsluitend om te voorkomen dat een afwijking ongemerkt doorglipt.

---

## 7. Acceptatiecriteria

Uitdrukkelijk gescheiden naar wat runtime wordt afgedwongen en wat alleen in de evalsuite wordt vastgesteld. Alles als "hard" bestempelen zou onwaar zijn.

### Machinaal afgedwongen — falen betekent terugval op de deterministische vraag

| # | Criterium |
|---|---|
| AC-R1 | Ten hoogste 60 woorden, knoplabels niet meegeteld |
| AC-R2 | Precies één vraagteken |
| AC-R3 | Geen koppen of rubrieken: geen markdown-kop, geen regel volledig in hoofdletters, geen opsommingstekens |
| AC-R4 | Geen term uit de blocklist: *waarschijnlijk · komt voort uit · u voelt · kennelijk · u specificeert · u geeft aan dat u · het is nog niet duidelijk · het lijkt erop dat u · begrijpelijk dat u · terecht dat u* |
| AC-R5 | Biedt de vraag twee of meer richtingen aan, dan is een open uitweg verplicht (*of ergens anders · of iets anders · of ziet u het anders*) |
| AC-R6 | Geen `[Bron N]` die niet in de bevroren bronset zit |
| AC-R7 | Geen uitspraak over de samenstelling van het eerdere antwoord zonder de server-injectie uit §1 |
| AC-R8 | Chiplabels komen uit de gesloten richtinglijst of letterlijk uit de bevroren bronset |

### Alleen in de evalsuite vast te stellen

| # | Criterium |
|---|---|
| AC-E1 | De gekozen ingang wordt ten hoogste één keer teruggegeven en nooit geciteerd |
| AC-E2 | Geen samenvatting van het eerdere antwoord en geen bronanalyse |
| AC-E3 | Geen diagnose: nergens staat waar twijfel, zorg of overtuiging vandaan komt |
| AC-E4 | Geen nieuwe feiten; elke dossieruitspraak is attributief geformuleerd |
| AC-E5 | **Distributie:** over de vaste evalset bevat de meerderheid van de eerste beurten géén contextzin. Context is de uitzondering, niet de gewoonte |
| AC-E6 | Toonoordeel: leest de beurt als een rustige gesprekspartner? Vastgesteld door een beoordelaar of beoordelingsprompt, niet door een regex |
| AC-E7 | Bij ingang `risico` wordt de constatering van de bestuurder niet ter discussie gesteld of weerlegd; de vraag concretiseert het gevolg |
| AC-E8 | **Onderscheidenheid `twijfel` versus `risico`:** dezelfde bestuurdersinbreng levert bij de twee ingangen aantoonbaar verschillende vragen op. Levert hij dezelfde vraag, dan is dat een signaal voor verwijdercriterium 2 uit `VOORSTEL` §B |

### Gebruikerstoets — twee criteria erbij, boven op de zeven uit het hoofdvoorstel

| # | Te valideren | Kritiek bij |
|---|---|---|
| 8 | Leest de beurt als een gesprek of als een formulier? | Deelnemer noemt hem "een analyse" of "een formulier" |
| 9 | Wordt het ontbreken van een bronbalk als gemis ervaren? | Deelnemer vertrouwt de beurt minder zonder zichtbare bronnen |

Criterium 9 is niet vanzelfsprekend: de lichte weergave is bedoeld als rust, maar in een portaal waarin bronvermelding het vertrouwen draagt, kan het weglaten ervan ook als verzwakking landen. Dat wil ik weten vóór we het breed uitrollen.

---

## 8. Gevolgen voor de eerdere stukken

- **`VOORSTEL-REFLECTIE-OPTIMALISATIE.md` §D** — de validator krijgt er vier regels bij (AC-R1, R3, R7, R8). De zes guardrails uit §A-bis blijven ongewijzigd van kracht.
- **§F (conceptweergave)** — ongewijzigd, maar zwaarder gewogen: het concept is nu de enige plek waar de bestuurder zijn eigen woorden terugziet.
- **§J (promptwijzigingen)** — `SP_REFLECTIE_REGELS` wordt vervangen in plaats van aangevuld. Nieuwe hashpin en aangescherpte sanityasserties.
- **§M (volgorde)** — dit addendum landt grotendeels in tranche 3; de lichte bronweergave kan mee met tranche 2 omdat zij losstaat van de vraagkeuze. Chips blijven tranche 4.
- **Nieuw besluitrecord, vijfde bij de vier uit het hoofdvoorstel:** *"Reflectiebeurten zijn doorlopende tekst met attributieplicht in plaats van drie vaste rubrieken"* — herziening van ontwerp v1.0 §9.6 en van de gepinde promptregel.
