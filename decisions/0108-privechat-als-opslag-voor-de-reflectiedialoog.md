# 0108 — De privéchat is de opslag voor de reflectiedialoog; geen apart opslag-, logging- of verwijderpad

- **Status:** Geaccepteerd — ontwerp vastgesteld, **implementatie volgt in plateau B**
- **Datum:** 2026-08-04
- **Betrokkenen:** Productverantwoordelijke, IB

## Context

De reflectiefunctie helpt een bestuurder zijn eigen afweging scherper te krijgen. De verleiding is om daar een eigen object van te maken — een reflectietabel, een eigen logregel, een eigen verwijderknop. Dat zou een tweede pad opleveren naast de privéchat, met een eigen RLS-opzet, een eigen retentievraag en een eigen kans om vergeten te worden bij het verwijderen van een gesprek.

## Besluit

De reflectiedialoog is een gewone privéchat. Vragen en antwoorden staan in `gesprekken.berichten`, net als elke andere beurt. Er komt geen aparte opslag, geen aparte auditregel en geen apart verwijderpad: verwijderen van het gesprek verwijdert de reflectie mee.

## Overwogen alternatieven

- **Aparte `reflecties`-tabel** — verworpen: verdubbelt het RLS-, retentie- en verwijderoppervlak zonder functionele winst.
- **Reflectie als bijlage bij een besluit** — dat is plateau C (publicatiepad), niet dit. Zolang de reflectie privé is, hoort zij bij de bestuurder.

## Gevolgen

- Plateau A's verwijderfunctie ([[0116]]) dekt de reflectie automatisch; er is niets extra's te bouwen.
- De server-controlled toestandsmachine ([[0110]]) leeft wél in een eigen tabel, maar draagt uitsluitend flowstatus — geen tekst.
- Bewust geaccepteerd: de reflectie is niet apart terug te vinden of te exporteren. Dat is de prijs van geen tweede pad, en past bij [[0112]].

## Referenties

- Ontwerp v1.0 §9, technisch ontwerp §3.2 (B-3)
- [[0110]], [[0112]], [[0116]]
