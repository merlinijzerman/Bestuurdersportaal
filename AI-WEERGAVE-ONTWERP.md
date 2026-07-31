# AI-antwoordweergave — Ontwerpdocument

- **Versie:** 0.4 · 31 juli 2026
- **Status:** Vastgelegd voor tranche 1 (parser-regressienet, tabel- en leesopmaak, kopiëren),
  tranche 2A (bronverificatie in de renderlaag — §8), tranche 2B (documentvraag als
  documentlijst — §9) en tranche 2C (visuele rust — §10)
- **Bron van waarheid:** de code. Dit document beschrijft *wat en waarom*; bij afwijking wint
  `core/lib/antwoord-parser.ts` + `app/(dashboard)/ai/_components/AntwoordWeergave.tsx`.

## 1. Waar dit over gaat

Het portaal toont AI-antwoorden op twee plekken:

| Surface | Bestand | Container |
|---|---|---|
| Volledige assistent `/ai` | `app/(dashboard)/ai/_components/AssistentClient.tsx` | kolom `max-w-[1020px]` |
| Inline agendavoorbereiding | `app/(dashboard)/vergaderingen/_components/AgendapuntChat.tsx` | smal paneel, `max-h-96` |

Sinds besluit [`0079`](./decisions/0079-agenda-assistent-gedeelde-weergave.md) delen die
**exact dezelfde renderer**. Elke wijziging aan de weergave landt dus per definitie op beide
plekken. Let op: de geautomatiseerde tests zitten allemaal op `core/lib` (bewust — zie §2);
de surfaces zelf worden handmatig gerookt, en dat moet dan ook op beide.

## 2. Architectuur — parser en renderer zijn gescheiden

```
antwoordtekst (markdown-subset uit het model)
        │
        ▼
core/lib/antwoord-parser.ts        ← PURE functies, geen React
   parseerBlokken(tekst) → Blok[]
   parseerInline(regel)  → InlineDeel[]
   numeriekeKolommen(tabel) → boolean[]
        │
        ├──────────────► AntwoordWeergave.tsx      → React/JSX (het scherm)
        └──────────────► core/lib/antwoord-klembord.ts → text/html + text/plain (klembord)
```

Sinds tranche 2 staan er nog drie pure modules naast: `core/lib/bronfragment.ts` (het citaat
onder een bronvermelding, gevoed vanuit `rag.ts` en `besluitvorming-bron.ts`),
`core/lib/bronsamenvatting.ts` (de regel in de ingeklapte onderbouwingsbalk, §8, én sinds
2C het afgeleide pill-label, §10.1) en
`core/lib/documentlijst.ts` (ordening en filtering van de documentlijst, §9). Alle drie om
dezelfde reden als de parser: het zijn regels die het scherm bepálen, dus horen ze testbaar
te zijn.

De parser zat tot 31-07-2026 verweven met JSX in het component en had **geen enkele
geautomatiseerde test**, terwijl hij twee schermen voedt. Hij is uitgetrokken naar
`core/lib` om drie redenen:

1. **Testbaarheid.** Een suite op de gerenderde HTML valt om bij elke opmaakwijziging; een
   suite op de AST legt structuur en semantiek vast en overleeft styling. Zie
   `core/lib/antwoord-parser.sanity.ts` (51 tests).
2. **Eén interpretatie.** De kopieerfunctie moet dezelfde tekst omzetten naar Word- en
   Excel-formaat. Twee parsers zouden uiteenlopen, met als zichtbaar gevolg dat wat je
   kopieert niet is wat je ziet.
3. **Laagscheiding.** `app/` mag `core/` importeren, andersom niet (boundary T9).

De extractie is gedragsneutraal uitgevoerd: een wegwerp-harness rendeerde 471 fixtures
(inclusief 400 streamprefixes) met de oude en de nieuwe code via `renderToStaticMarkup` —
**4.239 vergelijkingen, byte-identieke HTML**. Dat was een **eenmalige meting op
31-07-2026**; de harness had een kopie van de pre-extractie-code nodig en staat niet in
de repo, dus de meting is niet reproduceerbaar. Wat blijvend bewaakt wordt, is de AST —
zie `core/lib/antwoord-parser.sanity.ts`.

Let op de reikwijdte: byte-identiek gold voor de **extractiestap** (§2), niet voor de
tranche als geheel. De gerenderde DOM is daarna wél veranderd — zie §4.3.

### 2.1 De AST

```
Blok  = { soort:"alinea", inline }
      | { soort:"kop", niveau:1..6, inline }
      | { soort:"lijst", geordend:boolean, items }
      | { soort:"tabel", kop, rijen }

InlineDeel = { k, soort:"tekst", stukken }        // stukken: plat | vet | cursief | code
           | { k, soort:"bron", nummer }
           | { k, soort:"kennis", label, instantie }
           | { k, soort:"toelichting" }
           | { k, soort:"organisatieprofiel" }
```

`niveau` is getypeerd als `number`; dat het altijd 1..6 is, is een parser-invariant
(de regex is `#{1,6}`), geen typegarantie.

`k` is de oorspronkelijke splitsindex en voedt de React-key. Dat is geen detail: tijdens het
streamen wordt hetzelfde antwoord tientallen keren opnieuw geparseerd, en een verschuivende
key betekent een remount van een pill halverwege een zin.

