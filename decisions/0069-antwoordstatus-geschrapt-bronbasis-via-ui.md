# 0069 — Antwoordstatus-regel geschrapt; bronbasis via de UI-laag; [Bron N]-guard zonder treffers

- **Status:** Geaccepteerd (experimenteerfase)
- **Datum:** 2026-07-15
- **Betrokkenen:** Merlin (akkoord), Ontwikkeling

## Context

Bij een algemene-kennisantwoord verscheen de bronbasis driemaal: de deterministische UI-banner (`bepaalInlineMeldingen`), de door het model uitgeschreven regel `"Antwoordstatus: <X>"` (uit `NIEUW_STRUCTUUR`), en nogmaals in proza. Bovendien produceerde het model in dat geval `[Bron N]`-markeringen naar niet-bestaande bronnen (kapotte ⚠-bron-chips). `"Antwoordstatus:"` is een machineregister dat het eigen `TOON_BLOK` ("geen labels/koppen") tegenspreekt, en een model-gekozen status kan de deterministische UI-melding tegenspreken — twee bronnen van waarheid voor één feit.

## Besluit

De verplichte `"Antwoordstatus: <X>"`-openingsregel is uit `NIEUW_STRUCTUUR` verwijderd. De bronbasis (interne bronnen / algemene kennis / onvoldoende basis) wordt uitsluitend gedragen door de deterministische UI-laag (`bronbasisLabel` + `bepaalInlineMeldingen`). `SP_ALGEMEEN_REGELS` verbiedt nu expliciet `[Bron N]` (er zijn geen genummerde interne bronnen). De combineren-branch gebruikt bij **0 treffers** `SP_ALGEMEEN_REGELS` i.p.v. `SP_COMBINEREN_REGELS`, zodat het model niet naar niet-bestaande bronnen kan verwijzen.

## Overwogen alternatieven

- **Status in de tekst laten maar verweven** — afgewezen: de redundantie met de UI-banner blijft, en het risico op tegenspraak model↔UI blijft.
- **Niets doen** — de amateuristische, tegenstrijdige weergave blijft.

## Gevolgen

- Bronbasis op één plek, warmer register, geen tegenspraak tussen model-status en UI-melding.
- **Uitlegbaarheid/schijnzekerheid (EU AI Act-lijn):** de functie verhuist van modeltekst naar de deterministische UI-laag — compliance-technisch sterker, want betrouwbaarder dan een model dat zijn eigen status kiest.
- Actief achter de `BESTUURLIJKE_STIJL`-flag en de duiding-modus (waar `NIEUW_STRUCTUUR` geldt).
- **RLS/datamodel:** geen wijziging.

## Referenties

- `core/lib/generatie-kern.ts` (`NIEUW_STRUCTUUR`, `SP_ALGEMEEN_REGELS`), `app/api/chat/route.ts` (combineren-branch bij 0 treffers).
