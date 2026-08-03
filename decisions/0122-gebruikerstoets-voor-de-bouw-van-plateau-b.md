# 0122 — Gebruikerstoets vóór de bouw van plateau B

- **Status:** Geaccepteerd — **blokkerende voorwaarde voor plateau B**
- **Datum:** 2026-08-04
- **Betrokkenen:** Productverantwoordelijke, fondsbestuur

## Context

Plateau B voegt een gespreksvorm toe waarin een bestuurder hardop twijfelt. Of die vorm werkt, hangt niet af van de techniek maar van de toon, het moment van uitnodigen en de formulering van de verdiepingsvragen. Dat is niet vanachter een bureau vast te stellen, en het is ook niet achteraf te meten: [[0112]] sluit elke registratie van reflectiegedrag uit. Er is dus geen telemetrie die een verkeerde aanname later zou corrigeren.

Daar komt bij dat de kosten van bijstellen ná de bouw hoog zijn: de toestandsmachine, de bronsetbevriezing en de vier conditioneringen in de chatlaag hangen aan de gekozen flowvorm.

## Besluit

Plateau B wordt niet gebouwd voordat een gebruikerstoets is uitgevoerd volgens de kritiek/niet-kritiek-systematiek uit ontwerp v1.0 §19, zonder openstaande kritieke bevindingen. Plateau A is hiervan onafhankelijk en kan wel door.

## Overwogen alternatieven

- **Bouwen en daarna toetsen** — verworpen: zie de kostenafweging hierboven, en zonder telemetrie is "we zien wel hoe het loopt" geen strategie.
- **Toetsen met een klikbaar prototype in plaats van de echte flow** — overwogen en bruikbaar voor de uitnodiging en de labels, maar niet voor de verdiepingsvragen: daar hangt het oordeel op de inhoudelijke kwaliteit van de doorvraag, en die vraagt een werkend model.

## Gevolgen

- De werkhypothesen die de toets moet valideren zijn expliciet: de fail-safe-termijn voor het herstellen van een onderbroken flow (werkhypothese 24 uur), de triggermomenten T1–T5, en de drie afrondlabels uit [[0113]].
- Livegang van plateau B vraagt daarnáást nog de voorwaarden L1–L4, L6, L10 en L12 uit ontwerp v1.0 §21. Bouwen mag na de toets; live zetten pas daarna.
- Bewust geaccepteerd: dit vertraagt plateau B. Dat is de bedoeling.

## Referenties

- Ontwerp v1.0 §19 (toetssystematiek), §21 (livegangvoorwaarden)
- Technisch ontwerp §1 (gate-eis 4)
- [[0112]], [[0113]], [[0110]]
