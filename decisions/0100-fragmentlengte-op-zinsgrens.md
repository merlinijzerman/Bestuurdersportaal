# 0100 — Het bronfragment kapt af op een zinsgrens, niet op 150 tekens

- **Status:** Geaccepteerd
- **Datum:** 2026-07-31
- **Betrokkenen:** Merlin (opdrachtgever, expliciet akkoord gevraagd en gegeven), Claude (analyse en uitvoering)

## Context

`maakContext()` in `core/lib/rag.ts` vulde `BronVerwijzing.fragment` met
`chunk.tekst.substring(0, 150) + "..."`. Zolang dat fragment alleen in de bronkaart
onderin het onderbouwingspaneel stond, was dat goed genoeg: je las het als
geheugensteun, niet als bewijs.

Met tranche 2 deelopdracht A verandert de functie van dat fragment. Het staat nu in de
hover-preview op de `[Bron N]`-pill, op de plek waar de bestuurder een bewering
controleert zonder te scrollen. Daar ís het citaat het bewijsstuk — en dan doet de oude
regel twee dingen verkeerd:

1. **Hij kapt midden in een zin**, vaak midden in een woord. Een citaat dat halverwege
   ophoudt bewijst niets; je moet alsnog het document openen.
2. **Hij plakte de puntjes er onvoorwaardelijk aan**, ook bij een chunk van veertig
   tekens. Dat is schijnzekerheid in het klein: het suggereert een afkapping die er niet
   is, en dus dat er meer stond dan er staat.

De werkopdracht merkte punt 1 op en vroeg er expliciet akkoord voor, omdat het de enige
payloadwijziging in deelopdracht A is. Punt 2 kwam bij het uitzoeken naar boven.

## Besluit

Het fragment wordt gebouwd door een pure functie, `bouwBronfragment()` in
`core/lib/bronfragment.ts`, met deze regels in volgorde:

1. Witruimte (inclusief regeleindes) wordt genormaliseerd tot enkele spaties.
2. Past de tekst binnen 300 tekens, dan komt hij **ongewijzigd** terug — geen puntjes.
3. Anders wordt afgekapt op de laatste zinsgrens binnen 300 tekens, mits die ten minste
   60% van de limiet haalt.
4. Lukt dat niet, dan op de laatste woordgrens; is er geen spatie, dan hard op 300.
5. **Is er afgekapt — op wélke grens dan ook — dan sluit het citaat af met één
   beletselteken (`…`).**

De ondergrens van 60% in stap 3 is er tegen een vroege punt: zonder die grens zou
"Zie art. 3." een citaat van vier woorden opleveren terwijl er 300 tekens beschikbaar
waren.

Stap 5 luidde in de eerste uitvoering "alleen bij een échte afkapping", waarbij een
zinsgrens werd gezien als een natuurlijk einde en dús geen afkapping. **Beide reviews
vonden dat onafhankelijk van elkaar terug als de zwaarste bevinding**, en terecht: de
functie belandt alleen in die tak omdat de tekst langer was dan het maximum, dus er ís
afgekapt. Het einde van een *zin* is niet het einde van de *brontekst*. Het schadegeval:

> "Het bestuur stelt de compensatieregeling per 1 januari vast. Deze regeling geldt niet
> voor deelnemers die vóór 2020 zijn uitgetreden."

De eerste zin haalt de ondergrens, de tweede valt weg, en de bestuurder leest een
ogenschijnlijk compleet citaat tussen aanhalingstekens — zonder enig signaal dat de
uitzondering erachter stond. De oude 150-tekensregel plakte in dít geval nog puntjes; de
eerste versie van de nieuwe regel haalde ze juist weg. De winst van "geen puntjes bij een
korte chunk" is terecht, maar was te ver doorgetrokken: het onderscheid moet zijn *"is er
tekst weggelaten?"*, niet *"eindigt het op een punt?"*.

De functie is Supabase-vrij en heeft een eigen suite,
`core/lib/bronfragment.sanity.ts` (13 tests, draait mee in `npm run sanity`), waarin dit
geval expliciet is vastgelegd.

