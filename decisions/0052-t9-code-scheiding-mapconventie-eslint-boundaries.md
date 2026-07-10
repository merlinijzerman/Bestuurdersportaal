# 0052 — T9: code-scheiding via mapconventie + ESLint-boundaries (geen workspaces), gefaseerd rond G2

- **Status:** Geaccepteerd
- **Datum:** 2026-07-09
- **Betrokkenen:** Merlin (akkoord), Ontwikkeling (T9-werkopdracht)

## Context

Besluit [`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md) B5 en
beslisnotitie multi-tenant v0.4 §9 vragen logische code-scheiding tussen gedeeld product
(`core`), fonds-specifieke code (`fondsen/<slug>`) en de back-office (`platform`), afgedwongen
met CI-boundaries — vóór fonds 2 fonds-specifieke code laat ontstaan (v0.4-risico RS6). As-built
is `mvp/` één Next.js-app zonder workspaces; gedeelde logica staat plat in `lib/` (101 bestanden,
291 `@/lib/`-imports over 147 bestanden), platform-specifieke lib-modules staan tussen de gedeelde
(`platform-*.ts`, `supabase-platform.ts`), en er is nog géén fonds-specifieke code (één fonds,
Horizon-demo). Randvoorwaarden: geen schijnzekerheid (scheiding ≠ runtime-isolatie), geen RLS-/
gedragsregressie, `tsc` groen, en de G2-gate ([`0049`](./0049-t7-g2-go-no-go-gate.md)) die vóór
PGB-onboarding moet zijn afgetekend.

## Besluit

De code-scheiding wordt een **mapconventie binnen de enkele Next.js-app** (`core/`, `platform/`,
`fondsen/<slug>/`), **niet** een workspaces-opzet (Nx/Turborepo). De eenrichtingsafhankelijkheid
wordt afgedwongen met de core-ESLint-regel **`no-restricted-imports`** in een aparte, minimale
`eslint.config.mjs` (géén next/recommended-ruleset). Uitvoering is **gefaseerd rond G2**: **fase 1**
(tooling + skelet + bewezen negatieve controle, gedrag-neutraal) mag vóór de G2-aftekening; de
churnzware **fase 2** (`lib`→`core/lib`, `platform/lib`, `components`→`core/components`, de
blokkerende CI-gate + branch-protection) volgt **pas na de formele PGB-go**.

De laaggrenzen: `core` mag nooit uit `fondsen/*` of `platform/*` (strikte eenrichting — `core` kent
geen fonds en geen platform); `platform` mag `core` wel, `fondsen/*` niet; `fondsen/<a>` mag `core`,
niet `fondsen/<b>`. App Router-routes blijven fysiek in `app/` (Next-vereiste) en worden in fase 2
via dezelfde regels begrensd. De **moduleregistry** blijft eigendom van `core` (interface; vandaag
`lib/module-registry.ts`, in fase 2 `core/lib/`), T8 vult per-fonds de manifest-**data** — consistent
met [`0050`](./0050-t8-moduleregistry-in-code.md).

## Overwogen alternatieven

- **Lichte workspaces (npm/Turborepo/Nx)** — afgewezen (voorlopig): geeft aparte build-/
  publiceergrenzen die we niet nodig hebben zolang alles in één deploy draait; `no-restricted-imports`
  volstaat voor de eenrichtingsregel met minimale verstoring. Workspaces blijft de upgrade-optie zodra
  er een echte aparte build-/publiceerbehoefte per fonds ontstaat.
- **Volledige `next lint`-ruleset optuigen als gate** — afgewezen: ESLint was niet geïnstalleerd; de
  next/recommended-ruleset op 100+ ongelinte bestanden loslaten geeft honderden buiten-scope-
  bevindingen. Eén boundary-regel is scherp, reviewbaar en doet precies wat B5 vraagt. `next build`
  linting staat daarom uit (`next.config.ts` → `eslint.ignoreDuringBuilds`), zodat de gate los draait
  en de Vercel-build niet raakt.
- **Alles-in-één T9 (skelet + migratie tegelijk), ongeacht G2** — afgewezen: T9 is dependent op de
  G2-gate en de migratie raakt 291 imports. Fasering levert de tooling + het bewijs nu, zonder de
  gate te schenden of een half-gemigreerde staat te forceren.
- **Code-scheiding presenteren als runtime-isolatie** — afgewezen (consistent met 0040): in één deploy
  draait alle fonds-code in dezelfde runtime; `core`/`fondsen` is organisatie/review/IP, geen isolatie.

## Gevolgen

- **RLS/tenant-isolatie:** geen. Structuur-/tooling-refactor; geen tabel, policy, resolver of
  `fonds_id`-pad geraakt.
- **Audit/reproduceerbaarheid:** geen; geen audit-pad geraakt.
- **Datamodel/migraties:** geen migratie, geen schemawijziging.
- **Build/repo:** nieuwe devDeps `eslint` + `@typescript-eslint/parser` (dev-only, niet in de
  productie-bundle; npm-audit-findings zitten in die dev-boomtak). `next build` lint bewust uit.
- **Reviewgemak/IP (niveau 1/2):** de mapindeling maakt een reviewbundel per fonds scopebaar
  (`core` + `fondsen/<slug>`) — uitwerking (CODEOWNERS/path-filter) in fase 2. **Niveau 3/4
  (runtime-/audit-isolatie) blijft bewust open voor de betaalde TP2-variant.**
- **Bewust geaccepteerd:** na fase 1 bestaat een tussenstaat waarin de boundary-regels nog lege lagen
  bewaken (skelet + placeholder-fondsen); de echte afdwinging op productcode komt met fase 2.

## Referenties

- `eslint.config.mjs` (`FONDS_SLUGS`, `no-restricted-imports` per laag), `next.config.ts`
  (`eslint.ignoreDuringBuilds`), `package.json` (`lint:boundaries`)
- `core/README.md`, `platform/README.md`, `fondsen/README.md` (conventie + "geen runtime-isolatie")
- Besluiten [`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md) (B5),
  [`0049`](./0049-t7-g2-go-no-go-gate.md) (G2-gate),
  [`0050`](./0050-t8-moduleregistry-in-code.md) (registry-eigendom)
- Beslisnotitie multi-tenant v0.4 §9 (B5 — code-scheiding); Implementatieroadmap T-serie v0.1 (T9)
