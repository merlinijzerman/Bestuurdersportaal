# 0098 — Kopiëren uit de chat, bewust zonder logging

- **Status:** Geaccepteerd
- **Datum:** 2026-07-31
- **Betrokkenen:** Merlin (opdrachtgever, besluit over de logging), Claude (analyse en uitvoering)

## Context

Er was geen kopieerfunctie. Bestuurders die een passage of een tabel uit een
AI-antwoord in een memo of een oplegger wilden zetten, selecteerden met de muis.
Daarbij sneuvelen precies de twee dingen die het antwoord verifieerbaar maken:

- de **`[Bron N]`-verwijzingen** — in de weergave zijn dat `<button>`-pills; bij een
  muisselectie komt daar een los cijfer van, of niets;
- de **tabelstructuur** — een markdown-pipe-tabel wordt als tabel gerenderd, maar
  plakt als een reeks losse regels.

Wat er dan in een bestuursstuk belandt is AI-tekst zonder herkomst en zonder
structuur. Dat is het tegenovergestelde van waar het portaal voor staat.

## Besluit

### 1. Kopiëren per blok en per antwoord, via één helper

`core/lib/antwoord-klembord.ts` bouwt uit dezelfde AST als de weergave
(`core/lib/antwoord-parser.ts`) twee klembordformaten:

- **`text/html`** — met een echte `<table>` en inline opmaak, zodat het in Word als
  tabel plakt;
- **`text/plain`** — met **tabs** tussen de cellen, zodat Excel kolommen leest.

Terugval bij een browser zonder `ClipboardItem`: `navigator.clipboard.writeText`
(platte tekst met tabs — Excel werkt dan wél, Word krijgt geen tabelopmaak), en
daaronder een tijdelijk tekstveld. Het verschil wordt aan de gebruiker
teruggekoppeld ("Gekopieerd, met opmaak" versus "Gekopieerd als tekst"), zodat
niemand denkt dat er meer is gekopieerd dan er staat.

`[Bron N]` blijft in beide formaten als **letterlijke tekst** staan.

### 2. Een kopieeractie wordt NIET gelogd

Besluit van de opdrachtgever, 31-07-2026. Motivering: **een kopieeractie is geen
besluit en geen export naar het dossier.** Het is een leeshandeling. `governance_log`,
`governance_events` en `decision_ai_interactions` blijven byte-voor-byte ongewijzigd;
er is geen `fetch`, geen event en geen analytics-aanroep in het kopieerpad.

**Aanvaard gevolg, expliciet benoemd:** dit is daarmee het enige uitgaande pad in het
portaal zónder registratie. Een passage kan het portaal verlaten en in een memo
belanden zonder dat daar ergens een spoor van is. Dat is geen omissie maar een keuze;
wie hem terugdraait, doet dat als nieuw besluit — niet als "voor de zekerheid"-patch.

### 3. Daarom zijn bronnenlijst en herkomstregel verplicht

Dit is de tegenhanger van punt 2 en het hart van dit besluit. **Juist omdat er niet
gelogd wordt, is de tekst in het klembord het enige dat later nog vertelt waar een
passage vandaan komt.** Onder elke kopie staan daarom altijd:

- een **bronnenlijst** met per bron: titel, vindplaats (paragraaf en/of pagina),
  datum en documentstatus;
- één **herkomstregel**:

  > *Gekopieerd uit \<surface> van \<fonds> in het bestuurdersportaal op
  > \<datum>. Door AI samengesteld op basis van de hierboven vermelde bronnen; niet
  > inhoudelijk gecontroleerd en geen bestuurlijk besluit.*

  `\<surface>` is *"de AI-assistent"* op `/ai` en *"de AI-assistent bij een
  agendapunt"* in de inline agendapuntchat, zodat de lezer weet uit welke context
  de passage komt.

  De fondsnaam komt uit het profiel van de ingelogde gebruiker en wordt in beide
  surfaces meegegeven. Laadt dat profiel niet (best-effort read), dan valt de
  vermelding weg en blijft de rest van de regel staan — de zin is daarop
  geformuleerd. Steunt het antwoord niet op fondsdocumenten, dan luidt het tweede
  deel *"Door AI samengesteld zonder fondsdocument als bron"*: er mag niet naar
  bronnen worden verwezen die er niet zijn.

Er is **geen schakelaar, geen instelling en geen per-fonds configuratie** om ze weg
te laten. Dat is niet alleen beleid maar constructie, op drie niveaus:

- `bouwKopie(blokken, bronnen, context)` stelt beide zelf samen en heeft geen
  optieobject en geen vierde parameter;
- het resultaattype `KopiePayload` draagt een **uniek symbool-merk** dat alleen
  `bouwKopie()` zet. Een met de hand gebouwd `{html, tekst}`-object voldoet niet
  aan het type en kan `schrijfNaarKlembord()` dus niet bereiken;
- `schrijfNaarKlembord()` controleert bovendien op het moment van schrijven of de
  payload in **beide** formaten een herkomstregel draagt
  (`heeftVerplichteHerkomst()`), en weigert anders. Dat is de runtime-tegenhanger
  van het type-merk, want types verdwijnen bij het compileren.

### De bronnenlijst mag nooit een bron ontkennen