De regel geldt op alle paden die een citaat **vullen**: `maakContext()` in
`core/lib/rag.ts` én `opmaakBesluitContext()` in `core/lib/besluitvorming-bron.ts`. Dat
laatste pad kapte nog op 150 tekens af zonder enig afkapsignaal, en levert juist de bron
met het hoogste normgewicht (de formele besluitregistratie). `documentBronnen()` in
`app/api/chat/route.ts` bouwt óók een `BronVerwijzing`, maar laat het fragment bewust leeg
(dekkingsbrede document-scope); de weergave toont daar een expliciete melding.

## Wat dit kost — en wat het níét kost

Het fragment gaat **niet naar de prompt**. `maakContext()` bouwt de modelcontext uit
expliciet benoemde velden (bronlabel, locatie, brontekst) en serialiseert het
`bronnen`-array nergens; er staat geen `JSON.stringify` in het promptpad. Deze wijziging
kost dus **geen modeltokens en geen geld per vraag**.

Wat wél groeit, is de payload- en auditomvang, op drie plekken:

- het `meta`-SSE-event naar de client (`app/api/chat/route.ts`);
- `gesprekken.berichten` (jsonb) — het bewaarde gesprek;
- `governance_log.bronnen` — het append-only auditspoor.

Bij `CHUNK_BUDGET = 10` is de bovengrens 10 × 150 = circa 1,5 kB extra per antwoord in elk
van die drie. **Gemeten op een echt antwoord met tien bronnen: 2.928 tekens tegen 1.530
onder de oude regel — +1.398 bytes.** Afgezet tegen een antwoordtekst van enkele kB is dat
verwaarloosbaar, en het staat tegenover een citaat dat zijn werk als bewijsstuk
daadwerkelijk doet.

## Gevolgen

- **Bestaande gesprekken veranderen niet.** Het fragment is opgeslagen in
  `gesprekken.berichten`; oude berichten houden hun 150-tekenscitaat met de onterechte
  puntjes. Alleen nieuwe antwoorden volgen de nieuwe regel. Er wordt niets
  gemigreerd of herschreven — het auditspoor is append-only.
- **`governance_log.bronnen` verandert van inhoud, niet van vorm.** Geen kolom erbij,
  geen migratie, geen wijziging aan de insert. De hash-keten over `governance_events`
  blijft ongemoeid.
- De regel is deterministisch en getest, dus dezelfde chunk levert altijd hetzelfde
  citaat — nodig om een antwoord te kunnen reproduceren.

## Overwogen alternatieven

- **Ongewijzigd laten (150 tekens).** Verworpen: dan levert deelopdracht A een
  hover-preview op met een citaat dat halverwege een woord ophoudt, en dat is precies de
  handeling die de tranche wilde wegnemen.
- **Alleen naar 300 verlengen, zonder zinsgrens.** Verworpen: goedkoper, maar het kapt
  nog steeds midden in een zin — alleen 150 tekens later.
- **Alleen de onterechte puntjes repareren.** Verworpen als eindpunt (lost het
  hoofdprobleem niet op), maar wél meegenomen als onderdeel van de nieuwe regel.
- **De volledige chunk meesturen.** Verworpen: dat vervijfvoudigt de payload en het
  auditspoor voor een preview die maar een paar regels toont.

## Referenties

- Code: [`core/lib/bronfragment.ts`](../core/lib/bronfragment.ts),
  [`core/lib/bronfragment.sanity.ts`](../core/lib/bronfragment.sanity.ts),
  `maakContext()` in [`core/lib/rag.ts`](../core/lib/rag.ts)
- Weergave: [`AI-WEERGAVE-ONTWERP.md`](../AI-WEERGAVE-ONTWERP.md) §8.5
- Voorgeschiedenis: [`0079`](./0079-agenda-assistent-gedeelde-weergave.md) (gedeelde
  renderer), [`0098`](./0098-kopieren-uit-de-chat-zonder-logging.md) (tranche 1)
