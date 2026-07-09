# 0050 — T8: moduleregistry als gesloten code-bron, manifest als per-fonds schakelaar

- **Status:** Geaccepteerd
- **Datum:** 2026-07-09
- **Betrokkenen:** Ontwikkeling (T8-werkopdracht, differentiatie-als-data)

## Context

T8 maakt differentiatie-als-data operationeel: een fonds moet volledig via
configuratie te onderscheiden zijn (theming + welke modules actief + feature
flags + content-overrides) zonder codewijziging. Daarvoor is nodig: (a) een
per-fonds manifest dat modules aan/uit zet, en (b) een bron van waarheid voor
wélke modules bestaan en wat ze betekenen (route, label, sectie, default).

Randvoorwaarden: `module_key` mag geen open enum in de DB zijn (een vrije-tekst
sleutel zonder betekenis geeft schijnconfiguratie en tikfout-risico). De
kernrandvoorwaarde uit v0.4 §9 geldt strikt: **beschikbaarheid ≠ autorisatie** —
het manifest bepaalt of een module beschikbaar is, nooit of iemand mag.

## Besluit

De verzameling geldige modules en hun betekenis staat als **gesloten registry in
code** (`lib/module-registry.ts`, puur/isomorf). Het per-fonds
`fonds_module_manifest` zet alleen bekende keys aan/uit. Effectieve
beschikbaarheid = `rij.actief` als de rij bestaat, anders `registry.defaultActief`;
een key buiten de registry is deterministisch "onbekend" → niet beschikbaar.
Kern-infrastructuur (home, beheer, governance) is `manifestBeheerbaar: false` en
kan nooit worden uitgezet (self-lockout-preventie).

## Overwogen alternatieven

- **Modules volledig in de DB (open enum + metadata)** — afgewezen: geeft een
  open `module_key`-ruimte, verplaatst route/label/sectie naar data die met de
  code moet meebewegen, en maakt een tikfout een stille misconfiguratie. De
  registry-in-code houdt betekenis en geldigheid op één plek, versiebeheerd.
- **Geen registry, alleen hardcoded navigatie** — afgewezen: dan is er geen
  gedeelde, testbare kernregel voor beschikbaarheid en kan de server-guard niet
  op dezelfde bron leunen als de UI.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. Het manifest is tenant-aware (RLS per
  `fonds_id`); de registry bevat geen tenantdata.
- **Beschikbaarheid ≠ autorisatie:** de registry's `rolVereist` is expliciet
  UI-cosmetica; de echte gate blijft `requireCapability()` + RLS per route. De
  server-guard (`lib/module-guard.ts`) dwingt beschikbaarheid af bovenop, nooit
  in plaats van, de capability/RLS-gate.
- **Datamodel:** `fonds_module_manifest.module_key` blijft `text` (geen DB-enum);
  validatie tegen de registry gebeurt in de app.
- **Beheer/UX:** het beheerscherm toont alleen `manifestBeheerbaar`-modules; een
  fonds kan zich niet buitensluiten van beheer/audit.
- **Uitbreiden = één key toevoegen** in de registry (geen migratie nodig voor een
  nieuwe module-definitie).

## Referenties

- `lib/module-registry.ts` (`MODULE_REGISTRY`, `beschikbareModuleKeys`, `moduleVanPad`)
- `lib/module-guard.ts` (`weigerAlsModuleUit`)
- `supabase/migrations/2026_07_09_t8_config_manifestlaag.sql` (§2 manifest)
- `tests/cross-tenant/fonds-config.test.ts` (beschikbaarheid-kernregel)
- Beslisnotitie multi-tenant v0.4 §9 (beschikbaarheid ≠ autorisatie)
