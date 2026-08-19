# 0042 — Host→fonds-afdwinging: fail-closed achter env-schakelaar `TENANT_ENFORCE`

- **Status:** Geaccepteerd
- **Datum:** 2026-07-08
- **Betrokkenen:** Merlin (akkoord), Claude (uitvoering)

## Context

T1.2 (besluit 0041) maakte de host→fonds-resolutie runtime maar **observerend**:
per request wordt de fondscontext uit de host bepaald en bij een anomalie gelogd,
zonder te blokkeren. T1.3 zet de stap naar **fail-closed afdwinging**: een request
waarvan de host niet naar een bekend fonds resolveert, óf waarvan het host-fonds
niet gelijk is aan het sessie-fonds, wordt geweigerd.

Randvoorwaarden: (1) RLS per `fonds_id` blijft de **primaire** tenant-isolatie —
host-afdwinging is defense-in-depth, geen vervanging; (2) de afdwinging mag geen
legitieme gebruikers buitensluiten voordat `tenant_domains` geseed is en de
observe-fase (T1.2) bevestigt dat er geen valse mismatch is; (3) besluit 0029
(onbekende host → `app`-surface, routing-fail-safe) mag niet botsen met een
fail-closed fonds-gate; (4) login/marketing/pre-auth-paden hebben geen sessie-
fonds en mogen nooit geweigerd worden; (5) Vercel preview-deploys draaien op
`*.vercel.app`-hosts die niet in `tenant_domains` staan.

## Besluit

De fail-closed afdwinging staat achter een **env-schakelaar `TENANT_ENFORCE`**
(`on` = afdwingen; alles anders/leeg = observe, het T1.2-gedrag). De beslislogica
is een **pure functie** `beoordeelToegang({ resolutie, sessieFondsId, enforce })`
(`lib/tenant-enforce.ts`): bij `enforce=true` weigert ze een onbekende host
(`onbekende-host`) of een host-fonds ≠ sessie-fonds (`fonds-mismatch`), anders
toegestaan. Het pagina-chokepoint (`app/(dashboard)/layout.tsx`) toont bij een
weigering een **expliciete mismatch-pagina** (geen redirect → geen lus). De
laatste client-gestuurde fonds-filter (request-body `fonds_id` in
`app/api/chat/route.ts`) is vervangen door het server-geverifieerde
`profiel.fonds_id`; API-routes zijn al per sessie-fonds RLS-geïsoleerd, dus hun
host-afdwinging is proportioneel/gefaseerd (hoogrisico-routes eerst).

## Overwogen alternatieven

- **Enforce hard aan (geen env-schakelaar)** — verworpen: zou iedereen
  buitensluiten zolang `tenant_domains` niet geseed is en de observe-fase geen
  groen licht geeft. De env-schakelaar maakt observe→enforce een gecontroleerde,
  per-omgeving terugdraaibare flip (rollback = env wegzetten, geen redeploy).
- **Afdwinging in de middleware (Edge)** — verworpen: de middleware is Edge-
  runtime, routing-only, zonder DB/sessie (besluit 0029). De fonds-context vereist
  een DB-lookup + sessie; dat hoort in de serverlaag, niet in de Edge.
- **Redirect naar /login bij weigering** — verworpen: risico op een redirect-lus
  met de bestaande login-gate, en het verbergt de oorzaak. Een expliciete
  mismatch-pagina benoemt de blokker (UX-principe "maak blokkers expliciet").
- **`beoordeelToegang` per-route in alle 66 API-routes** — verworpen als big-bang:
  RLS + `SECURITY INVOKER` isoleren élke tenant-query al per sessie-fonds, dus de
  host-afdwinging op API's is defense-in-depth. Gefaseerd uitrollen (hoogrisico-
  routes eerst) i.p.v. een refactor van alle routes ineens.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd als primaire grens. De host-afdwinging is
  een tweede, env-gated grens. De service-role wordt (net als T1.2) alleen voor de
  globale `tenant_domains`-read gebruikt.
- **Body-`fonds_id` weg:** `app/api/chat/route.ts` scoopt `fonds_instellingen`, de
  RAG-retrieval én de `governance_log`-insert nu op `profiel.fonds_id`. Het
  body-veld blijft voor backwards-compat geaccepteerd maar wordt genegeerd. Geen
  gekoppeld fonds → fail-closed 403.
- **Audit/reproduceerbaarheid:** het `governance_log` legt nu gegarandeerd het
  server-fonds vast i.p.v. een client-waarde. Observe-logging (`[TENANT-RESOLVE]`,
  besluit 0041) blijft ook onder enforce staan, met een extra `enforce`-veld.
- **Verhouding tot 0029:** ongewijzigd. 0029 regelt de **routing-fail-safe** op de
  Edge (onbekende host → `app`-surface); dit besluit regelt de **fonds-binding** in
  de serverlaag voor authenticated tenant-requests. Ze raken verschillende lagen.
- **Datamodel/migraties:** geen schemawijziging. Wel een **idempotente seed-
  migratie** (`2026_07_08_tenant_domains_seed.sql` + `_ROLLBACK`) die de canonieke
  pilothost `horizon.bestuurdersportaal.com` via `fondsen.slug='horizon'` koppelt.
- **Beheer/uitrol (HARDE GATE):** `TENANT_ENFORCE=on` mag pas ná (a) het draaien
  van de seed-migratie en (b) een observatievenster waarin de T1.2-logs geen valse
  mismatch tonen voor de pilothost. Zet `TENANT_ENFORCE` **alleen op productie**;
  preview/staging (`*.vercel.app`) laten uit om lockout te voorkomen. Rollback =
  env wegzetten (instant).
- **Bewust geaccepteerde schuld:** PGB is nog niet als fonds in de database aanwezig
  en dus niet geseed; enforce mag pas fondsbreed aan als alle legitieme
  entry-hosts geseed zijn.

## Referenties

- Besluit [`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md) (B4),
  [`0041`](./0041-tenant-resolutie-observe-logging-serverlog.md) (observe-fase),
  [`0029`](./0029-publieke-voorkant-host-indeling.md) (host-surfaces)
- Code: [`lib/tenant-enforce.ts`](../lib/tenant-enforce.ts),
  [`lib/tenant-context.ts`](../lib/tenant-context.ts),
  [`app/(dashboard)/layout.tsx`](../app/(dashboard)/layout.tsx),
  [`app/api/chat/route.ts`](../app/api/chat/route.ts)
- Migratie: [`2026_07_08_tenant_domains_seed.sql`](../supabase/seeds/schema/2026_07_08_tenant_domains_seed.sql)
- Tests: [`lib/tenant-enforce.sanity.ts`](../lib/tenant-enforce.sanity.ts)
