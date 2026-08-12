# 0172 — Documentselectie wordt onderwerp in plaats van afbakening, en conceptstukken worden vindbaar met label

- **Status:** Geaccepteerd
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin (product/architectuur), Claude (analyse en uitvoering)
- **Raakt:** [`0028`](./0028-agendapunt-modus.md) (agendapunt-modus als niet-strict pad), increment 1/2 documentscope, en de acceptatiecriteria in `03 Functioneel ontwerp/Bestuurdersportaal - AI-vragen over een specifiek document ontwerp v0.2.md`

## Context

Twee klachten uit de praktijk, die bij analyse dezelfde wortel bleken te hebben.

**1. Een documentselectie maakte de assistent dommer.** Koos een bestuurder in de
bibliotheek een stuk, dan beantwoordde de assistent alleen nog vragen uit dát stuk.
De afbakening zat op vijf lagen tegelijk: `p_document_ids` in `zoek_chunks` en
`zoek_chunks_hybride` (vóór de ranking), de scope in `rag.ts`, alle vier de
fallbackpaden in `zoekViaFTS`, de systeemprompt (*"zoek niet stilletjes breder"*)
en het ontbreken van elke terugval bij nul treffers. Vergelijken, verbinden en
duiden — precies waarvoor een bestuurder een stuk openslaat — was daarmee
onmogelijk.

**2. Conceptstukken, en dus vrijwel alle vergaderstukken, waren onvindbaar.**
Vijf oorzaken gestapeld:

- `retrievalModusVoor()` geeft voor vrijwel elke vraag `"actueel"`, en dat filtert
  in alle drie de RPC-armen op `documentstatus in ('vastgesteld','van_kracht')`.
- Vergaderstukken zijn geen aparte entiteit maar een rij in `documenten` met
  `agendapunt_id`; het vergaderstuk-uploadpad levert geen `status` mee, dus de
  DB-default `'concept'` blijft staan. Ze zijn daarmee **per constructie**
  onvindbaar in de standaardmodus.
- De enige ontsnapping, `VOORSTELVRAAG_PATRONEN`, brak op Nederlandse
  samenstellingen: `/\bconcept(?:en|stuk|…)?\b/` matcht `conceptstuk` wél en
  `conceptnotulen` niet. Vergaderstuk-vocabulaire (`vergaderstuk`, `oplegnotitie`,
  `bestuursstuk`) ontbrak volledig.
- De compensatietelling `telNietActueleFondstreffers` vuurde alleen bij **exact
  nul** fondstreffers; één vastgesteld stuk maakte een conceptstuk over hetzelfde
  onderwerp onzichtbaar én onvermeld, en de verbredingschip onbereikbaar.
- `maakContext` zette de documentstatus **niet** in de prompt. Kwam een conceptstuk
  er toch doorheen, dan kon het model niet zien dat het een concept was.

## Overweging

De strikte afbakening was ooit bedoeld als betrouwbaarheidsgarantie. Bij analyse
houdt die redenering geen stand: elke uitspraak draagt al een `[Bron N]`-marker, dus
"de assistent verzint iets" was nooit het reële risico. Het reële risico is
**versieverwarring** — een conceptbegroting en een vastgestelde begroting die naast
elkaar in de context staan en in het antwoord samensmelten, netjes gebrond en toch
misleidend.

Dat is een *herkomst*probleem, en dat los je op met een gescheiden antwoordopbouw
plus zichtbare status, niet met een muur om de retrieval. Dezelfde redenering geldt
voor de conceptstukken: het systeem loste onzekerheid op door dingen te verbergen,
terwijl tonen-met-etiket beter werkt. Een verborgen bron kan de gebruiker niet
beoordelen; een gelabelde bron wel.

Het bestaande codepatroon wees dezelfde kant op: `weeg-bronsoort.ts` draagt
letterlijk de regel *"GEEN harde uitsluiting: een lager gewogen bronsoort blijft
beschikbaar als AANVULLEND kader"*, en `fuseerHybridePogingen` is gebouwd op
"een extra poging voegt recall toe, neemt nooit weg". Status en documentidentiteit
waren de laatste twee assen die nog met een bijl werkten in plaats van een
weegschaal.

## Besluit

1. **Strict-document vervalt; documentselectie wordt primaire-documentmodus.**
   Het gekozen stuk is het ONDERWERP, de bibliotheek blijft beschikbaar. Er is
   geen strict-stand meer als optie of toggle — dat was een expliciete keuze:
   twee standen naast elkaar zou de uitleg richting bestuurders verdubbelen
   zonder dat iemand de strikte stand nog nodig heeft.

