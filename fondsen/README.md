# `fondsen/` — fonds-specifieke code

Per fonds één submap (`fondsen/<slug>/`) met uitsluitend de modules/overrides van dát fonds.

## Regels (afgedwongen via ESLint-boundaries, zie `eslint.config.mjs`)

- `fondsen/<a>/*` mag **niet** importeren uit `fondsen/<b>/*` (fondsen onderling gescheiden).
- Een fonds gebruikt gedeelde functionaliteit via `core/*` (nooit via een ander fonds).
- `core/*` mag **nooit** importeren uit `fondsen/*` (eenrichting).

Een nieuw fonds toevoegen = een map `fondsen/<slug>/` aanmaken **en** de slug toevoegen aan de
`FONDS_SLUGS`-lijst bovenaan `eslint.config.mjs`, zodat de onderlinge-scheidingsregel meteen geldt.

## Belangrijk — géén runtime-isolatie

Zie `core/README.md`. De mapindeling scheidt code voor review/IP/onderhoud, niet op runtime.
Alle fonds-code draait in dezelfde deploy (besluit `0040`).

## Status

Nog géén echte fonds-specifieke code (het portaal is single-tenant in gebruik: Horizon-demo).
De submappen `pgb/` en `horizon/` zijn **placeholders** die de conventie vastleggen en de
boundary-lint aantoonbaar maken; ze bevatten nog geen productcode.
