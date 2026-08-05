# 0125 — Het beurtplafond is leidend: `verdieping_3` is bereikbaar, een vierde antwoord bestaat niet

- **Status:** Geaccepteerd — **correctie op een interne tegenstrijdigheid in het technisch ontwerp §6.1**
- **Datum:** 2026-08-05
- **Betrokkenen:** Ontwikkeling

## Context

De transitietabel in technisch ontwerp §6.1 bevat twee regels die elkaar uitsluiten:

| Huidige status | Actie | Nieuwe status | Controle |
|---|---|---|---|
| `verdieping_2` | `antwoord` | `verdieping_3` **of** `conceptweergave` | bij beurt ≥ 3 verplicht `conceptweergave` |
| `verdieping_3` | `antwoord` | `conceptweergave` | beurt → 3 |

`beurt` telt de gegeven antwoorden. Na een antwoord vanuit `verdieping_2` is de beurt dus altijd 3, en dwingt de eerste regel `conceptweergave` af — waarmee `verdieping_3` **onbereikbaar** is en de tweede regel dode letter. Volg je de tweede regel wél, dan is er een vierde verdiepingsantwoord, en dat gaat in tegen v1.0 §9.6: *"maximaal twee of drie verdiepingsvragen"*.

## Besluit

Het beurtplafond is leidend. Het derde antwoord landt in `verdieping_3`; vanuit die status is `antwoord` geweigerd (`beurtplafond_bereikt`). De actie `concept` brengt de flow vanuit elke verdiepingsstatus naar `conceptweergave` — zowel wanneer de assistent na beurt 1 of 2 al genoeg heeft, als wanneer het plafond is bereikt.

Netto: maximaal drie verdiepingsantwoorden, en alle drie de verdiepingsstatussen zijn bereikbaar.

## Overwogen alternatieven

- **Het TO letterlijk volgen** — verworpen: dat laat een status in de `CHECK`-constraint staan die nooit voorkomt. Dode toestanden in een toestandsmachine zijn geen cosmetisch probleem; ze maken de volgende lezer onzeker over wat er echt gebeurt.
- **`verdieping_3` schrappen** — overwogen en verworpen: v1.0 §9.4 tekent de flow expliciet met drie verdiepingen, en drie verdiepingsvragen zijn functioneel gewenst bij de ingang `niet_te_plaatsen`.
- **Het plafond op vier zetten** — verworpen: v1.0 §9.6 zegt twee of drie. Vier doorvragen op iemands twijfel is precies de "therapeutische" ervaring die criterium A3 van de gebruikerstoets moet uitsluiten.

## Gevolgen

- De chatroute doet bij het bereikte plafond **twee** RPC-aanroepen in één beurt: `antwoord` (status → `verdieping_3`) en, ná het tonen van het concept, `concept` (status → `conceptweergave`). De tweede staat bewust ná het streamen: de status volgt wat er werkelijk is gebeurd, niet wat er zou gaan gebeuren.
- Mislukt die tweede aanroep, dan blijft de flow op `verdieping_3` staan. De gebruiker kan dan afbreken; er gaat niets verloren. Zichtbaar in de serverlog.
- SQL en TypeScript zijn spiegels: de transitietabel staat in `core/lib/reflectie-flow.ts` en in `reflectie_transitie()`, en `reflectie-flow.sanity.ts` toetst uitputtend dat 14 van de 35 (status, actie)-combinaties geldig zijn en de overige 21 worden geweigerd.
- **Het technisch ontwerp is op dit punt onjuist** en wordt bijgewerkt.

## Referenties

- `core/lib/reflectie-flow.ts`, `core/lib/reflectie-flow.sanity.ts`
- `supabase/migrations/2026_08_05_b1_reflectie_state.sql`
- Technisch ontwerp §6.1; ontwerp v1.0 §9.4 en §9.6; AC-18
- [[0110]], [[0122]] (het beurtplafond hoort bij de te toetsen flowvorm)