## 3. Bekende eigenaardigheden — bevroren, niet gerepareerd

De sanity-suite legt het bestaande gedrag vast, **ook waar dat suboptimaal is**. Dit zijn
bevindingen voor een volgende tranche, geen bugs die stilletjes zijn opgelost:

| # | Gedrag | Gevolg |
|---|---|---|
| E1 | Een `<ol>` begint altijd bij 1 | `3. tekst` na een alinea toont "1." |
| E2 | Geneste lijsten worden platgeslagen | inspringing gaat verloren |
| E3 | Uitlijningsdubbelepunten (`\|---:\|`) worden genegeerd | uitlijning komt uit de celinhoud (§4.1) |
| E4 | Ragged rijen worden niet aangevuld of afgekapt | een rij met minder cellen rendert korter |
| E5 | `[Bron 0]` is altijd ongeldig (index −1) | toont de "⚠ Bron 0?"-markering |
| E6 | `**vet**` dat over een marker heen loopt wordt niet herkend | de marker splitst eerst |
| E7 | **Tabelflikker tijdens het streamen** | zie hieronder |

### E7 — tabelflikker

Een tabelrij telt pas als de regel op `\|` eindigt. Tijdens het streamen levert dat twee
zichtbare knippers op:

- **Scheidingsregel.** `\|---\|` is al een geldige scheiding voor een 1-koloms tabel;
  `\|---\|-` niet. De tabel verschijnt en verdwijnt dus per pipe tot de regel compleet is.
- **Laatste rij.** `\| 1 \|` is een complete rij van één cel; `\| 1 \| 2` is geen rij meer.
  Het rijaantal daalt daardoor tijdelijk, en de laatste regel toont kort het verkeerde
  aantal kolommen.

**Op regelgrenzen is het gedrag wél netjes** — dat is als eigenschap getest: de tabel
verschijnt zodra de scheidingsregel af is, groeit met één rij per regel, en eerder
geparseerde rijen wijzigen niet meer. Een eventuele oplossing (de laatste, nog
onafgemaakte regel negeren zolang het antwoord streamt) is bewust uitgesteld: stap 0 van
deze tranche mocht het gedrag niet wijzigen.

## 4. Opmaak

### 4.1 Tabellen

Een markdown-pipe-tabel rendert met de bestaande stuurinformatie-klassen `si-tabel` plus de
modifier **`si-tabel-gesloten`**. Die modifier bestaat omdat `.si-tabel` de tabel alleen
afsluit via `thead` (bovenhoeken) en `tfoot`/`.si-totaalrij` (onderhoeken en zijranden). Een
AI-tabel heeft geen totaalrij en zou dus open zijkanten en vierkante onderhoeken houden.
Bewust een aparte klasse: de bestaande stuurinformatie-tabellen blijven ongemoeid.

`.si-tabel` zet zelf geen `text-align` op `th`; alle gebruikers zetten die per cel. De
AI-renderer volgt die conventie (`text-left`, of `si-num`).

**Uitlijning is deterministisch en komt uit de celinhoud** — geen modelbeslissing, geen
promptinstructie. `numeriekeKolommen()` geeft een kolom `si-num` (rechts uitgelijnd,
tabulaire cijfers) als **alle** niet-neutrale bodycellen matchen op datum, bedrag,
percentage, kaal getal of duur ("6 weken"), en er minstens één zo'n cel is. Neutrale
cellen — leeg, `-`, `–`, `—`, `n.v.t.`, `nvt`, `n/a`, `onbekend`, `pm`, `p.m.` — breken
de kolom niet, maar dragen hem ook niet. De kopcel volgt de kolom.

De regel is bewust conservatief. Niet herkend (en dus links uitgelijnd): `circa 6 weken`,
`6 weken en 3 dagen`, `18-09-2026 (onder voorbehoud)`. Omgekeerd matcht het kale-getal-
patroon ook een referentie- of telefoonnummer; die krijgen dan rechtse uitlijning.

### 4.2 Leesritme

- **`.ai-lees`** — `max-width: 68ch` op alinea's, lijsten en koppen. Tabellen, bronkaarten
  en het onderbouwingspaneel houden de volle kolombreedte. In de smallere agendapuntchat is
  de container zelf al smaller; `max-width` laat die dan leidend zijn.
- **`tabular-nums`** staat op de hele leeskolom in plaats van op gedetecteerde getallen:
  deterministisch, geen heuristiek die soms misgrijpt.
- **`.ai-kop`** — kopjes met een rustig accentstreepje van 26 × 2 px erboven.

Koppen renderen als **`<h4>`**, niet meer als vetgedrukte alinea, zodat schermlezers erop
kunnen navigeren. Alle markdown-niveaus (`#` t/m `######`) landen op `h4`: de kopniveaus van
het model zijn geen documenthiërarchie en zouden de paginastructuur anders vervuilen.

### 4.3 Blokomhulling

Elk blok zit in een `<div class="ai-blok group">`. Die omhulling staat er **altijd** —
ook tijdens het streamen en ook wanneer er geen kopieerknop is. Reden: zou de wrapper
pas verschijnen zodra het antwoord af is, dan verandert op dat moment het elementtype
op elke key en bouwt React de hele antwoordboom opnieuw op, met een zichtbare hik aan
het eind van elk antwoord.