2. **Tweesporen-retrieval in de app-laag, géén wijziging aan de RPC's.**
   - *Spoor A (primair)* — byte-identiek aan het gedrag van vóór dit besluit:
     `p_document_ids` = het gekozen document, `filters = undefined`, budget
     `CHUNK_BUDGET`. De gebruiker koos dat stuk bewust, dus geen status- of
     actualiteitsfilter.
   - *Spoor B (aanvullend)* — de rest van de bibliotheek, mét de normale filters,
     met een **eigen** budget (`AANVULLEND_BUDGET = 5`) bovenop dat van spoor A.

   Beide sporen draaien parallel. Twee eigenschappen zijn hier de reden voor deze
   vorm: de verbreding kan de dekking van het hoofddocument **per constructie**
   niet verslechteren (eigen budget, geen verdringing), en er is **geen migratie**
   nodig — de bestaande RPC's blijven ongewijzigd, wat het terugdraaipad triviaal
   houdt.

3. **Het hoofddocument is expliciet vrijgesteld van het statusfilter.** Dit is
   geen detail maar de kern van de veiligheid van deze wijziging: zou de scope
   simpelweg vervallen, dan zou een bewust gekozen **conceptvergaderstuk** door
   modus `'actueel'` uit zijn eigen antwoord vallen. De vrijstelling zit in spoor
   A (`filters = undefined`), niet in een uitzondering elders.

4. **Herkomst en status worden zichtbaar gemaakt in de prompt, niet weggefilterd.**
   Elke bron draagt in de kop `[hoofddocument]` of `[aanvullend uit de bibliotheek]`,
   en bij afwijking een statuslabel (`[concept — nog niet vastgesteld]`,
   `[historisch — niet meer geldend]`, …). Enige bron: `core/lib/documentstatus-label.ts`.
   Alleen afwijkingen krijgen een label — een vastgesteld stuk is de norm en blijft
   kaal, anders verwatert het signaal. Een lege of onbekende status wordt expliciet
   benoemd en **niet** stil als geldend behandeld.

5. **Conceptstukken worden vindbaar via intentie én werkstand, nog niet via demotie.**
   - `VOORSTELVRAAG_PATRONEN` krijgt een open staart op `concept` (met negatieve
     lookahead voor `conceptueel`/`conceptualiseren`) en vergaderstuk-vocabulaire.
   - De verbredingstelling verliest de `fondsTreffers === 0`-drempel; de
     *melding* blijft wél voorbehouden aan het nul-treffers-geval, zodat er geen
     tweede melding onder een geslaagd antwoord verschijnt.
   - Nieuwe, zichtbare en persistente werkstand **"Stukken in voorbereiding
     meenemen"** in de assistent, die het bestaande serverveld
     `neem_niet_vastgestelde_mee` voor het hele gesprek zet.

   **Bewust NIET gedaan:** het harde statusfilter in de RPC's vervangen door een
   rangkorting (demotie). Dat is structureel het betere antwoord, maar vergt een
   migratie, het opruimen van drie gedupliceerde statusdefinities (SQL,
   `handhaafFondsdiscipline` regel 4, `zouActueelZijn`) en een evalronde vooraf en
   achteraf. Eerst meten hoe vaak de werkstand daadwerkelijk wordt aangezet; dat
   getal is de business case voor die stap.

6. **De primaire modus geldt ook in agendapunt-modus (ADR 0028).** De aan een
   agendapunt gekoppelde stukken waren daar een harde afbakening, met hetzelfde
   gevolg als bij de bibliotheek: *"hoe verhoudt dit voorstel zich tot het beleid
   dat we vorig jaar vaststelden?"* was onbeantwoordbaar, terwijl dat bij
   vergadervoorbereiding bijna de standaardvraag is. De gekoppelde stukken blijven
   het primaire materiaal (spoor A, ongefilterd — daar zit al `p_modus = 'alles'`,
   dus conceptvergaderstukken kwamen daar altijd al doorheen); de bibliotheek komt
   er aanvullend bij via spoor B met de bibliotheekfilters. Markering in de bronkop:
   `[gekoppeld stuk]` in plaats van `[hoofddocument]`.

   **Proces-modus (besluit 0151) blijft bewust hard afgebakend.** Daar zijn de
   bewijsstukken van een procedure de bron en weegt snapshot-integriteit zwaarder
   dan bredere duiding.

