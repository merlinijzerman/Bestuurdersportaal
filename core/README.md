# `core/` — gedeeld product

Gedeelde, fonds-agnostische code (het product zoals elk fonds het krijgt).

## Regels (afgedwongen via ESLint-boundaries, zie `eslint.config.mjs`)

- `core/*` mag **nooit** importeren uit `fondsen/*` (eenrichtingsafhankelijkheid: core kent geen fonds).
- `core/*` mag **niet** importeren uit `platform/*` (platform is een consument van core, niet andersom).
- Fondsen consumeren `core` via een stabiele extension-interface/registry (groeit met T8/T11).

## Belangrijk — géén runtime-isolatie

Deze `core`/`fondsen`-scheiding is een **onderhouds-, review- en IP-organisatiemaatregel**, geen
runtime-isolatie. In het standaardmodel (bridge-ready pool, besluit `0040` B1/B5) draait álle
fonds-code in dezelfde build/runtime. Harde build-/runtime-isolatie (niveau 3/4) is de betaalde
dedicated-runtime-variant (TP2) en valt buiten deze structuur.

## Status

T9 fase 2 (na G2-go) verhuist de gedeelde `lib/`-modules hierheen (`core/lib/`) en de gedeelde
componenten naar `core/components/`. Zolang die verhuizing nog niet heeft plaatsgevonden is deze
map het reeds-ingerichte doel; de boundary-regels staan al scherp.