De omhulling draagt bovendien de leesmaat (`.ai-lees`, behalve bij tabellen) en
positioneert de kopieerknop absoluut in de rechterbovenhoek. Dat de maat op de
omhulling zit en niet op het blok is geen detail: anders zou de knop in `/ai` op de
rand van de 1020px-container landen in plaats van naast de tekst.

Eén CSS-valkuil die hieruit volgt en die is dichtgezet: `.ai-kop:first-child` zou door
de omhulling **elke** kop treffen (een kop is altijd het eerste kind van zijn eigen
wrapper) en zo het kopritme uitschakelen. De regel staat daarom op
`.ai-blok:first-child > .ai-kop`.

### 4.4 Tokens

Zie besluit [`0097`](./decisions/0097-tokens-mark-en-app-line-control.md): `--mark` en
`--app-line-control`, beide buiten `THEMABARE_TOKENS`, bewaakt door
`core/lib/kleurcontrast.sanity.ts`.

## 5. Kopiëren

Zie besluit [`0098`](./decisions/0098-kopieren-uit-de-chat-zonder-logging.md). Kern:

- twee formaten (`text/html` met echte `<table>`, `text/plain` met tabs), met twee
  terugvallen en eerlijke terugkoppeling over welk pad het werd. De drie
  uitkomsten zijn *"Gekopieerd, met opmaak en bronvermelding."*, *"Gekopieerd als
  tekst, met bronvermelding. Uw browser ondersteunt geen opgemaakte kopie."* en
  *"Kopiëren is niet gelukt."*;
- **bronnenlijst en herkomstregel zijn niet uitschakelbaar** — geen parameter, geen
  instelling, geen per-fonds configuratie, afgedwongen via een type-merk op
  `KopiePayload` én een runtime-controle in `schrijfNaarKlembord()`;
- de bronnenlijst steunt **niet alleen op `[Bron N]`-markers**: in de
  document-scope-modi verbiedt de systeemprompt die notatie, en een op markers
  gebaseerde lijst zou het antwoord daar ten onrechte als bronloos presenteren;
- **een kopieeractie wordt niet gelogd**; dat is een expliciet besluit met een aanvaard
  gevolg, en de herkomstregel in de tekst is daarvan de tegenhanger;
- alleen een **voltooide** generatie is kopieerbaar — niet tijdens het streamen, niet
  op de welkomsttekst, niet op een foutmelding en niet op een afgebroken antwoord.

## 6. Wat hier bewust NIET in zit (tranche 1)

**Tranche 1** wijzigt niets aan prompts, systeemprompt-blokken, retrieval, RPC's, filtering
vóór retrieval, de zeven antwoordmodi en hun detectie, document-scope, RLS, datamodel of
migraties. Er komt **wél één nieuwe functie bij**: kopiëren — en dat is bovendien het enige
uitgaande pad zonder registratie (zie `mvp-beperkingen.md` §5). De rest verandert alleen hoe
bestaande data wordt getoond.

Voor **tranche 2A** geldt dezelfde lijst ongewijzigde onderdelen, met één uitzondering: de
inhoud van `Bron.fragment` (besluit `0100`, §8.5). Dat is een payloadwijziging — geen
kolom, geen contract, alleen de waarde.

Voor **tranche 2B** komen daar twee doorgegeven velden bij, `documenttype` en
`bestandstype` (§9.6), plus de bronkaartvelden die `documentBronnen()` niet vulde. Nog
steeds geen kolom, geen migratie en geen wijziging aan retrieval, ranking, filtering,
prompt of antwoordmodusdetectie.

**Tranche 2C** raakt uitsluitend de renderlaag: geen payload, geen nieuwe tokens, geen
retrieval, geen datamodel. Alleen hoe bestaande data eruitziet (§10).

Uitgesteld naar een volgende tranche (visuele referentie
[`prototypes/ai-assistent-grafische-optimalisatie.html`](./prototypes/ai-assistent-grafische-optimalisatie.html),
annotaties 4 t/m 8): het hover-fragment op de
`[Bron N]`-pill, een afgeleid pill-label, de gestippelde concept-rand, de herziene
bronkaarten in twee kolommen, en de informatievere ingeklapte onderbouwingsbalk. Die vragen
óf een payloaduitbreiding (`documenttype`) óf een herziening van de bronkaart zelf.

> **Alles hiervan is inmiddels gerealiseerd:** het hover-fragment, de gestippelde rand en
> de tweekolomskaarten in tranche 2A (§8), de informatievere balk eveneens in 2A, en het
> afgeleide pill-label in tranche 2C (§10.1) — dat laatste kon pas nadat 2B `documenttype`
> in de payload bracht.

## 7. Referenties

- Besluiten [`0079`](./decisions/0079-agenda-assistent-gedeelde-weergave.md),
  [`0097`](./decisions/0097-tokens-mark-en-app-line-control.md),
  [`0098`](./decisions/0098-kopieren-uit-de-chat-zonder-logging.md),
  [`0099`](./decisions/0099-documenten-in-het-antwoord-bij-bronoverzicht.md),
  [`0100`](./decisions/0100-fragmentlengte-op-zinsgrens.md)
- ADR 0028 (`[Toelichting agendapunt]`), OP-4 (`[Organisatieprofiel]`), increment I-3
  (instantie op de kennis-pill)
