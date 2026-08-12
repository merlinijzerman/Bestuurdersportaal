# 0164 — Gebruikerstoets bewust overgeslagen voor de reflectie-optimalisatie (waiver van 0122)

- **Status:** Geaccepteerd — **bewuste risico-aanvaarding door de opdrachtgever**
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin (opdrachtgever/initiatiefnemer), ontwikkeling
- **Waiveert:** [[0122]] voor de scope van de reflectie-optimalisatie (tranche 2–4)

## Context

Besluit [[0122]] maakt de gebruikerstoets een **blokkerende** voorwaarde vóór de bouw van de reflectiefunctie: of de vorm werkt hangt niet aan de techniek maar aan de labels, de toon en de triggermomenten, en dat is niet vanachter een bureau vast te stellen. Omdat [[0112]] elke registratie van reflectiegedrag uitsluit, is er **geen telemetrie** die een verkeerde aanname later corrigeert.

Voor deze optimalisatie is een klikbare mockup gemaakt (`08 Test en acceptatie/MOCKUP-reflectie-optimalisatie-v0.1.html`) met een bijbehorend toetsrecord-sjabloon (criteria 1–9). De opdrachtgever heeft het geoptimaliseerde ontwerp — vier ingangen, één verdiepingsvraag als standaard, het nieuwe conceptformat dat de eigen woorden spiegelt — op basis van die mockup **beoordeeld en goedgekeurd**, en besloten de toets **niet vooraf** uit te voeren maar direct door te bouwen.

Dit besluit is er om die keuze **expliciet en belegd** vast te leggen, zodat het geen herhaling wordt van OP-B1 (waar dezelfde gate ongemerkt op een mondelinge bevestiging werd gepasseerd). Het verschil is bewustheid en eigenaarschap, niet dat het risico kleiner is.

## Besluit

Voor de scope van de reflectie-optimalisatie (tranche 2–4 uit de werkopdracht) wordt de blokkerende gebruikerstoets uit [[0122]] **bewust overgeslagen**. De bouw start zonder vooraf vastgelegd toetsrecord. Eigenaar van de risico-aanvaarding: **Merlin (opdrachtgever)**.

Dit waiveert **uitsluitend de bouw-gate**. De livegangvoorwaarden blijven onverkort gelden (zie Gevolgen).

## Aanvaard risico (expliciet)

1. **De drie werkhypothesen gaan ongevalideerd naar productie:** de labels (acht → vier ingangen), het aantal vragen (drie → één als standaard) en de triggermomenten (`sparring`-proxy vervalt). Zonder telemetrie ([[0112]]) merkt niemand het als een keuze de plank misslaat, tot iemand het zegt.
2. **Het verwijdercriterium voor `risico` (VOORSTEL §B) kan niet worden waargenomen.** Zonder toets is niet vast te stellen of deelnemers tussen "Ik twijfel" en "Ik zie een risico" aarzelen. `risico` **blijft daarom staan** — de veilige default, want verwijderen vergt dat *beide* criteria zich bij een toets voordoen.
3. **Criterium 5 (leest het concept als zíjn overweging of als AI-tekst?) en criterium 8 (gesprek of formulier?) blijven onbevestigd** — juist de punten waarop het herontwerp is gericht.

## Mitigaties

- Het ontwerp is door de opdrachtgever beoordeeld op een **werkende, klikbare mockup**, niet alleen op papier.
- De mockup én het toetsrecord-sjabloon blijven beschikbaar; een **post-hoc toets** kan alsnog worden gedraaid en is **aanbevolen vóór brede uitrol** en zeker vóór een fonds met echte bestuurders (sluit aan op OP-B9 / de livegangvoorwaarden).
- De ingang-migratie (CHECK 8→4) is **omkeerbaar** met een nieuwe idempotente migratie + datamapping; de gewijzigde promptblokken zijn met sha256 gepind en herstelbaar.
- Overweeg tranche 2 achter een **per-fonds vlag** te zetten, zodat brede uitrol een tweede, bewust beslismoment krijgt (optioneel; nu bestaat er geen reflectie-vlag).

## Gevolgen

- **OP-B1 wordt geherkwalificeerd:** van "gate per ongeluk gepasseerd, niet aantoonbaar" naar "gate bewust gewaiverd (dit besluit), toets uitgesteld tot post-hoc". Blijft **open** — het onderliggende risico is aanvaard, niet weggenomen. Eigenaar: Merlin.
- **De livegangvoorwaarden blijven staan.** Dit besluit raakt niet OP-B9 (L3/L4/L12): de DPIA-actualisatie met de categorie *reflectie-inhoud*, de verwerkersovereenkomsten en de opname in het AI-gebruikskader gelden onverkort vóór livegang met echte bestuurders.
- De structurele gates A–H blijven verplicht bij de tranche-2-migratie (CHECK + `create or replace` op `reflectie_transitie`).

## Referenties

- [[0122]] (de gewaiverde gate), [[0112]] (geen reflectiemarkering), [[0126]]
- `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` §B (verwijdercriterium `risico`), §L (toets)
- `VOORSTEL-REFLECTIE-ANTWOORDPAD.md` §7 (criteria 8–9)
- `08 Test en acceptatie/MOCKUP-reflectie-optimalisatie-v0.1.html` + `Reflectie-optimalisatie - gebruikerstoets (record) v0.1.md`
