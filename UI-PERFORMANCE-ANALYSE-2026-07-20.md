# UI-performance-analyse — sneller interacterende userinterface

**Datum:** 2026-07-20 · **Modus:** Analyse (geen wijzigingen) · **Scope:** `mvp/` (Next.js 15 App Router, React 19, Supabase, Vercel)

## Samenvatting

De trage interactie zit niet in één bottleneck maar in vier elkaar versterkende patronen: (1) elke navigatie blokkeert op een volledige server-render zonder enige laadindicator, (2) sequentiële query-waterfalls per pagina, (3) dubbele queries per navigatie doordat layout, page en helpers elk opnieuw sessie/profiel ophalen zonder request-cache, en (4) een mutatiepatroon (`fetch` → `router.refresh()`, 64×) dat na elke actie de complete route inclusief layout-queries opnieuw uitvoert, vrijwel zonder optimistic UI. De grootste waargenomen winst zit in de eerste twee quick wins hieronder; die raken geen governance-logica.

Alle bevindingen hieronder zijn geverifieerd in de code (bestandsverwijzingen per punt). Wat **niet** is gedaan: daadwerkelijke latencymetingen in productie. Aanbeveling is om parallel aan de eerste fixes veldmetingen aan te zetten (zie B7).

---

## Bevindingen (feiten, geverifieerd in code)

### B1 — Geen enkele laadstatus bij navigatie: alles blokkeert op de server-render

- **0** `loading.tsx`-bestanden en **0** `<Suspense>`-boundaries in de hele app.
- Alle dashboardroutes zijn dynamisch (cookies/auth), dus bij elke klik op een menu-item gebeurt er *niets zichtbaars* totdat de server álle queries heeft afgerond en de complete pagina terugstuurt.
- Bijeffect: Next.js prefetcht bij dynamische routes alleen tot de dichtstbijzijnde `loading.tsx`-boundary. Zonder die boundary levert prefetch dus vrijwel niets op — met boundary verschijnt het skelet direct bij de klik.

**Impact:** dit is de grootste bepaler van *waargenomen* traagheid. **Inspanning:** laag.

### B2 — Sequentiële query-waterfalls in server components

Voorbeeld homepage `app/(dashboard)/page.tsx`: `auth.getUser()` → profiel → volgende vergadering → agendapunten → mijn inbreng → `Promise.all` (4 streams) → eigenaar-filters → open stappen. Dat zijn **±7 sequentiële round trips** naar Supabase vóór de eerste byte HTML.

Zelfde patroon in o.a. `vergaderingen/[id]/page.tsx` (±7 stappen), `notulen/[id]`, `procedures/[id]`, `risicomatrix/[id]`, `governance/`. Het goede parallelpatroon bestaat al in de codebase (`dashboard/page.tsx` doet `Promise.all` na de gate; homepage gebruikt het voor de activiteitenstreams) — het is alleen niet consequent toegepast.

**Impact:** hoog, zeker als Vercel-regio en Supabase-regio niet gecoloceerd zijn (elke round trip telt dan dubbel). **Inspanning:** middel.

### B3 — Dubbele queries per navigatie; geen request-level cache

Per navigatie draaien minimaal twee keer dezelfde queries:

- `app/(dashboard)/layout.tsx`: `auth.getUser()` + profiel + host→fonds-resolutie + `haalFondsConfig` (theming/manifest/flags/overrides).
- De page zelf herhaalt `auth.getUser()` + profiel — rechtstreeks, of via `vereisModuleToegang` → `haalFondsSessie` (`core/lib/fonds-sessie.ts`) die het nogmaals doet.
- Nergens wordt `React.cache()` gebruikt; `supabase.auth.getUser()` is bovendien per aanroep een netwerkcall naar Supabase Auth.

**Belangrijk (guardrail):** dit gaat om *dedupliceren binnen één request*, niet om het verzwakken van de auth-gate. `React.cache()` per request verandert niets aan het beveiligingsmodel — dezelfde check, één keer uitgevoerd per render in plaats van twee à drie keer.

**Impact:** hoog (structureel, elke navigatie én elke `router.refresh()`). **Inspanning:** laag.

### B4 — Mutatiepatroon: `fetch` → `router.refresh()` (64×), nauwelijks optimistic UI

- Standaardflow in de formulieren en kaarten (o.a. `NieuweVergaderingForm`, `AgendapuntKaart`): submit → `await fetch(/api/...)` → `router.refresh()`. De gebruiker wacht op API-call **plus** volledige her-render van layout + page (inclusief alle queries uit B2/B3) voordat het resultaat zichtbaar is.
- `useTransition`/`useOptimistic`: samen slechts 12 vindplaatsen in de hele app.
- Diverse foutpaden gebruiken `alert()` (blokkerend, gedateerde UX).

**Governance-kanttekening:** optimistic UI is hier verenigbaar met de guardrails — de server/DB blijft de bron van waarheid en de audit-logging blijft server-side; alleen de *weergave* loopt vooruit op de bevestiging, met rollback bij een foutrespons. Voor stemmingen en besluitacties is een bewuste uitzondering verdedigbaar (daar mag bevestiging expliciet zichtbaar wachten).