- Suites: `core/lib/antwoord-parser.sanity.ts`, `core/lib/antwoord-klembord.sanity.ts`,
  `core/lib/kleurcontrast.sanity.ts`, `core/lib/bronfragment.sanity.ts`,
  `core/lib/bronsamenvatting.sanity.ts`, `core/lib/documentlijst.sanity.ts`
- Tranche 2A-modules: `core/lib/bronfragment.ts` (het citaat),
  `core/lib/bronsamenvatting.ts` (de ingeklapte balk) — zie §8
- Tranche 2B-module: `core/lib/documentlijst.ts` (ordening en filtering van de
  documentlijst) — zie §9
- Tranche 2C: `pillLabelVoor()` in `core/lib/bronsamenvatting.ts` (§10.1); de
  contrastafspraken van de pill zijn vastgepind in `core/lib/kleurcontrast.sanity.ts`

## 8. Bronverificatie in de renderlaag (tranche 2A)

Een bewering controleren kostte vier handelingen: paneel openklappen, scrollen, de juiste
bronkaart zoeken, citaat lezen. Alle benodigde data zat al in de client. Wat er is veranderd:

### 8.1 Hover-preview op de `[Bron N]`-pill

Het native `title`-attribuut is vervangen door een eigen preview (`BronPreview` in
`AntwoordWeergave.tsx`). `title` voldoet niet aan **WCAG 1.4.13**: hij is niet hoverbaar,
niet met Escape te sluiten en op sommige platforms te kort zichtbaar. De preview toont
titel, status, vindplaats, het citaat in een citaatbalk en de benoemde openen-actie.

Twee constructiekeuzes die niet vrijblijvend zijn:

1. **`position: fixed`, geen `absolute`.** Het antwoord staat in béíde surfaces in een
   scrollcontainer (`/ai`: `flex-1 overflow-y-auto`; agendapuntchat: `max-h-96
   overflow-y-auto`) en tabellen in `overflow-x-auto`. Een absoluut gepositioneerde preview
   wordt daar afgeknipt. De coördinaten komen uit `getBoundingClientRect()` en worden
   herberekend op `scroll` (capture) en `resize`. **Bekende grens:** komt er ooit een
   `transform`, `filter` of `perspective` op een voorouder, dan wordt díé het containing
   block en verschuift de preview mee. Vandaag staat die er niet.
2. **De preview is een sibling van de pill, geen kind.** Er staat een link in, en een `<a>`
   in een `<button>` is ongeldige HTML die de tabvolgorde breekt. Omdat hij wél in dezelfde
   wrapper-`<span>` zit, gelden mouseenter/mouseleave en focus voor het geheel — precies wat
   "hoverbaar" en "persistent" vragen. Sluiten gebeurt met ~150 ms uitstel, zodat de muis de
   kier van 8 px kan oversteken.

**Dismissible zonder de focus te verplaatsen.** De Escape-handler hangt aan `document`, niet
aan de wrapper. Een preview die met de muis is geopend heeft namelijk géén focus; een handler
op de wrapper zou dan nooit vuren en 1.4.13 blijft onvervuld — precies het gebrek waarvoor
`title` is vervangen. De listener doet bewust geen `stopPropagation`, zodat de Escape van de
@-mention-typeahead in `AssistentClient` ongemoeid blijft. Focus keert alleen terug naar de
pill als die er al was.

**De beschrijving staat er altijd, ook dicht.** `aria-describedby` wijst naar een permanente
`sr-only`-span met titel, status, vindplaats en citaat. Zou het attribuut pas bij het openen
worden gezet, dan heeft de schermlezer de focusmelding al samengesteld en valt juist het
citaat weg. De zichtbare preview draagt daarom geen `role="tooltip"` (die rol mag geen
interactieve inhoud bevatten) en zijn tékst is `aria-hidden`; de openen-link blijft gewoon
in de tabvolgorde staan.

Een klik op de pill sluit de preview en voert daarna het bestaande gedrag uit (paneel openen
+ scroll + highlight, ongewijzigd). Zonder dat sluiten zou de preview — via de
scroll-listener — meereizen en de bronkaart afdekken waar net naartoe is gescrold; op touch
is dat het normale pad, want daar is er geen hover maar wél focus.

**Logging:** hover, focus en klik op de pill worden **niet** vastgelegd — het zijn
leeshandelingen, geen besluiten. Het **openen van het origineel** wordt wél gelogd, en dat is
geen nieuw gedrag van deze tranche: de benoemde actie wijst naar de bestaande route
`/api/documents/<id>/bestand`, die een `document_inzage`-rij schrijft (fonds, gebruiker,
titel-snapshot, `actie: "inzage"`). Deze tranche voegt daar geen logging aan toe en haalt er
geen weg.

### 8.2 Ontbrekend fragment — een melding zonder dekkingsclaim

`Bron.fragment` is leeg op twee paden: `documentBronnen()` in `app/api/chat/route.ts` (de
**dekkingsbrede document-scope**, increment 2 — daar draait `maakContext()` niet en wordt één
bronkaart per *document* gebouwd in plaats van per chunk; `pagina` en `paragraaf` zijn er óók
leeg), en een besluitregistratiebron zonder ingevulde besluitvraag
(`core/lib/besluitvorming-bron.ts`).

