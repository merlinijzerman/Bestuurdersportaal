# 0205 — De voorbereiding wordt een antwoordmodus, en haar uitkomst een bewaard product

- **Status:** Geaccepteerd
- **Datum:** 2026-09-04
- **Betrokkenen:** productowner (bestuurdersportaal), Claude Code
- **Volgt op:** [`0201`](./0201-assistent-in-drie-lagen.md) (de drie lagen),
  [`0204`](./0204-assistentpaneel-vier-standen-en-ingangen.md) (T1 — het paneel)
- **Issue:** [#304](https://github.com/merlinijzerman/Bestuurdersportaal/issues/304)

## Context

Na T1 was er nog één tweede AI-implementatie: de agendavoorbereiding liep niet door
`/api/chat` maar door `app/api/agendapunten/[id]/voorbereiding/route.ts` — 397 regels met een
eigen `SYSTEM_PROMPT`, eigen retrieval en eigen contextopbouw.

Die route schreef **geen `governance_log`**. Dat is geen nalatigheid maar erfenis: ze is ouder
dan de auditlaag en is bij de herziening van 6 juli omgebouwd van "JSON-product" naar
"gespreksopener", waarbij het logpad niet meeging. Tot T1 zat de functie verstopt in een
agendapuntkaart; sindsdien heeft ze een prominente knop. Het auditgat stond daarmee in
productie op de zwaarste AI-output die het portaal maakt — terwijl elke gewone chatvraag in
diezelfde kaart wél een auditregel opleverde.

De omzetting was kleiner dan ze leek: de antwoordmodus `persoonlijke_voorbereiding` bestond al
(`core/lib/vraagtype.ts`), en de "rijke context" die ooit de reden was voor een eigen route
bouwt `/api/chat` al op — de code zegt het zelf ("zelfde selecties als de voorbereiding-route").
Wat ontbrak was een promptblok.

## Besluit

### 1. Het promptblok is een letterlijke overname, met drie benoemde deltas

`SP_VOORBEREIDING_REGELS` neemt de `SYSTEM_PROMPT` van de vervallen route byte-voor-byte over,
op drie na. Ze zijn machinaal gepind: `core/lib/voorbereiding-prompt.sanity.ts` reconstrueert
het origineel uit het nieuwe blok door de deltas terug te draaien en vergelijkt byte-voor-byte
met een bevroren kopie van de originele prompt. Wijkt er iets anders af, dan is de suite rood.

**Δ1 — toegevoegd: het blok "VORM — VOORRANG".** De belangrijkste vondst van dit ticket. De
oude route stuurde *alleen* haar `SYSTEM_PROMPT` mee; in `/api/chat` komt `TOON_BLOK`
eroverheen, en dat blok schrijft voor: *"Lopende tekst is de standaard, niet bullets"* en
*"Geen titels of koppen … tenzij de vraag specifiek vraagt om een gestructureerd document"*.
De voorbereiding is precies zo'n gestructureerd product — drie vetgedrukte kopjes en drie
vergadervragen. Zonder Δ1 hangt de hele structuur aan modelinterpretatie van die
uitzonderingsclausule.

De formulering wijst **vooruit** ("verderop in deze instructie"), omdat het blok in de
samengestelde prompt vóór `TOON_BLOK` staat: een voorrangsclaim die achteruit wijst, wijst naar
niets en staat zwakker dan de regel die hij overrulet. Tekst én positie zijn gepind.

**Geen vierde toonfamilie.** Het alternatief — `TOON_BLOK` overslaan voor deze modus, zoals de
oude route feitelijk deed — geeft exacte pariteit maar herstelt op toonniveau precies de
divergentie die dit ticket op routeniveau opheft. Eén motor met vier registers, en over drie
maanden de vraag waarom de voorbereiding anders klinkt dan de rest. Het register van
`TOON_BLOK` (u-vorm, concreet, geen corporate formuleringen) geldt hier dus onverkort — de oude
prompt had er zelf geen.

**Δ2 — geschrapt: de twee clausules over `[Samenvatting AI]`.** De oude route injecteerde
`documenten.samenvatting_ai` als eigen, ongenummerde bronsoort. `/api/chat` doet dat niet, en
`core/lib/antwoord-parser.ts` kent het label niet — het zou als rauwe tekst in het antwoord
staan. Een marker voorschrijven die niets voedt en niets rendert is het dode pad dat dit
traject juist opruimt. De golden test toetst daarom drie markers (`[Bron N]`,
`[Toelichting agendapunt]`, `[Algemene kennis]`) en controleert bovendien dat de parser ze
alle drie kent.

**Δ3 — niet gedaan.** Het `BRONVERTROUWEN`-blok blijft letterlijk staan, ook al plakt
`bouwSysteemBlokken` er `SP_BRON_VERTROUWEN` onder zodra er bronnen zijn. De twee zeggen
hetzelfde; dichter bij "letterlijk" blijven weegt hier zwaarder dan die overlap wegnemen.

### 2. Eén argument, geen tiende tak

De selectie is één ternair argument in de bestaande agendapunt-tak van `/api/chat`. De
toelichtingsseed, de bronsentinel, de auditvelden en de rest van die tak blijven ongewijzigd;
acht van de negen `bouwSysteemBlokken`-call-sites zijn byte-identiek. `TOON_BLOK` en de zeven
gepinde toonhashes blijven ongemoeid — de nulgrens G23 is intact.

### 3. Retrieval-pariteit: de bronloze voorbereiding zoekt wél

Agendapunt-modus retrievet normaal alleen als er gekoppelde stukken zijn (ADR 0028, criterium
5 — nooit een stille terugval op de hele bibliotheek). De vervallen route doorzocht de
bibliotheek **altijd**. Zonder correctie zou een agendapunt zonder stukken nul bronnen krijgen
— en juist daar heeft een bestuurder het meest aan een voorbereiding.

De correctie is één conditie (`voorbereidingZonderStukken`), uitsluitend bereikbaar via de
nieuwe modus: voor elke bestaande agendapuntchat blijft `moetRetrieven` wat het was. De
zoektocht is daar geen stille terugval maar precies wat de bestuurder vroeg — hij drukte op
"Bereid dit punt voor", niet op "beantwoord mijn vraag uit deze stukken". Die zoektocht draagt
wél de bibliotheekfilters, anders zou zij als enige tak de hele bibliotheek inclusief
historische stukken ongefilterd binnenhalen. En de bronkop belooft dan geen `[gekoppeld stuk]`,
want zonder primaire ids zet `maakContext` geen enkel herkomstlabel.

**`retrievalModusVoor("persoonlijke_voorbereiding")` wordt `besluitvorming`** (was: `actueel`).
Onder `actueel` filtert de RPC op documentstatus `vastgesteld`/`van_kracht`, en vergaderstukken
krijgen bij ingest de DB-default `concept`: dat sloot precies het materiaal uit waar de
voorbereiding voor bedoeld is. De vervallen route had hiervoor een eigen correctie (12-08-2026,
hardcoded); die hoort thuis bij de modus, niet bij een route. Dit raakt geen andere modus en
activeert géén Decision Object-injectie — die hangt aan `antwoordmodus === "besluitrijpheid"`.

### 4. Variant B: de knop opent het paneel

"Bereid dit punt voor" zet de agendapuntcontext, opent het paneel en laat `useAssistent` de
beurt versturen met de vaste openingszin en de modus als **per-beurt-override** (niet als
vastgezette gespreksmodus — anders blijft elke vervolgvraag in voorbereidingsmodus hangen).
Daarmee verdwijnt de laatste eigen streamverwerking en de laatste eigen payload buiten
`useAssistent`, en krijgt de voorbereiding vanzelf voortgangsmeldingen, verduidelijking,
reflectie en het onderbouwingspaneel.

**Dit doorbreekt bewust één bestaande regel.** `useAssistent` draagt op twee plekken
*"er wordt nooit automatisch een bericht verstuurd"*. Die regel gold het **herstel** van een
gesprek na een refresh en de reflectieflow — daar zou de gebruiker een beurt krijgen die hij
niet vroeg. Hier drukte hij op de knop; het alternatief is dat hij de vraag overtypt. De
startbeurt is daarom een expliciet veld op de paneelaanvraag, vuurt hoogstens één keer per
klik (bewaakt met een sleutelref, want dit is een kostendragende beurt), en een midden-klik op
de knop volgt gewoon de deeplink: `/ai` mét context, zónder automatische beurt.

### 5. De uitkomst wordt een bewaard product — en dit preciseert 0204

De chat-route schrijft de uitkomst server-side weg in `voorbereidingen.ai_output` +
`bronnen_meta` (beide kolommen bestonden al; geen migratie). De kaart leest dáárop in plaats
van op een query over `gesprekken`, waarmee "voorbereid" een feit wordt in plaats van een
gevolgtrekking uit een chatlog. De unique-constraint `(agendapunt_id, gebruiker_id)` doet het
overschrijven: opnieuw opstellen vervangt, er ontstaan geen versies, en de vorige uitvoer blijft
in de gesprekshistorie staan.

**Faalt het wegschrijven, dan slaagt de beurt tóch.** De bestuurder heeft zijn tekst al gezien;
hem alsnog een fout tonen zou hem iets afnemen dat er is. De fout gaat naar de serverlog én als
inline-melding mee — stil falen zou hem laten denken dat het punt is voorbereid.

**`bronnen_meta` draagt geen brontekst.** Wel de velden die de bronpill nodig heeft om eerlijk
te zijn (nummer, titel, vindplaats, status), níét het `fragment`. Dat zou een tweede opslag van
documentinhoud zijn naast `governance_log_inhoud` en daarmee buiten de retentiebaan van
`GOVERNANCE-LOG-RETENTIE-ONTWERP.md` om lopen. Zonder bronnenlijst zou `renderAntwoord` élke
`[Bron N]` als ongeldig markeren — een hallucinatiesignaal op bronnen die wél bestonden, en dat
is een ergere onwaarheid dan een ontbrekend citaat.

**Twee handelingen op een voltooid product.** De kaart toont naast "Doorvragen" ook "Opnieuw
opstellen". Dat **preciseert 0204, het herroept het niet**: "één knop per toestand" was gericht
tegen twee *ingangen* naast elkaar — niet "Bereid voor" én "Vraag hierover" op een onvoorbereid
punt. Bij een afgerond product zijn opnieuw opstellen en doorvragen geen twee ingangen maar
twee verschillende handelingen op één afgerond ding. Op een onvoorbereid punt staat er nog
steeds precies één knop.

### 6. Bewust niet gebouwd: de stukversie

Het vastleggen van de stukversie waarop de voorbereiding steunt, en de melding "het stuk is
gewijzigd ná uw voorbereiding", zijn **niet** gebouwd — ook niet alvast als kolom. Een veld
vullen dat niemand leest is precies het dode pad dat dit traject opruimt. De mockup
(`MOCKUP-voorbereiding-als-product-v0.1.html`) toont die regel al; hij is vooruitgelopen op een
beslissing die T4 neemt. Gaat T4 alsnog die kant op, dan is het één extra veld op het
schrijfmoment.

### 7. De oude route vervalt in twee stappen

PR 1 laat de route staan (deprecated, zonder aanroeper) zodat de omzetting met één revert terug
te draaien is, en instrumenteert haar tijdelijk met een tokenregel: zij schrijft geen
governance_log en `ai_acties` telt acties in plaats van tokens, dus zonder die regel bestaat er
geen "vóór"-getal en wordt de verbruiksvergelijking een schatting. PR 2 verwijdert de route,
de `w5.voorbereiding.post.*`-karakteriseringssnapshots **en die meting**. De notities-route
(`/voorbereiding/notities`) blijft ongemoeid: die gaat over eigen aantekeningen, niet over AI.

## Gevolgen

- Het auditgat is gedicht: elke voorbereiding levert een `governance_log`-regel met
  inhoudszegel op, met `retrieval_meta.antwoordmodus = "persoonlijke_voorbereiding"` en
  `herkomst = "agendapunt:<id>"` als herkenningspunt.
- Logvolume en verbruik stijgen. Beide zijn gewenst maar niet gratis; ze zijn gemeten (zie de
  terugkoppeling bij #304) en gaan als invoer naar T4.
- `/api/chat` schrijft voor het eerst naar een domeintabel. Daarom is
  `supabase/checks/2026_09_04_t2_voorbereiding_product.sql` aangesloten op
  `scripts/cross-tenant-ci.sh`: die meet onder de echte browserrol dat de bestuurder zijn eigen
  product mag schrijven en overschrijven, dat de upsert de aantekeningen van de notities-route
  **laat staan**, en dat de voorbereiding privé blijft — ook voor de voorzitter.
- De verduidelijkingstak kan bij een voorbereiding niet vuren (agendapunt-modus zet
  `bronIntentResultaat` op `null`). Dat was een aanname; ze is nu vastgelegd in
  `tests/cross-tenant/voorbereiding-antwoordmodus.test.ts`.
- `bouwProfielsturingAgenda` (profielsturing die de lenzen en vergadervragen kleurde) wordt
  `bouwProfielsturing` (generieke prioritering). Bewust: een eigen variant zou opnieuw een
  aparte tak vragen.
- De voorbereiding krijgt nu ook inline vervolgvragen. Winst, maar met een aandachtspunt: het
  derde kopje ("Neem mee de vergadering in") vraagt zélf om drie vragen. Waargenomen in de A/B.

## Openstaande punten

| Punt | Eigenaar | Status |
|---|---|---|
| Auditgat op de voorbereiding | — | **Afgemeld** met dit besluit |
| Opsteller-toon (`AI-ASSISTENT-OPSTELTAAK-VERBETERINGEN.md`) | productowner | Open — bewust niet in T2 gecombineerd, anders is bij een klacht niet te herleiden of het aan de verhuizing lag of aan de nieuwe toon |
| Verbruikstoename per voorbereiding | T4 | Invoer voor de verbruiksbegrenzing |
| Stukversie bij de voorbereiding vastleggen (verouderingsmelding) | T4 | Bewust niet gebouwd; beslispunt |