**Impact:** hoog op de meest gebruikte interacties. **Inspanning:** middel (gericht, per interactie te doseren).

### B5 — Client-pagina's die pas ná mount data laden

`bibliotheek/page.tsx` (751 regels, client), `ai/page.tsx` (1.550 regels, client) en `profiel/page.tsx` laden hun initiële data via `useEffect` + `fetch`. Dat betekent: HTML laden → JS hydrateren → *dan pas* de datacall ("Documenten laden…"). Drie stappen waar één server-render volstaat.

**Impact:** middel-hoog op die schermen. **Inspanning:** middel (initiële data naar een server-parent, interactie in child-clients houden).

### B6 — Grote client-bundels, geen lazy loading

- Grootste client-components: `ai/page.tsx` (1.550), `StemrondeBlok` (995), `BeheerClient` (994), `StuurinfoInvoer` (986), `AgendapuntChat` (949), `ActieveStapPaneel` (880).
- **0** vindplaatsen van `next/dynamic`: modals, edit-panelen en chatblokken worden altijd meegeleverd en gehydrateerd, ook als de gebruiker ze nooit opent.
- Positief geverifieerd: de zware libraries (`xlsx`, `mammoth`, `jszip`, `unpdf`) worden uitsluitend server-side geïmporteerd en lekken dus niet naar de client-bundle. De chat-API streamt al via SSE (goed).

**Impact:** middel (hydratatietijd, mobiel merkbaar). **Inspanning:** laag per component.

### B7 — Geen veldmetingen

`@vercel/analytics` is aanwezig, maar `@vercel/speed-insights` niet — er is dus geen zicht op werkelijke TTFB/LCP/INP per route bij echte gebruikers. De CSP staat `*.vercel-insights.com` al toe.

**Impact:** randvoorwaarde om effect te bewijzen. **Inspanning:** zeer laag.

### B8 — Klein: afbeeldingen

6× raw `<img>` (logo's e.d.), 1× `next/image`. Marginaal effect; alleen meenemen als iets anders toch wordt aangeraakt.

---

## Aannames en openstaande vragen

1. **Aanname:** Vercel- en Supabase-regio zijn mogelijk niet gecoloceerd. **Vraag:** in welke regio's draaien beide? (Bepaalt hoe zwaar B2/B3 wegen.)
2. **Aanname:** de klacht betreft vooral navigatie- en interactietraagheid in het dashboard, niet de publieke marketingpagina's. **Vraag:** klopt dat, en zijn er specifieke schermen die het meest storen (bijv. vergaderingen-detail, AI-assistent)?
3. **Professionele inschatting:** voor een demo-/MVP-context weegt waargenomen snelheid (B1, B4) zwaarder dan ruwe serverlatency; bestuurders beoordelen het portaal op directheid van feedback.

---

## Aanbevolen aanpak (geprioriteerd op impact/inspanning)

| # | Maatregel | Bevinding | Impact | Inspanning | Risico |
|---|-----------|-----------|--------|------------|--------|
| 1 | `loading.tsx` + skeletons per routegroep (`(dashboard)`, detailroutes) | B1 | Hoog (waargenomen) | Laag | Geen |
| 2 | `React.cache()` om `haalFondsSessie`, profiel-query en `haalFondsConfig` | B3 | Hoog | Laag | Geen (zelfde checks, 1× per request) |
| 3 | Waterfalls parallelliseren op homepage + detailpagina's (`Promise.all`; evt. gecombineerde RPC/view voor samengestelde schermen) | B2 | Hoog | Middel | Laag |
| 4 | Optimistic UI + `useTransition` op frequente interacties; gerichte state-update i.p.v. blinde `router.refresh()` waar verantwoord; `alert()` vervangen door inline feedback | B4 | Hoog | Middel | Laag, mits stem-/besluitacties expliciet blijven wachten op bevestiging |
| 5 | Initiële data server-side voor bibliotheek, profiel en AI-pagina | B5 | Middel-hoog | Middel | Laag |
| 6 | `next/dynamic` voor modals, chat- en editpanelen | B6 | Middel | Laag | Geen |
| 7 | `@vercel/speed-insights` toevoegen + regiocheck Vercel↔Supabase | B7 | Meet-randvoorwaarde | Zeer laag | Geen |

**Voorgestelde volgorde:** eerst 7 (nulmeting) en 1+2 als quick wins in één werkopdracht; daarna 3 en 4 gedoseerd per scherm, te beginnen bij de meest gebruikte flows (vergaderingen, homepage).

## Acceptatiecriteria voor de eerste werkopdracht (1, 2, 7)

1. Elke dashboardnavigatie toont binnen ~100 ms een skelet of laadindicator (geen "bevroren" klik meer).
2. Per server-render wordt `supabase.auth.getUser()` en de profiel-query aantoonbaar maximaal 1× uitgevoerd (verifieerbaar via logging in dev).
3. Auth-gedrag ongewijzigd: uitgelogde gebruiker wordt nog altijd geredirect; tenant-enforcement (T1.2/T1.3) ongewijzigd; `tsc --noEmit` exit 0.
4. Speed Insights levert per-route veldmetingen in Vercel-dashboard.
5. Geen wijziging in governance-events, RLS of API-contracten.