Dat gedrag is correct en bewust. Maar een leeg citaat zou suggereren dat er niets te citeren
valt. Preview en bronkaart tonen daarom: *"Geen losse passage als citaat aangewezen — zie de
verwijzingen in het antwoord."*

Die formulering doet **bewust geen uitspraak over dekking**. Een eerdere versie zei "het
volledige document is als bron gebruikt", en dat sprak het antwoord tegen: past een document
niet in `MAX_BATCHES`, dan zet de route `breedAfgekapt` en instrueert ze het model juist te
melden dát de dekking gedeeltelijk is. De bronkaart weet dat niet — `breedAfgekapt` reist
niet mee in de payload — en mag er dus ook niets over beweren.

### 8.3 Geen actuele grondslag, zichtbaar zonder klik

Een pill naar een bron die **geen actuele, vastgestelde grondslag** is, krijgt een
**gestippelde rand**; dezelfde status staat als tekst in de beschrijving. Kleur is nooit de
enige drager.

Dat is een **allow-list, geen deny-list**: `ACTUELE_BRON_STATUSSEN` (`vastgesteld`,
`van_kracht`) — dezelfde twee waarden die `rag.ts` voor de retrieval-filtering gebruikt.
Alles daarbuiten wordt gemarkeerd. Een
deny-list van drie conceptstatussen liet de ónderkant van de ladder onbewaakt: `vervangen`,
`alleen_historisch` en `gearchiveerd` zagen er dan uit als van kracht — juist het geval
waarin een bestuurder op verouderd beleid vaart. Meegewogen worden ook `bronstatus ≠ actief`
en een verstreken `geldig_tot`. Dat zijn drie van de vier toetsen van `zouActueelZijn()` in
`rag.ts`; **`geldig_vanaf` weegt bewust niet mee** — een document dat pas in de toekomst in
werking treedt wordt door retrieval al weggefilterd en komt hier dus niet als bron langs.
Kanttekening: de twee waarden staan in twee constanten (`ACTUELE_BRON_STATUSSEN` en
`ACTUELE_STATUSSEN_RAG`), met dezelfde inhoud; `rag.ts` waarschuwt daar zelf voor.

Twee randgevallen:

- **Onbekende status wordt níét gemarkeerd.** Markeren betekent "let op, niet vastgesteld",
  en dat is bij ontbrekende data net zo goed een ongefundeerde bewering als het omgekeerde.
  De beschrijving zegt dan expliciet dat de status niet is meegeleverd. Bij het schrijven van
  2A gold dat nog voor het hele dekkingsbrede pad; tranche 2B heeft dat opgelost — zie §9.7.
- **De besluitregistratie zet een Decision Object-status in het `documentstatus`-veld.** Die
  hoort in een ander domein thuis (`besloten` is daar de vastgestelde grondslag, niet
  `vastgesteld`). Zonder aparte behandeling zou de ruwe enum-waarde ("in_onderbouwing") in de
  beschrijving en het `aria-label` belanden. `statusOordeel()` herkent die bron aan
  `bron === "Decision Object"` en gebruikt `DECISION_STATUS_LABEL` +
  `mapDecisionToProcedureStatus`.

### 8.4 Bronkaarten en de ingeklapte balk

De bronkaart is **neutraal** geworden (witte kaart, kleurloze rand); de organisatiekleur zit
nog uitsluitend in het nummerbolletje. Het fragment staat in een citaatbalk, de chips op één
rij, en het losse `↗` is een benoemde actie ("Openen op pagina 14"). In `/ai` staan de
kaarten in twee kolommen (`bronKolommen={2}`), in de agendapuntchat in één — dat is de
default van de prop.

De kaart is daarbij van `<a>` naar `<div>` gegaan. Dat loste twee dingen op: de openen-actie
had geen naam, en `BronkaartMeta` rendert bij generieke bronnen een "Externe bron ↗"-link —
een `<a>` genest in een `<a>`, ongeldige HTML die in schermlezers onvoorspelbaar navigeert.
Het scroll-anker (`idVoorScroll`) zit ongewijzigd op de buitenste kaart.

Twee kolommen betekent `md:grid-cols-2` — onder `md` blijft het één kolom, ook in `/ai`.

De **ingeklapte** samenvattingsbalk toont nu aantal, documentnamen en `bronbasis` (die
laatste vanaf `lg`; op smallere schermen zou de balk anders over twee regels breken). De
documentnamen komen uit `samenvattingDocumentnamen()` in `core/lib/bronsamenvatting.ts` —
een pure functie in `core/` en niet in het component, zodat de regel getest kan worden
(`bronsamenvatting.sanity.ts`). Die functie **ontdubbelt**, en dat is wezenlijk, geen
cosmetiek: één document levert vaak meerdere chunks en dus meerdere bronnen, en zonder
ontdubbeling zou de balk driemaal dezelfde titel tonen en de indruk wekken dat het antwoord
op drie stukken steunt. Wat niet past wordt "+N meer", waarbij N **unieke documenten** telt.

Bewust géén retrievalmethode in de balk: die leeft uitsluitend server-side in
`retrieval_meta` (auditspoor) en tonen zou een payloaduitbreiding vragen. Het paneel blijft
standaard ingeklapt (Increment I-1, FO §11c).

### 8.5 Fragmentlengte

