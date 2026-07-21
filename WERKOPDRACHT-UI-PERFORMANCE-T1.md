## Werkopdracht: UI-performance tranche 1 — laadstatus, request-cache en nulmeting

**Doel & context** — Het portaal voelt traag bij navigatie en interactie. Deze eerste tranche levert de twee quick wins met de grootste waargenomen winst (directe laadfeedback bij elke navigatie; dedupliceren van sessie-/profiel-/configqueries binnen één request) plus de meetbasis (Speed Insights + regiocheck) om het effect en de vervolgtranches te onderbouwen.

**Goedgekeurd ontwerp/plan** — `UI-PERFORMANCE-ANALYSE-2026-07-20.md` (repo-root), bevindingen B1, B3 en B7 en de bijbehorende acceptatiecriteria. Dit document is leidend; de tabel daarin beschrijft ook wat bewust naar latere tranches is geschoven.

**Scope**

- Wel (maatregel 1, B1): `loading.tsx` met skeletons voor de routegroep `app/(dashboard)` en voor de detailroutes met de zwaarste queryketens (`vergaderingen/[id]`, `procedures/[id]`, `notulen/[id]`, `risicomatrix/[id]`, `dashboard/*`). Skeletons volgen de bestaande Tailwind-tokens (geen nieuwe kleuren; `lint:colors` blijft groen).
- Wel (maatregel 2, B3): `React.cache()` om de per-request herhaalde reads: `haalFondsSessie` (`core/lib/fonds-sessie.ts`), de profiel-query zoals gebruikt in `app/(dashboard)/layout.tsx` en pages, en `haalFondsConfig` (`core/lib/fonds-config.ts`). Zelfde checks, zelfde volgorde, maximaal 1× uitgevoerd per server-render.
- Wel (maatregel 7, B7): `@vercel/speed-insights` toevoegen in de root-layout (CSP staat `*.vercel-insights.com` al toe — verifieer dat de bestaande directives volstaan).
- Wel (regiofix, B7 — **mismatch bevestigd op 2026-07-20**): de Vercel Function Region stond op `iad1` (Washington DC) terwijl Supabase in Stockholm (`eu-north-1`) draait; de fix naar `arn1` (Stockholm) is/wordt door Merlin via het Vercel-dashboard doorgevoerd. In deze werkopdracht: **verifieer** na deploy dat de functions daadwerkelijk in `arn1` draaien (bijv. via de `x-vercel-id`-responseheader of de deployment-details) en leg dit vast in de terugkoppeling. Optioneel, alleen na expliciet akkoord: de regio versiebeheerd vastleggen als `"regions": ["arn1"]` in `vercel.json` — let op: dit overschrijft de dashboard-instelling, dus niet beide sporen tegelijk gebruiken.
- Niet: parallelliseren van query-waterfalls (tranche 2, B2); optimistic UI / vervangen van `router.refresh()`-patronen (tranche 3, B4); server-side initial data voor bibliotheek/profiel/AI (B5); `next/dynamic`-lazy loading (B6); wijzigingen aan RLS, API-contracten, governance-logging of datamodel; de publieke (marketing)routes en de platform-surface.

**Relevante bestanden / modules** — `app/(dashboard)/layout.tsx`, nieuwe `loading.tsx`-bestanden onder `app/(dashboard)/**`, `core/lib/fonds-sessie.ts`, `core/lib/fonds-config.ts`, `core/lib/module-gate-page.ts` (consument van de gecachte helpers), `app/layout.tsx` (Speed Insights), `package.json`, `next.config.ts` (alleen indien CSP-aanvulling aantoonbaar nodig). Claude Code verifieert tegen de werkelijke code.

**Guardrails (zie `CLAUDE.md`)** — bevestig naleving van: RLS per `fonds_id` (alleen anon-key), append-only audit, human-in-the-loop, migratie-eerst-dan-deploy, snapshot-integriteit, geen schijnzekerheid. Specifiek voor deze opdracht: `React.cache()` mag uitsluitend binnen-request dedupliceren — geen cross-request caching van sessie- of tenantgegevens, geen wijziging aan de auth-redirects of de tenant-enforcement (T1.2/T1.3), en de fail-closed-paden in `app/(dashboard)/layout.tsx` blijven byte-voor-byte gelijk in gedrag.

**In te zetten subagents (zie `SUBAGENTS-ONTWERP.md` §4 trigger-matrix)** — `code-reviewer` (verplicht); `supabase-rls-reviewer` (de cache-wrapper raakt de sessie-/tenantketen); `ontwerp-sync-reviewer` vóór merge. Geen migraties voorzien, dus geen migratie-reviewer.

**Werkmodus** — begin in **Plan-modus**: lever eerst een implementatieplan (bestanden, RLS-impact, migratie-impact = naar verwachting geen, testaanpak, risico's — waaronder expliciet: waar `React.cache()` de bestaande callvolgorde zou kunnen veranderen). **Wijzig pas na expliciet akkoord.**

**Definition of Done (zie `CLAUDE.md`)** — functionaliteit volgens onderstaande acceptatiecriteria; RLS gecontroleerd; audit-logging ongewijzigd aangetoond; tests toegevoegd of gemotiveerd niet; `tsc --noEmit --skipLibCheck` groen; `lint:colors` groen; ontwerpdoc (`UI-PERFORMANCE-ANALYSE-2026-07-20.md`) bijgewerkt met status per maatregel + sync-check groen; `HANDOVER.md` release-historie bijgewerkt.

**Acceptatiecriteria**

1. Elke dashboardnavigatie toont vrijwel direct (~100 ms) een skelet of laadindicator; geen "bevroren" klik meer.
2. Per server-render worden `supabase.auth.getUser()`, de profiel-query en `haalFondsConfig` aantoonbaar maximaal 1× uitgevoerd (verifieerbaar via tijdelijke dev-logging; logging verwijderd vóór merge).
3. Auth- en tenantgedrag ongewijzigd: uitgelogde gebruiker wordt geredirect; platform-identiteit zonder profielrij wordt geweerd; enforce-/observe-gedrag en `[TENANT-RESOLVE]`-logging identiek.
4. Speed Insights levert per-route veldmetingen in het Vercel-dashboard. De regiofix (functions `iad1` → `arn1`, colocatie met Supabase Stockholm) is geverifieerd na deploy; het vóór/ná-effect op TTFB wordt met Speed Insights-data gedocumenteerd in de terugkoppeling.
5. Geen wijziging in governance-events, RLS-policies, migraties of API-contracten.

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md` (samenvatting, aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's). Neem daarin ook een korte voor/na-observatie op van de navigatie-ervaring op de homepage en `vergaderingen/[id]`.
