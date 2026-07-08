# 0041 — Host→fonds-resolutie: observe-fase logt via gestructureerde serverlog

- **Status:** Geaccepteerd
- **Datum:** 2026-07-08
- **Betrokkenen:** Merlin (akkoord), Claude (uitvoering)

## Context

T1.2 maakt de host→fonds-resolutie (besluit 0040, B4) runtime, maar bewust
**observerend**: per request wordt de fondscontext uit de host bepaald en gelogd
(inclusief een mismatch host-fonds ↔ profiel-fonds), zonder te blokkeren. De
harde, fail-closed afdwinging is T1.3, ná het seeden van `tenant_domains` voor de
pilothosts. De werkopdracht vraagt een **licht** auditkanaal en géén nieuwe zware
tabel; een sub-keuze hierover moet als besluit worden vastgelegd.

Randvoorwaarden: de binding draait op de centrale tenant-entry
(`app/(dashboard)/layout.tsx`) en dus **per request/pageload**; de datalaag cachet
`tenant_domains` juist om niet elke request de DB te raken; het bestaande
append-only auditspoor mag niet vervuild raken; geen PII in logs.

## Besluit

De observe-fase (T1.2) logt de resolutie-uitkomst en mismatch via een
**gestructureerde server-log** (`console.warn` met vaste prefix `[TENANT-RESOLVE]`,
zichtbaar in de Vercel-serverlogs): `host`, `resolutie` (`gevonden`/`onbekend`),
`hostFondsId`, `sessieFondsId`, `mismatch`, `gebruikerId` (UUID) — geen naam/e-mail.
**Proportioneel/conditioneel:** er wordt alleen gelogd bij een **anomalie** (host
`onbekend` óf host-fonds ≠ profiel-fonds); de happy path (gevonden + match) blijft
stil, zodat afwezigheid-van-warns "host→fonds klopt" aantoont en de log-/UUID-
frequentie beperkt blijft. Er komt in T1.2 **geen** nieuwe tabel en **geen** migratie.

## Overwogen alternatieven

- **`platform_event_log`** — verworpen: dat kanaal is structureel platform-scoped
  (`identity_id NOT NULL → platform_identities`, `capability NOT NULL →
  platform_capabilities`, twee-fasen + hash-keten). Een tenant-side observe-signaal
  past daar semantisch niet in en zou een neppe platform-identiteit/capability
  vergen.
- **`governance_log`** — verworpen: dat is het AI-interactie-auditspoor
  (vraag/antwoord, fonds-scoped). Per-pageload schrijven zou het vervuilen, en bij
  een mismatch is onduidelijk onder welk fonds je logt.
- **Nieuwe `tenant_resolve_log`-tabel** — verworpen voor de observe-fase: een
  per-request DB-write botst met het cache-doel en introduceert een tabel +
  migratie voordat we weten of de meting dat vereist. Blijft open als optie voor
  T1.3 als de meting om een doorzoekbaar DB-spoor vraagt.
- **Gestructureerde serverlog** — gekozen: proportioneel voor observeren,
  greppelbaar in Vercel-logs, geen per-request DB-writes, geen PII, geen
  vervuiling van het append-only spoor.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. De service-role wordt uitsluitend voor de
  `tenant_domains`-read gebruikt (globale, niet-tenant-tabel); anon-key + RLS blijft
  de tenant-isolatie.
- **Audit/reproduceerbaarheid:** de observe-meting leeft in de serverlogs, buiten
  het append-only auditspoor. Bewust geaccepteerde beperking: serverlogs zijn
  vluchtig (retentie afhankelijk van het platform) en niet hash-geketend — voor een
  tijdelijke observe-fase volstaat dat om host→fonds te valideren vóór T1.3.
- **Datamodel/migraties:** geen wijziging in T1.2.
- **Beheer/uitrol:** zolang `tenant_domains` niet geseed is, logt de binding
  `onbekend` — verwacht en niet-blokkerend. T1.3 kan alsnog een DB-spoor toevoegen.

## Referenties

- Besluit [`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md) (B4)
- Beslisnotitie *Multi-tenant frontend en modulescheiding v0.4* (`02 Architectuur/`)
- Code: [`lib/tenant-domains.ts`](../lib/tenant-domains.ts), [`lib/tenant-context.ts`](../lib/tenant-context.ts), [`app/(dashboard)/layout.tsx`](../app/(dashboard)/layout.tsx)
- T1.1: [`lib/tenant-host.ts`](../lib/tenant-host.ts), migratie [`2026_07_08_tenant_domains.sql`](../supabase/migrations/2026_07_08_tenant_domains.sql)