Zie besluit [`0100`](./decisions/0100-fragmentlengte-op-zinsgrens.md) en
`core/lib/bronfragment.ts`: afkappen op zinsgrens binnen 300 tekens, terugval op woordgrens,
en een **afkapmarkering zodra er tekst is weggelaten — ook als het citaat toevallig netjes op
een punt eindigt**. Dat laatste is een governance-eis, geen typografie: "Het bestuur stelt de
regeling vast." leest als een compleet citaat, terwijl de weggevallen volgende zin "Deze
regeling geldt niet voor deelnemers die vóór 2020 zijn uitgetreden." de strekking omkeert.
Beide reviews vonden dit onafhankelijk van elkaar.

Dit is de enige payloadwijziging van deelopdracht A. Het fragment gaat **niet** naar de
prompt, dus er zijn geen modelkosten. Gemeten op een echt antwoord met tien bronnen:
2.928 tekens tegen 1.530 onder de oude regel — **+1.398 bytes**.

De regel geldt op alle paden die een citaat vúllen: `maakContext()` in `core/lib/rag.ts` én
`opmaakBesluitContext()` in `core/lib/besluitvorming-bron.ts` — anders zou juist de bron met
het hoogste normgewicht als enige stil afkappen. `documentBronnen()` bouwt óók een
`BronVerwijzing`, maar laat het fragment bewust leeg (§8.2).

### 8.6 Twee layoutcorrecties die hierbij hoorden

- **De documentscroll op `/ai`.** De pagina kon voorbij het chatvenster scrollen — gemeten op
  een gesprek van 29 berichten: **6.187 px lege scroll**. Oorzaak: de aria-live-melding van
  "Antwoord kopiëren" (`<span class="sr-only">` in `KopieerKnop`) is absoluut gepositioneerd
  en staat in de **actiebalk**, dus buiten `.ai-blok` — dat als enige onvoorwaardelijk
  `position: relative` draagt (`globals.css`). Zonder gepositioneerde voorouder is haar
  containing block het viewport: ze ontsnapt aan de clip van de scrollcontainer en rekt het
  document op tot de volle hoogte van de gespreksinhoud. De kopieerknoppen *per blok* zitten
  wél in `.ai-blok` en waren nooit het probleem. `position: relative` op beide
  scrollcontainers brengt de overflow terug naar 0.
- **De 56 px onder `md`.** `min-h-screen` op de shell-`<main>` is border-box, dus de `pt-14`
  valt daarbinnen — maar het `h-screen`-kind telde er bovenop. Nu
  `h-[calc(100vh-3.5rem)] md:h-screen`. Bewust dezelfde eenheid als de `<main>`: zou het kind
  op `dvh` staan terwijl de `<main>` op `100vh` blijft, dan houdt die op mobiel met
  uitgeschoven browserbalk een resthoogte van (lvh − dvh) over — precies de restscroll die
  hier wordt weggenomen. Overstappen op `dvh` kan, maar dan in `DashboardShell` én hier.
- **`min-w-0` op de AI-kolom.** Een flex-item krimpt niet onder zijn min-content-breedte;
  zonder dit duwde het tweekolomsraster van de bronkaarten de 1020px-kolom uit.

### 8.7 Openstaand na deelopdracht A

Uit de governance-review, bewust doorgeschoven omdat het payloadwijzigingen zijn en
deelopdracht A de renderlaag betreft:

- ~~`documentBronnen()` vult de statusvelden niet.~~ **Opgelost in tranche 2B** (§9.7):
  `documentBronnen()` vult ze nu, en `verrijkDocumentmetadata()` vult `documentdatum`,
  `geldig_tot`, `normgewicht`, `bronorganisatie` en `extern_url` aan — die staan namelijk
  níét in de select van `haalDocumentChunks()`.
- Het auditspoor kent geen versiemarkering op het fragment: twee logregels met een
  verschillende afkapregel zijn niet als zodanig herkenbaar. Reconstrueerbaar via de datum
  van besluit 0100.
- Een citaat blijft door de applicatie geconstrueerd. De afkapmarkering plus de openen-actie
  zijn de mitigatie; ontbreekt het origineel (`heeft_origineel = false`), dan is er geen
  controlepad.

## 9. Documentvraag als documentlijst (tranche 2B)

Bij een vraag als *"welke stukken hebben we over de compensatieregeling?"* **zijn** de
documenten het antwoord. Ze stonden ingeklapt onder een alinea die de titels in proza
herhaalde. Zie besluit [`0099`](./decisions/0099-documenten-in-het-antwoord-bij-bronoverzicht.md).

### 9.1 De modus wordt gelezen, niet bepaald

`bronoverzicht` bestond al: server-side bepaald in `core/lib/vraagtype.ts`, meereizend in
het `meta`-event, en al zichtbaar als rij in het onderbouwingspaneel. De weergave leest
`onderbouwing.antwoordmodus` van hét bericht — geen nieuwe state, geen API-veld, geen
tweede plek waar iets over de modus wordt besloten. `ANTWOORDMODUS_PATRONEN`,
`bepaalAntwoordmodus` en de drempels zijn niet aangeraakt.

De lezer `leesAntwoordmodus()` staat sinds deze tranche in de gedeelde renderer en is
gebouwd op de bestaande constante `ANTWOORDMODI`. Hij stond eerder als kopie in
`AssistentClient` mét een hard gecodeerde lijst modusnamen; de agendapuntchat heeft hem
nu ook nodig, en twee lijsten zouden vroeg of laat uiteenlopen.