De lijst wordt **niet** uitsluitend uit `[Bron N]`-markers afgeleid. Dat was de
eerste opzet en die was fout. In de document-scope-modi levert het model geen
genummerde verwijzingen: `SP_DOCUMENT_SCOPE_BREED_REGELS` (actief bij
dekkingsbrede vragen en bij "document doorgronden") **verbiedt** de notatie
letterlijk — *"Gebruik GEEN [Bron N]-notatie"* — en `SP_DOCUMENT_SCOPE_ALG_REGELS`
schrijft in plaats daarvan paginaverwijzingen *"(pag. X)"* voor, zonder `[Bron N]`
te noemen. Juist daar steunt het antwoord per constructie op één genoemd
fondsstuk. Een op markers gebaseerde lijst zou daar altijd leeg zijn en de kopie zou
de bron actief **ontkennen** — schijnzekerheid in de gevaarlijkste richting.
Daarom drie gevallen:

1. genummerde verwijzingen aanwezig → die bronnen, onder *"Bronnen:"*;
2. geen genummerde verwijzingen maar wél aangeleverde bronnen → alle bronnen,
   onder *"Gebruikte stukken bij dit antwoord (het antwoord bevat geen genummerde
   verwijzingen)"*;
3. helemaal geen bronnen aangeleverd → *"Bij dit antwoord zijn geen
   fondsdocumenten als bron aangeleverd."*

### Twee signalen die niet mogen sneuvelen

- Een `[Bron N]` die niet aan een aangeleverde bron te koppelen is, wordt in de
  weergave zichtbaar gemarkeerd ("⚠ Bron N?"). In de kopie komt daarvoor een
  expliciete waarschuwingsregel in de plaats. Zonder die regel is een
  gehallucineerde verwijzing in Word niet van een geldige te onderscheiden.
- De niet-genummerde markers (`[Algemene kennis]`, `[Volgens wetgeving]`,
  `[Toelichting agendapunt]`, `[Organisatieprofiel]`) dragen in de weergave een
  eigen kleur én een waarschuwende tooltip. In de kopie krijgen ze een korte
  legenda — alleen voor de markers die daadwerkelijk voorkomen — zodat het
  verschil tussen een vastgestelde bron en bestuurs-vrijetekst zichtbaar blijft.

`core/lib/antwoord-klembord.sanity.ts` bewaakt dit (26 tests): voor lege invoer,
een lege bronnenlijst, een fragment zonder verwijzing en een dangling `[Bron 9]`
wordt geasserteerd dat de onderdelen er staan, en een matrix van invoeren wordt
door `heeftVerplichteHerkomst()` gehaald. Een eerdere bewaking —
`assert.equal(bouwKopie.length, 3)` — is vervangen: `Function.length` telt niet
verder vanaf de eerste parameter met een default, dus die test liet precies de
wijziging door die hij moest tegenhouden.

### 4. Alleen een voltooide generatie is kopieerbaar

Kopieerknoppen verschijnen uitsluitend op een bericht dat een **netjes afgeronde**
generatie is (het `done`-event is ontvangen; vlag `voltooid` op het bericht).
`!laden` is daarvoor niet genoeg: bij een verbindingsfout zet het `finally`-blok
`laden` óók op false, en dan zou een afgebroken antwoord een kopieerknop met een
volledige herkomstregel krijgen. Om dezelfde reden krijgen de welkomsttekst en
foutmeldingen geen knop — een herkomstregel onder iets dat geen antwoord is,
ondermijnt precies de geloofwaardigheid van diezelfde regel.

Gesprekken uit de historie zijn opgeslagen ná een geslaagde generatie en dus
kopieerbaar; gesprekken van vóór dit besluit dragen de vlag nog niet en leiden hem
af uit de aanwezigheid van `onderbouwing`.

## Toegankelijkheid

De knop is zichtbaar bij hover **en** bij toetsenbordfocus (`group-focus-within` /
`focus-visible`, niet alleen `group-hover`), heeft een `aria-label`, en meldt de
uitkomst via een `aria-live="polite"`-gebied. De rand gebruikt
`--app-line-control` uit besluit [`0097`](./0097-tokens-mark-en-app-line-control.md)
— de eerste consument van dat token.

## Bekende grenzen

- **Handmatige muisselectie blijft bestaan** naast de knop, en draagt géén
  bronnenlijst en géén herkomstregel. Dat is niet af te dwingen; het is de reden
  dat de knop zichtbaar en laagdrempelig moet zijn.
- **Geverifieerde webbronnen** (Scenario A, besluit 0072) zitten in
  `onderbouwing.webBronnen` en niet in de `Bron[]`-array, en dragen geen
  `[Bron N]`. Ze komen daarom niet in de bronnenlijst onder een kopie. Zolang
  web-retrieval niet productief is, is dit theoretisch; wordt het aangezet, dan
  moet de kopie ze meenemen vóór livegang.

## Wat hier níet in zit

Geen export naar memo of besluitenlijst, geen vrijgavepoort, geen herkomstmarkering
per alinea. Dat zijn de patronen uit de maakassistent-spec en die vragen een
menselijke vrijgavehandeling — een andere orde dan kopiëren.

## Referenties

- `core/lib/antwoord-klembord.ts`, `core/lib/antwoord-klembord.sanity.ts`
- `app/(dashboard)/ai/_components/AntwoordWeergave.tsx` (knoppen),
  `AssistentClient.tsx` en `vergaderingen/_components/AgendapuntChat.tsx` (actiebalk)
- Besluit [`0079`](./0079-agenda-assistent-gedeelde-weergave.md) — één gedeelde
  renderer, dus één kopieergedrag in beide surfaces
- Besluit [`0097`](./0097-tokens-mark-en-app-line-control.md) — de randkleur
