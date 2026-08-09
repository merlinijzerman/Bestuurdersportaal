# 0093 — De bibliotheektabs sturen ook het inhoudelijke zoeken

- **Status:** Geaccepteerd
- **Datum:** 2026-07-30
- **Betrokkenen:** opdrachtgever (Merlin IJzerman), Claude (uitvoering)

> **Addendum (9 augustus 2026) — naamswijziging label.** Het zichtbare tablabel **"Generiek (DNB / AFM / PF)" heet sindsdien "Sectorbibliotheek"**. De besluittekst hieronder is ongewijzigd bewaard als historisch record; waar "Generiek" als tabnaam staat, lees "Sectorbibliotheek". De **interne codewaarde `generiek`** (kolom `bibliotheek`, `Record<"generiek"|"fonds">`, routes en RLS) is **niet** gewijzigd — puur een UI-label.

## Context

De Documentbibliotheek kent twee bibliotheken — **Fondsbibliotheek** en **Generiek
(DNB / AFM / Pensioenfederatie)** — en twee weergaven: *beheren* (titelzoeken + lijst)
en *zoeken* (`ZoekenPaneel`, semantisch zoeken in de documentinhoud via `/api/zoeken`).

Die twee sneden liepen langs elkaar heen:

- In de **beheerweergave** bepaalden de tabs de lijst, maar het titelzoekveld deelde
  één zoekterm over beide tabs. Wie in de Fondsbibliotheek zocht en naar Generiek
  wisselde, kreeg een lege lijst — niet omdat er niets is, maar omdat de term van de
  andere bibliotheek bleef staan.
- In de **zoekweergave** verdwenen de tabs en stond er een aparte **bronsoort-dropdown**
  (Alle bronnen / Fondsdocumenten / Generiek). Twee bedieningselementen voor dezelfde
  keuze, op twee plekken, die elkaar niet kenden.

De opdrachtgever wil per bibliotheek kunnen zoeken, gestuurd door de tabs.

## Besluit

**De tabs zijn de enige plek waar je kiest met welke bibliotheek je bezig bent**, in
beide weergaven.

1. De tabs staan buiten de weergave-splitsing en blijven dus zichtbaar in de
   zoekweergave. In *beheren* bepalen ze de lijst, in *zoeken* de scope.
2. `ZoekenPaneel` krijgt een optionele prop `vasteBronsoort`. Is die gezet, dan vervalt
   de eigen bronsoort-dropdown en volgt het paneel de tab. Wisselen van tab herhaalt de
   lopende zoekopdracht meteen in de andere bibliotheek, met behoud van de zoekterm.
3. Het titelzoeken in de beheerweergave houdt **een aparte zoekterm per tab**.
4. De actieve bibliotheek staat in gewone taal boven het zoekpaneel en in de
   paginasubtitel, zodat nooit onduidelijk is wat er doorzocht wordt.

## Overwogen alternatieven

- **Twee zoekvelden naast elkaar** (links fonds, rechts generiek). Verworpen: direct
  vergelijkbaar, maar het scherm wordt vol en op een laptop te smal, en het dupliceert
  alle filters (modus, dossier).
- **Aparte knop "Zoek in de inhoud" per tab.** Verworpen: functioneel gelijkwaardig,
  maar een extra klik en een tweede ingang naar hetzelfde paneel.
- **Dropdown laten staan náást de tabs.** Verworpen: twee bedieningselementen voor
  dezelfde keuze roepen de vraag op welke wint. De prop is bewust optioneel, zodat een
  aanroeper zonder tabs de dropdown gewoon houdt (geen regressie voor `/zoeken`).
- **Zoekterm wissen bij tabwissel.** Verworpen als default: eenvoudiger, maar je
  verliest je term bij heen-en-weer springen. Per-tab-termen kosten één state-object.

## Gevolgen

- `app/(dashboard)/bibliotheek/page.tsx`: tabs vóór de weergave-splitsing;
  `zoektermen: Record<"generiek"|"fonds", string>` in plaats van één `zoekterm`;
  `<ZoekenPaneel vasteBronsoort={actieveTab} />`; scope-uitleg in de subtitel en boven
  het paneel.
- `app/(dashboard)/bibliotheek/_components/ZoekenPaneel.tsx`: optionele prop
  `vasteBronsoort`, `useEffect` die een tabwissel volgt en de zoekopdracht herhaalt,
  dropdown conditioneel.
- **Geen** API-, RLS-, datamodel- of retrieval-wijziging: `/api/zoeken` kende de
  `bronsoort`-parameter al; alleen de UI bepaalt hem nu anders.
- **Bijvangst:** de scope is nu ook zichtbaar in de zoekweergave. Eerder kon een
  gebruiker in "Alle bronnen" zoeken en generieke treffers voor fondsmateriaal aanzien —
  de bronkaarten labelden dat wel, maar de scope zelf was onbenoemd.
- **Bewust geaccepteerd:** de standaardscope is niet meer "alle bronnen" maar de actieve
  tab (default Fondsbibliotheek). Wie doelbewust over beide bibliotheken heen wil zoeken,
  kan dat in de bibliotheek niet meer in één handeling. Dat is een echte inperking; hij
  is aanvaard omdat het portaal fondsgericht is en de tab altijd één klik weg is. Komt de
  behoefte terug, dan is een derde tab "Beide" de logische uitbreiding.
- `tsc --noEmit --skipLibCheck` exit 0; `npm run lint:colors` groen.

## Referenties

- Code: `app/(dashboard)/bibliotheek/page.tsx`,
  `app/(dashboard)/bibliotheek/_components/ZoekenPaneel.tsx`, `app/api/zoeken/route.ts`.
- Besluiten: [`0018`](./0018-increment-h-zoekmodule-en-i3-bronvermelding.md) (zoekmodule
  op de bestaande retrieval), [`0012`](./0012-bronsoort-denorm-vooruitgetrokken-naar-cplus-b13.md)
  (bronsoort-denorm die de filter mogelijk maakt).