### 9.2 Anti-dubbeling

Staan de documenten in het antwoord, dan houdt het paneel alléén de verantwoording. Het
meldt dat expliciet (`bronnenInAntwoord`) — de bestaande fallbacktekst *"Geen interne
documentbronnen geraadpleegd"* zou daar feitelijk onjuist zijn: ze zijn juist wél
geraadpleegd en staan hierboven. Bij elke andere antwoordmodus is de weergave identiek aan
die na tranche 2A.

### 9.3 Ordening: deterministisch en totaal

`groepeerDocumentbronnen()` in `core/lib/documentlijst.ts`:

1. **Ontdubbelen op `document_id`** — één document levert vaak meerdere chunks en dus
   meerdere bronvermeldingen. De eerste treffer wint; de bronnenlijst komt in
   rangschikkingsvolgorde binnen, dus dat is de best scorende passage.
2. **Groeperen op `documenttype`**, in de canonieke `DOCUMENTTYPEN`-volgorde, met
   "Type nog niet vastgelegd" altijd achteraan.
3. **Sorteren** op `documentdatum` aflopend, zonder datum onderaan, met titel en
   `document_id` als tiebreak.

Stap 3 maakt de ordening **totaal**: zonder die tiebreak zouden twee stukken met dezelfde
datum van sorteerimplementatie kunnen wisselen, en dan geeft dezelfde bronnenset niet
gegarandeerd dezelfde lijst. Er staat bewust **geen `localeCompare`** in: de ICU-collatie
verschilt per Node-build en zou het resultaat onreproduceerbaar maken. `documentdatum`
wordt lexicografisch vergeleken; dat mag omdat de kolom een `date` is en dus als
`JJJJ-MM-DD` binnenkomt.

**Waarom niet op `context` (dossier/vergadering/algemeen):** dat zegt wáár een stuk is
opgeborgen, niet wát voor stuk het is; drie groepen over vier tot tien documenten voegt
weinig toe; en `context` zit niet in de payload. Eerlijk tegenargument: `context` ís
gebackfilld en `documenttype` niet — zie §9.5.

### 9.4 Filteren is weergave, scope is een vervolgactie

De chips ("Alle" / "Alleen vastgesteld") werken uitsluitend op de al opgehaalde set. Geen
fetch, geen nieuwe retrieval, geen wijziging aan de filtering vóór retrieval. De teller
toont altijd "n van m", zodat zichtbaar blijft hoeveel er is weggefilterd. "Vastgesteld"
gebruikt dezelfde `ACTUELE_BRON_STATUSSEN` als de pill-markering (§8.3).

"Vraag hierover" en "Vraag over deze N documenten" zetten de bestaande client-scope en
zetten de cursor in het invoerveld. Ze **versturen niets**: de bestuurder formuleert zelf
de vraag. De server-side validatie (`valideerScope`) blijft onverkort leidend en draait
pas bij het versturen; een geweigerd document geeft daar de bestaande zichtbare fout —
nooit een stille terugval. In de agendapuntchat ontbreken deze knoppen bewust: daar ís de
scope al vast, en versmallen zonder dat erom gevraagd wordt zou de context stilletjes
veranderen.

### 9.5 Ontbrekende waarden

`documenttype` is nullable en **niet gebackfilld** zolang de metadata-review-queue niet is
doorgewerkt; `bestandstype` is `not null` met default `'pdf'` en in de praktijk altijd
gevuld. Regel: een ontbrekend veld levert **nooit** een lege chip, een lege badge of een
gebroken kaart — het element blijft simpelweg weg. Eerste live meting op Horizon: één van
zes documenten had een type; de rest viel in de restgroep en werd op datum geordend.

### 9.6 De payloaduitbreiding

`verrijkDocumentmetadata()` in `core/lib/rag.ts` haalt `documenttype` en `bestandstype` op
in één gebatchte vervolgquery op de unieke document-id's — patroon van
`verrijkNotulenChunks()`. Reden: `zoek_chunks` en `zoek_chunks_hybride` hebben een vaste
`returns table`, en een kolom toevoegen aan een RPC-return vereist `drop function` +
`create`, dus een migratie.

De functie zit ná de splitsing in retrieval-paden: RPC, fallback-cascade en parent-context
komen daar samen, zodat "geen pad gemist" voor die drie structureel is in plaats van een
controle per select. Eerlijk: het **dekkingsbrede pad heeft een eigen aanroep**
(`app/api/chat/route.ts`, in de `breedActief`-tak). Er zijn dus twee call-sites, en die
tweede moet je bij een wijziging bewust meenemen.

De velden zijn pure doorgeefwaarden: nergens gelezen door retrieval, ranking, filtering of
promptopbouw. De verrijking draait ná `handhaafFondsdiscipline` en ná `naVerwerking`, en
`maakContext()` bouwt de modelcontext uit expliciet benoemde velden. RLS blijft leidend
(anon-client); faalt de query, dan valt de weergave netjes terug.


### 9.7 Wat de reviews aan B veranderd hebben

Drie bevindingen raakten de verantwoordbaarheid direct en zijn vóór oplevering hersteld:

