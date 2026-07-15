# 0068 — Antwoordmodi teruggebracht tot Auto + Sparren (herziening I-1)

- **Status:** Geaccepteerd (experimenteerfase) — UX-toets bij gebruikers openstaand
- **Datum:** 2026-07-15
- **Betrokkenen:** Merlin (akkoord), Ontwikkeling

## Context

Bestuurders vonden de vier zichtbare antwoordmodi (Auto · Feiten · Duiding · Sparren) lastig te doorzien. FO v1.3 §13 legde die vier vast (acceptatiecriterium 5). Analyse: Feiten en Duiding zijn geen *houding* voor het gesprek maar een *bewerking van één concreet antwoord* — die horen ná het antwoord thuis, niet als voorafkeuze. Er bestaat al machinerie voor (vervolgacties). Sparren is wél een houding voor het hele gesprek.

## Besluit

`ZICHTBARE_ANTWOORDMODI = ["sparring"]` — de UI toont voortaan **Auto + Sparren**. Feiten en Duiding verdwijnen als voorafknop en verschijnen als vervolgactie ná elk antwoord ("Maak feitelijker" / "Geef bestuurlijke duiding"), nu ook bij niet-documentgerichte vragen (`bepaalVervolgacties`). De interne modi (feitelijk, duiding, historisch, besluitrijpheid, bronoverzicht, persoonlijke_voorbereiding) blijven bestaan via auto-detectie en vervolgacties.

## Overwogen alternatieven

- **Alleen Auto** — afgewezen: verliest de persistente sparring-houding die een gebruiker voor een heel gesprek wil vastzetten.
- **Vier modi houden** — de oorspronkelijke drempel blijft.
- **Alleen labels hernoemen** — lost het begripsprobleem niet op.

## Gevolgen

- Lagere drempel: een bestuurder hoeft geen modus-taxonomie te snappen. Onderliggend gedrag blijft volledig bestaan (consistent met het eigen ontwerpprincipe dat 7 interne modi al tot een kleinere knoppenset terugbracht).
- Meer gewicht op de kwaliteit van de autodetectie (`bepaalAntwoordmodus`) — te bewaken tegen de meetset.
- **Zacht signaal:** sommige bestuurders vinden zichtbare controle geruststellend → kort toetsen bij gebruikers vóór definitieve vaststelling.
- **FO-impact:** FO v1.3 §13 acceptatiecriterium 5 ("maximaal vier zichtbare modi") is hiermee herzien naar "Auto + Sparren". Sanity `vraagtype.sanity.ts` bijgewerkt.

## Referenties

- `core/lib/vraagtype.ts` (`ZICHTBARE_ANTWOORDMODI`, `bepaalVervolgacties`), `app/(dashboard)/ai/page.tsx`, `core/lib/vraagtype.sanity.ts`.
- FO v1.3 §13; herziet acceptatiecriterium 5.
