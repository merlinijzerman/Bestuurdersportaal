# 0109 — De reflectie-uitnodiging is een tijdelijke UI-kaart zonder opslag

- **Status:** Geaccepteerd — ontwerp vastgesteld, **implementatie volgt in plateau B**
- **Datum:** 2026-08-04
- **Betrokkenen:** Productverantwoordelijke, IB

## Context

De assistent nodigt op geschikte momenten uit tot reflectie. Zou die uitnodiging een chatbericht zijn, dan staat er in het gesprek — en daarmee in de opslag — dat de assistent iemand tot reflectie heeft aangezet, ook als die persoon de kaart wegklikte. Dat is een registratie van een niet-genomen handeling.

## Besluit

De uitnodiging is een tijdelijke kaart in de weergave onder het voorgaande antwoord. Geen chatbericht, geen databasewaarde, geen auditregel. Wegklikken of "geen aanvullende reflectie" laat niets achter.

## Overwogen alternatieven

- **Uitnodiging als AI-bericht in de chat** — verworpen: legt een afgeslagen aanbod vast.
- **Telemetrie op het aanbod (hoe vaak aangeboden, hoe vaak aangenomen)** — verworpen: dat is precies de reflectiemarkering die [[0112]] uitsluit, alleen geaggregeerd.

## Gevolgen

- De frequentiebegrenzing kan niet uit de database komen; zij leeft in `sessionStorage` ([[0121]]).
- Bewust geaccepteerd: er is geen enkele meting van hoe goed de uitnodiging werkt. Bijstellen gebeurt op basis van de gebruikerstoets ([[0122]]), niet op basis van data.

## Referenties

- Ontwerp v1.0 §9.1 (triggers T1–T5), technisch ontwerp §6.4
- [[0112]], [[0121]], [[0122]]
