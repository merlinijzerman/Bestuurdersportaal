# 0070 — Bronkeuze: wettelijke-plicht-patronen en meetset-uitbreiding (verfijning I-2)

- **Status:** Geaccepteerd (experimenteerfase) — her-accordering geaccordeerde drempels vóór productie openstaand
- **Datum:** 2026-07-15
- **Betrokkenen:** Merlin (akkoord), Ontwikkeling; Compliance (her-accordering meetset)

## Context

Kadervragen zonder fondsanker én zonder generiek trefwoord — bijvoorbeeld *"Wat zijn de communicatieverplichtingen naar deelnemers als de uitkering daalt?"* — vielen in `bepaalBronIntent` in de twijfelbak (`fonds`, `onzeker`) en lokten een onnodige verduidelijkingsvraag uit. De `GENERIEK_INTENT_PATRONEN`-lijst was te smal: zuiver wettelijke/kadermatige vragen misten een trefwoord. De classificatie wordt geijkt tegen een door compliance geaccordeerde meetset (sign-off 2026-06-22) met vaste drempels.

## Besluit

`GENERIEK_INTENT_PATRONEN` is uitgebreid met plicht-/verplichting-signalen (`/verplichting/`, `/plicht(?:en)?\b/`) — bewust **zonder leidende `\b`**, omdat Nederlandse samenstellingen (communicatie­verplichting, informatie­plicht) geen woordgrens vóór het kernwoord hebben. De geaccordeerde meetset (`bronkeuze-meetset.ts`) is uitgebreid van **40 → 46** vragen met echte kadervragen én een contrastief twijfelgeval. Verificatie (`bronkeuze-classificatie.sanity.ts`): alle geaccordeerde drempels blijven gehaald — terugvraag-frequentie 9/46 = 19,6% (≤ 20%), foute zekere auto-keuze 0%, fondsvraag stil als 'algemeen' = 0.

## Overwogen alternatieven

- **Terugvraag niet-blokkerend maken (antwoord-eerst)** — een beleidskeuze die FO §11a raakt; bewust uitgesteld.
- **Patronen blind bijstellen zonder de meetset uit te breiden** — afgewezen: dat is tunen zonder meetbasis; de meetset-uitbreiding kwam eerst.

## Gevolgen

- Minder onnodige terugvragen bij kadervragen; écht-ambigue vragen (zonder anker én zonder plicht-/generiek-signaal) vragen nog steeds terug.
- **Compliance:** de geaccordeerde meetset is gewijzigd (40 → 46). Hoewel het gedrag binnen de vastgestelde drempels blijft, vergt de wijziging van de meetset zelf **her-accordering door compliance** vóór productie.
- Bouwt voort op besluiten 0014/0016 (automatische bronkeuze I-2). RLS/datamodel: geen.

## Referenties

- `core/lib/vraagtype.ts` (`GENERIEK_INTENT_PATRONEN`, `bepaalBronIntent`), `core/lib/bronkeuze-meetset.ts`, `core/lib/bronkeuze-classificatie.sanity.ts`.
- Besluiten [`0014`](./0014-increment-i2-automatische-bronkeuze.md), [`0016`](./0016-i2-aanscherpingen-na-review.md).