- **De `[Bron N]`-pill werd een dode verwijzing.** Met de bronkaarten uit het paneel
  bestonden de ankers `bron-{i}-{j}` niet meer, dus een klik opende een leeg paneel. De
  documentkaart draagt nu een anker per bronvermelding die naar dat document wijst
  (`Documentregel.bronnummers`) en licht op bij een klik. Ontdubbeling betekent dat
  meerdere pills op dezelfde kaart landen — daarom een anker per nummer, niet één per kaart.
- **Het paneel beweerde iets dat er niet stond.** `bronnenInAntwoord` volgde alleen de
  modus, terwijl de lijst pas verschijnt bij een voltooid antwoord mét documentbronnen.
  Tijdens het streamen, bij een afgebroken antwoord en bij nul treffers claimde het paneel
  dus een lijst die er niet was — én verborg het tegelijk de bronkaarten. Beide surfaces
  gebruiken nu één gedeelde conditie, `documentlijstZichtbaar()`.
- **De besluitregistratie is geen document.** `opmaakBesluitContext()` levert bronnen met
  `bron: "Decision Object"` en een `decision_id` in het `document_id`-veld. In de lijst
  zouden die de document-scope laten falen op `niet_gevonden` (en dus de héle vervolgvraag
  blokkeren), en het filter "alleen vastgesteld" zou een `besloten` besluit juist
  verbergen. Ze zijn nu uitgesloten van de lijst (`isDocumentbron()`) en blijven als
  bronkaart in het paneel staan — de formeel zwaarste bron mag niet verdwijnen.

Verder aangescherpt: het filter weegt nu dezelfde drieslag als de pill (status, bronstatus,
verlopen geldigheid) in plaats van alleen `documentstatus`; documenten zónder status worden
apart geteld ("3 van 6 · 2 zonder status") in plaats van stil weggefilterd; de kaart
hergebruikt `BronkaartMeta`, zodat normgewicht, bronsoort, bronorganisatie en vooral de
"Externe bron ↗"-link niet verdwijnen — voor een generiek kader zonder lokaal origineel is
die link het enige pad naar het stuk; en `documentBronnen()` vult nu ook de bronkaartvelden,
zodat het dekkingsbrede pad niet als enige zonder status en datum in de lijst staat.

Boven de lijst staat een voorbehoud: *"De stukken die bij deze vraag zijn opgehaald — geen
uitputtend overzicht van de bibliotheek."* Zonder die regel leest een lijst met groepskoppen
en aantallen als een inventaris, terwijl het de opbrengst van maximaal `CHUNK_BUDGET`
chunks is.

### 9.8 Logging bij de documentlijst

Ongewijzigd ten opzichte van §8.1, hier expliciet omdat de lijst tot tien openen-acties per
antwoord zichtbaar maakt:

- **Filteren** is een leeshandeling en wordt niet vastgelegd.
- **Het openen van een document** loopt via de bestaande route `/api/documents/<id>/bestand`
  en schrijft daar een `document_inzage`-rij (fonds, gebruiker, titel-snapshot).
- **De scope zetten** logt op zichzelf niets; bij de eerstvolgende vraag landt hij in
  `governance_log.retrieval_meta.scope`, inclusief `algemene_kennis`.

`scopeUitDocumentlijst()` zet `algemene_kennis: true` (zichtbaar als aangevinkte optie op de
scope-chip) en wist een actieve agendapuntcontext — de vraag gaat immers over dít document,
niet meer over het agendapunt.

## 10. Visuele rust (tranche 2C)

Drie ingrepen uit de visuele referentie
[`prototypes/ai-assistent-grafische-optimalisatie.html`](./prototypes/ai-assistent-grafische-optimalisatie.html),
op verzoek van de opdrachtgever. Alle drie renderlaag; geen nieuwe tokens.

### 10.1 De bronvermelding wordt tekst

De pill droeg alleen een nummer. *"Zoals vastgesteld [3]"* dwingt de lezer het nummer te
onthouden en elders op te zoeken. De pill toont nu een nummerbolletje **plus** een afgeleid
label (`pillLabelVoor()` in `core/lib/bronsamenvatting.ts`): bij voorkeur documenttype +
datum ("Notulen 11-07"), anders de titel, afgekapt op 32 tekens en visueel op 160 px. Het
nummer blijft staan — dát koppelt de bewering aan de bronkaart en aan het auditspoor.

Zolang `documenttype` niet is gebackfilld valt het label terug op de (soms technische)
bestandstitel; dat wordt vanzelf beter naarmate de metadata-review-queue vordert.

### 10.2 Rustiger kleur

De pill volgt nu de referentie: `warn-tint` met een rond nummerbolletje in `warn`, in plaats
van een violet blokje. De accentkleur bleef daardoor gereserveerd voor bediening in plaats
van voor markeringen in lopende tekst. De gestippelde rand bij een niet-actuele grondslag
(§8.3) blijft ongewijzigd werken.

### 10.3 De eigen vraag als rustig blok

De vraagbubbel was massief violet en trok in een lang gesprek meer aandacht dan het antwoord
eronder. Nu `app-zebra` met een hairline — dezelfde behandeling als in de referentie. De
positie (rechts uitgelijnd) is níét gewijzigd; de referentie zet de vraag links met een
avatar, maar dat is een layoutkeuze die losstaat van de kleurvraag.
