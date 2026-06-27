# 0027 — Normgewicht `informatief` standaard zichtbaar in RAG

- **Status:** Geaccepteerd
- **Datum:** 2026-06-26
- **Betrokkenen:** Merlin IJzerman (producteigenaar/architect), platformteam

## Context

Increment P1 (§8.3 #6, ADR `0022` punt 5) introduceerde een gedeelde RAG-zichtbaarheidsregel: generieke documenten met een **zwak normgewicht** verschijnen niet standaard in RAG, tenzij de gebruiker er expliciet om vraagt. "Zwak" was gedefinieerd als `informatief` én `onbekend` (waarbij `NULL`/ongeldig als `onbekend` telt). Eén functie — `isStandaardZichtbaarInRag` in `lib/generiek-curatie.ts` — voedt zowel de retrievalfilter (`filterZwakkeGeneriek` in `lib/rag.ts`) als het zichtbaarheidslabel in de platform-UI, zodat label en gedrag niet uiteenlopen.

In de praktijk bleek deze drempel te streng: informatieve generieke bronnen (sectorduiding, toelichtingen, achtergrondstukken) bevatten relevante context die nu stelselmatig buiten antwoorden viel. De opt-out-vlag `toonZwakkeGeneriek` is bovendien nergens bedraad — er was dus geen werkend pad om informatief alsnog mee te nemen. Daarmee was de feitelijke regel een **harde uitsluiting** van `informatief`, niet de bedoelde "tenzij gevraagd".

Randvoorwaarde die meeweegt: ongeclassificeerde documenten (`onbekend`/`NULL`) horen niet ongemerkt in antwoorden te belanden — de veilige default voor écht onbekende herkomst blijft uitsluiting.

## Besluit

`informatief` wordt **geen** zwak normgewicht meer. `ZWAK_NORMGEWICHT` bevat voortaan alleen `onbekend` (en daarmee impliciet `NULL`/ongeldig). Generieke documenten met normgewicht `informatief` zijn dus standaard zichtbaar in RAG; alleen `onbekend`/`NULL` blijft standaard uitgesloten.

## Overwogen alternatieven

- **`toonZwakkeGeneriek` bedraden / defaulten op `true`** — verworpen: dat neemt óók `onbekend`/`NULL` mee, dus ongeclassificeerde documenten van onbekende herkomst zouden ongemerkt in antwoorden landen. Te grof.
- **UI-toggle per vraag/gebruiker** — niet nu: voegt UX- en uitlegcomplexiteit toe voor een keuze die de meeste gebruikers niet bewust willen maken. De vlag `toonZwakkeGeneriek` blijft bestaan als toekomstig opt-in-haakje voor `onbekend`.
- **`informatief` meenemen én expliciet lager wegen dan sterke kaders** — niet in dit besluit. De bronsoort-weging (`lib/weeg-bronsoort.ts`) onderscheidt nu alleen `generiek` vs. `fonds`, niet op normgewicht. Bewust geaccepteerde beperking (zie Gevolgen); een normgewicht-bewuste weging is een latere, additieve keuze.

## Gevolgen

- **Retrieval/RAG-gedrag:** generieke `informatief`-chunks bezetten nu promptplekken die ze voorheen niet kregen. Verwacht effect: meer context, maar ook dat informatieve bronnen op **dezelfde retrievalprioriteit** meedingen als sterkere generieke kaders (`bindend`, `toezichtverwachting`, `sector_guidance`) — ze worden niet op normgewicht ondergewogen. **Bewust geaccepteerd**; herijken zodra normgewicht-weging wordt toegevoegd.
- **Gedeelde bron-van-waarheid:** wijziging zit in één constante; het platform-UI-zichtbaarheidslabel (`GeneriekeBibliotheekClient`) flipt automatisch mee, dus label en gedrag blijven consistent.
- **Datamodel/migraties:** geen. Geen schemawijziging, geen DB-CHECK geraakt (`informatief` blijft een geldige `documenten_normgewicht_check`-waarde).
- **Veilige default behouden:** `onbekend`/`NULL`/ongeldig blijft uitgesloten — ongeclassificeerde herkomst landt niet ongemerkt in antwoorden.
- **Tests:** `lib/generiek-curatie.sanity.ts` aangepast — `informatief` verwacht nu `true`; alle sanity-tests slagen.
- **AVG/governance:** geen nieuwe datastroom; het betreft uitsluitend rangschikking/zichtbaarheid van reeds gecureerde generieke (sectorbrede, niet-fondsspecifieke) documenten.

## Referenties

- ADR `0022` punt 5 (oorspronkelijke §8.3 #6-regel; dit besluit herziet de scope van "zwak").
- FO v0.3 §8.3 #6 (RAG-zichtbaarheid generieke documenten).
- `mvp/lib/generiek-curatie.ts` (`ZWAK_NORMGEWICHT`, `isStandaardZichtbaarInRag`), `mvp/lib/rag.ts` (`filterZwakkeGeneriek`, `toonZwakkeGeneriek`), `mvp/lib/generiek-curatie.sanity.ts`.
- Open vervolg (niet in dit besluit): normgewicht-bewuste bronsoort-weging in `mvp/lib/weeg-bronsoort.ts`.
