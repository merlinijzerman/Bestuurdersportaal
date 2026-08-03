# 0121 — Uitnodigingsfrequentie per browsersessie, in `sessionStorage`, zonder databaseopslag

- **Status:** Geaccepteerd — ontwerp vastgesteld, **implementatie volgt in plateau B**
- **Datum:** 2026-08-04
- **Betrokkenen:** Productverantwoordelijke, IB

## Context

De reflectie-uitnodiging moet niet zeuren: hoogstens één keer per context per zitting. Dat vraagt om geheugen. Maar elke vorm van databaseopslag — "aan deze gebruiker is op dit moment een reflectie aangeboden" — is precies de registratie die [[0112]] uitsluit, en die [[0109]] om dezelfde reden vermijdt voor de kaart zelf.

## Besluit

De frequentiebegrenzing leeft in `sessionStorage`, per browsertab, naast de bestaande sleutel uit `core/lib/ai-sessie.ts`. Maximaal één proactieve uitnodiging per context per browsersessie. Geen tabel, geen kolom, geen RLS-gevolg.

## Overwogen alternatieven

- **Teller in `profielen`** — verworpen: maakt zichtbaar hoe vaak iemand is aangespoord tot reflectie, en dat is een gedragsregistratie.
- **`localStorage` in plaats van `sessionStorage`** — verworpen: een begrenzing die maanden aanhoudt is geen begrenzing maar een uitschakeling, en de gebruiker kan hem niet terugdraaien.

## Gevolgen

- Best-effort, net als de bestaande actief-gesprek-markering (besluit 0086): in private mode of bij geblokkeerde opslag valt de begrenzing weg en verschijnt de uitnodiging vaker. Aanvaard.
- De begrenzing geldt per tab. Twee tabs open betekent twee uitnodigingen. Aanvaard; het alternatief vraagt serverstate.
- Een **permanente** opt-out is iets anders en hoort wél in het profiel: die is een uitgesproken voorkeur van de gebruiker, geen registratie van zijn gedrag. Strikt zelfbeheerd, conform besluit 0017.

## Referenties

- `core/lib/ai-sessie.ts` (besluit 0086), technisch ontwerp §6.4
- [[0109]], [[0112]]