7. **De voorbereidingsroute filtert conceptstukken niet langer weg.**
   `app/api/agendapunten/[id]/voorbereiding/route.ts` (de chip "Stel mijn
   voorbereiding op") draait een eigen retrieval en stond hard op
   `modus: "actueel"` — precies het filter dat vergaderstukken uitsluit. Een
   vergadervoorbereiding gaat per definitie over stukken die vóórliggen, dus dit
   sloot het materiaal uit waar de functie voor bedoeld is. Nu `besluitvorming`,
   dat de actualiteitsfilter laat vallen en semantisch klopt in het auditspoor.
   De statuslabels dragen de nuance.

8. **Het brede pad (doorgronden/samenvatten) blijft ongewijzigd.** Dat pad laadt
   het volledige document en draait geen retrieval; "lees dit hele stuk" is een
   andere vraag dan "help mij dit stuk begrijpen in context". Openstaand punt of
   ook daar aanvullende bronnen wenselijk zijn.

## Gevolgen

- **Acceptatiecriteria wijzigen.** `03 Functioneel ontwerp/… v0.2` §6 eist dat de
  retrieval "fysiek alleen chunks uit het gescopete document" levert, en AC-148/158
  eisen "geen chunks uit andere documenten". Die criteria vervallen en moeten in een
  v0.3 worden vervangen door herkomst- en scheidingscriteria.
- **Kosten op het scope-pad verdubbelen** (tweede embedding + tweede rerank-call).
  Wandkloktijd niet: de sporen draaien parallel.
- **Auditspoor blijft sluitend.** `retrievalMeta.chunks` is de som van beide sporen —
  noodzakelijk, want dat veld voedt via `bepaalBronset` de bevroren reflectiebronset
  en de bronset-hash met SQL-spiegel in `reflectie_transitie()`. Zou hier alleen
  spoor A in staan, dan zou een reflectie de aanvullende bronnen niet terugzien
  terwijl ze wél in het antwoord zijn gebruikt. `retrievalMeta.scope` krijgt
  `modus: "primair"`; wat de verbreding toevoegde staat in het nieuwe top-level
  veld `retrievalMeta.aanvullend` (`{ chunks, documenten }`), dat óók voor de
  agendapuntchat wordt gevuld. Bewust NIET in `scope`: dat object wordt via
  `leesScopeDocumentIds` gelezen bij het bepalen van de bronset, en het in
  agendapunt-modus alsnog vullen zou de bronset-hash verschuiven.
- **Tenant-isolatie ongewijzigd.** Spoor B geeft dezelfde server-side geresolveerde
  `fondsId` en dezelfde filters mee als het gewone bibliotheekpad; er komt geen
  nieuwe query, RPC of policy bij. De cross-tenant suite moet dit bevestigen.
- **Terugdraaien** is één vlag-achtige ingreep: `AANVULLEND_BUDGET` op 0 zetten of
  het tweede spoor overslaan geeft exact het oude retrievalgedrag terug (de
  systeemprompt zou dan mee terug moeten).

## Openstaande punten

- Demotie in plaats van filtering (punt 5) — te plannen op basis van gebruiksdata.
- Statusverklaring mogelijk maken op het vergaderstuk-uploadpad, zodat `'concept'`
  niet langer een vergaarbak is die "net geüpload" en "ligt donderdag ter
  besluitvorming" niet onderscheidt.
- Titel/metadata doorzoekbaar maken (`zoek_vector` bevat alleen
  `context_prefix + tekst`, nooit `d.titel`). Los van dit besluit, maar het is de
  reden dat verwijzen naar een stuk bij naam niet helpt.
- Brede pad (doorgronden): wel of geen aanvullende bronnen.
- **Niet-geïndexeerde gekoppelde stukken worden stil weggelaten** (`route.ts`:
  alleen `actief && geindexeerd && heeft_chunks` overleeft), terwijl de UI
  "en N gekoppelde stukken" toont op basis van álle gekoppelde documenten. Teller
  en doorzochte set kunnen dus uiteenlopen zonder signaal — in strijd met het
  UX-principe "maak vereisten en blokkers expliciet". Bewust nog niet opgelost.
- Proces-modus: bewust hard gelaten; te heroverwegen als dezelfde klacht daar
  opduikt.
