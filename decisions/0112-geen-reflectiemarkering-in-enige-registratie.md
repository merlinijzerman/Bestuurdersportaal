# 0112 — Geen reflectiemarkering: niet in `modus`, niet in `retrieval_meta`, niet in een aparte tabel

- **Status:** Geaccepteerd — ontwerp vastgesteld, **implementatie volgt in plateau B**
- **Datum:** 2026-08-04
- **Betrokkenen:** Productverantwoordelijke, IB

## Context

Het ligt technisch voor de hand om een reflectie-interactie te markeren: een waarde in `modus`, een vlag in `retrieval_meta`, of een eigen tabel. Dat zou meetbaar maken hoe vaak er gereflecteerd wordt.

Precies dat is het probleem. Het auditspoor is — ook na [[0119]] — leesbaar voor houders van een auditcapability. Een reflectiemarkering maakt dan zichtbaar dat een specifieke bestuurder op een specifiek moment twijfelde over een specifiek onderwerp. Dat is een chilling effect: wie weet dat zijn aarzeling wordt geregistreerd, aarzelt niet meer hardop. En dan doet de functie het tegenovergestelde van wat zij moet doen.

## Besluit

Er bestaat geen tabel, kolom of rij die registreert dát een interactie een reflectie was. `modus` en `retrieval_meta` bevatten geen reflectiewaarde. De flowstatus in `gesprek_reflectie_state` is geen uitzondering: die is uitsluitend leesbaar voor de gebruiker zelf, staat in geen enkele fondsbreed leesbare projectie, en verdwijnt met het gesprek.

## Overwogen alternatieven

- **Geanonimiseerde telling per fonds** — verworpen: bij bestuursorganen van acht tot twaalf personen is "één bestuurder reflecteerde deze week op het beleggingsbeleid" in de praktijk herleidbaar.
- **Markering die alleen de gebruiker zelf ziet** — dat is precies wat de flowstatus is; verder gaan voegt niets toe.

## Gevolgen

- **Er is geen bruikbaarheidsmeting op de reflectiefunctie.** Dat is een reële beperking en wordt bewust aanvaard; bijstellen gebeurt via de gebruikerstoets ([[0122]]).
- De allowlist uit [[0114]] moet dit blijven afdwingen: een nieuw veld dat de reflectie zou verraden valt fail-closed naar de inhoud en laat de sanitytest falen.
- Acceptatiecriterium: de aanwezigheid van een reflectiemarkering ergens in het datamodel is een testfout, geen feature.

## Referenties

- Ontwerp v1.0 §12, technisch ontwerp §3.2, acceptatiecriterium AC-17
- [[0114]], [[0119]], [[0108]]
