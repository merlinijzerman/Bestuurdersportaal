# 0055 — T11: kleine-populatie-suppressiedrempel n<10

- **Status:** Geaccepteerd
- **Datum:** 2026-07-10
- **Betrokkenen:** Ontwikkeling (T11-werkopdracht), Merlin (drempel-akkoord)
- **Leidend ontwerp:** beslisnotitie multi-tenant v0.4 §13 (herleidbaarheid bij
  kleine populaties)

## Context

Een KPI/weergave over een kleine populatie kan **indirect identificerend** zijn:
bij een handvol personen wordt een aggregaatcijfer alsnog tot een individu
herleidbaar. v0.4 §13 vraagt daarom een drempel-/suppressiemechanisme voor de
stuurinformatie- en klantbeeld-modules, met een **expliciet vastgelegde drempel**.

## Besluit

**Minimale celgrootte n < 10.** Onder de drempel wordt de waarde onderdrukt
(gemaskeerd met `⋅`), niet getoond. Conservatief gekozen (ruime marge boven de
CBS-achtige n<5-praktijk) omdat het bestuurdersportaal een besloten, hoog-
gevoelige context is en de kosten van onderdrukking laag zijn (aggregaat-
weergaven).

Implementatie: pure, centrale laag `lib/suppressie.ts`
(`SUPPRESSIE_DREMPEL = 10`, `isOnderdrukt(n)`, `maskeer(...)`), met sanity-tests
op de randgevallen (n = drempel-1 onderdrukt, n = drempel niet). De server-side
leeslagen (`lib/stuurinfo-bron.ts`, `lib/klantbeeld-bron.ts`) passen de suppressie
toe **vóór** de data de client bereikt (geen leak in de payload):

- stuurinformatie: elke KPI/deelnemer-status-cel met `populatie_n < 10` → gemaskeerd;
- klantbeeld: cohorten met `aantal < 10` → uit de set verwijderd, met expliciete
  "n onderdrukt"-melding (geen stille truncatie).

Een ontbrekende teller (`null`) betekent "geen telbare personen-populatie" (bv.
een financiële KPI) → **niet** onderdrukken.

## Overwogen alternatieven

- **n < 5** — afgewezen: sluit aan bij sommige statistiekdrempels maar krappere
  privacymarge; voor een besloten bestuurscontext te ruim zichtbaar.
- **Configureerbaar per fonds (default 10)** — nu niet nodig: één conservatieve,
  centrale drempel is eenvoudiger en beter auditbaar. Kan later als T8-flag worden
  toegevoegd zonder herontwerp (de drempel zit al in één constante).

## Gevolgen

- **Privacy-by-design:** indirecte herleidbaarheid bij kleine aantallen is
  afgevangen; de drempel is één centrale, geteste constante.
- **Aantoonbaar actief:** de seed geeft het demo-fonds Meridiaan één bewust kleine
  deelnemer-status-cel (n=4) zodat de suppressie zichtbaar is in de UI, en de
  sanity-/cross-tenant-tests borgen de werking.
- **Samenhang:** hoort bij de bronkeuze [[0054-t11-bronkeuze-rls-aggregaattabellen]].
