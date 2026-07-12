# 0065 — D1: service-role weg van de gedeelde surface via SECURITY DEFINER-RPC's

- **Status:** Geaccepteerd
- **Datum:** 2026-07-12
- **Betrokkenen:** Merlin (akkoord), Ontwikkeling (werkopdracht C1)

## Context

Werkopdracht C1 (variant B→C) eist dat `SUPABASE_SERVICE_ROLE_KEY` — het enige RLS-omzeilende
secret — straks UITSLUITEND in het geïsoleerde beheer-project leeft (Fase B, criterium 2). Bij
verificatie tegen de code bleek de gedeelde (app/publiek) surface de service-role nog op twee paden
nodig te hebben, in strijd met de aanname dat service-role alleen in de platform-back-office zit:

1. **host→fonds-resolutie** (`core/lib/tenant-domains.ts` → `(dashboard)/layout.tsx`, elke tenant-load):
   las de volledige `tenant_domains`-mapping met de service-role (tabel is bewust deny-by-default, 0040).
2. **publieke contactinzending** (`app/api/contact/route.ts`): insert + rate-limit-COUNT +
   notificatie-status-UPDATE in `contact_aanvragen` (bewust deny-by-default, REQ-PV-042).

De `(dashboard)/layout`-resolutie is `try/catch` fail-open zolang `TENANT_ENFORCE` uit staat; de
sleutel daar nu weghalen zou "werken" tot enforce aan gaat (zelf een harde pre-PGB-eis) — dat is
schijnzekerheid (CLAUDE.md). Het contactformulier zou direct breken. Criterium 2 is dus niet
haalbaar zolang deze paden de service-role vereisen.

## Besluit

De twee gedeelde paden worden **key-vrij** gemaakt met **`SECURITY DEFINER`-RPC's**, aanroepbaar met
de **anon-key**; de tabellen blijven **deny-by-default** (géén nieuwe policy). Migratie
`2026_07_12_d1_service_role_rpcs.sql`:

- `resolve_tenant_host(p_host text)` — geeft 0/1 ACTIEVE rij voor een genormaliseerde host. Strikt
  minder blootstelling dan een full-table-read; geen enumeratie van de volledige mapping mogelijk.
- `contact_aanvraag_insert(...)` — insert MÉT ingebouwde rate-limit (max 3/10 min per ip_hash;
  `status ok|rate_limited`), vervangt de losse service-role-COUNT.
- `contact_notificatie_status(p_id, p_verzonden, p_error)` — post-mail-ops-velden.

Alle drie: `security definer`, `set search_path = public, pg_temp`, `revoke all from public` +
`grant execute to anon, authenticated`. De RLS-bypass is strikt afgebakend tot de functie-bodies.
Code: cookieless anon-client `core/lib/supabase-anon.ts`; de resolver resolveert per host via de RPC
met een gesleutelde (per-host) TTL-cache (stale-fallback behouden); de contactroute draait op de
anon-client + de twee contact-RPC's. `core/lib/supabase-service.ts` blijft **bewust core** tot D1b.

## Overwogen alternatieven

- **Full-list-RPC `list_active_tenant_domains()`** (anon-EXECUTE) — afgewezen: minimale code, maar
  stelt de volledige host→fonds-mapping bloot aan anon en draait daarmee de bewuste deny-by-default
  van 0040 terug. De single-host-RPC honoreert die posture.
- **Tenant-RLS-policies op `tenant_domains`/`contact_aanvragen`** — afgewezen: verbreedt het
  RLS-oppervlak op globale tabellen; de deny-by-default + smalle RPC is scherper en kleiner.
- **Aparte low-privilege DB-rol/sleutel in het gedeelde project** — afgewezen (nu): Supabase heeft
  één service-role; een eigen PostgREST-rol/JWT is nieuwe infra (richting B14-1), buiten scope.
- **Contact-POST naar het beheer-project proxyen + enforce-pad fail-open laten** — afgewezen:
  koppelt publiek→beheer en zet schijnzekerheid op het enforce-pad.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. Geen tabelpolicy; beide tabellen zijn globaal/niet-tenant
  (geen `fonds_id`-RLS). De functies raken geen enkele per-fonds tenant-tabel.
- **Security:** de gedeelde surface heeft de service-role niet meer nodig voor deze twee paden; de
  sleutel kan in Fase B uit de gedeelde env. `search_path` gepind (hijack-hardening).
- **Kanttekening:** `contact_notificatie_status` laat anon twee ops-velden (bool + errortekst) op een
  rij-id zetten — geen tenant/PII-data, UUID onraadbaar; bewust geaccepteerd.
- **Migratie-eerst:** de migratie is standalone veilig (nog geen code roept ze aan); de code-switch
  deployt erna. Rollback: functies droppen + code reverten (oude paden werken zolang de sleutel er is).
- **D1b — UITGEVOERD (2026-07-12):** de tenant-facing routes `app/api/aqlab/assurance` en
  `app/api/aqlab/assurance/audit/[exportId]` draaien niet meer op de service-role. Migratie
  `2026_07_12_d1b_assurance_rpcs.sql`: `aqlab_assurance_meetwaarden(codes)` (curatie IN SQL — het
  rauwe aggregatie-blob verlaat de DB niet), `aqlab_audit_export_bron(id)` (alleen vrijgegeven →
  geen pad-lek), `aqlab_log_download(id)` (append-only), + een storage-policy op `aqlab-audit`
  (authenticated leest alleen vrijgegeven objecten). Manifest via RLS (geen RPC). `assurance.ts` +
  de twee routes gebruiken nu de sessie-client. **Adversariële RLS/storage-review:** geen
  tenant-isolatie-blocker (aqlab-data is productbreed/geen fonds_id; manifest via `auth.uid()`);
  B1 (over-exposure heel aggregatie-blob) → gecureerd in SQL; K1 (embargo-pad-lek) → null tenzij
  vrijgegeven; O1 (manifest hoefde geen RPC) → via RLS; O2 (log-spam) → alleen vrijgegeven. Bewuste
  keuze (K2): elke bestuurder mag elk vrijgegeven (productbreed) rapport lezen — geen tenant-lek.
- **Criterium 2 — precondition gehaald:** na D1+D1b is er GEEN service-role-consument meer op de
  gedeelde (app/publiek) surface; `supabase-service.ts` is naar `platform/lib` verhuisd en de
  leak-check is aangescherpt tot uitsluitend `platform/lib/*`. De sleutelrotatie + het weghalen uit
  de gedeelde env gebeurt in Fase B (de Vercel-projectsplitsing).

## Referenties

- Migratie `supabase/migrations/2026_07_12_d1_service_role_rpcs.sql` (+ ROLLBACK);
  `supabase/schema.sql` (D1-documentatieblok)
- Code: `core/lib/supabase-anon.ts`, `core/lib/tenant-domains.ts`, `core/lib/tenant-domains-cache.ts`,
  `core/lib/tenant-context.ts`, `app/api/contact/route.ts`
- Werkopdracht C1 (Fase B criterium 2); besluit [`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md)
  (deny-by-default tenant_domains), [`0052`](./0052-t9-code-scheiding-mapconventie-eslint-boundaries.md) (code-scheiding)

## Security-review + hardening (2026-07-12)

Adversariële RLS/security-review op de migratie + code. **Uitkomst:** tenant-isolatie **intact**
(geen RPC raakt een per-`fonds_id`-tabel), `search_path`/grants/idempotentie/rollback/append-only
correct, `resolve_tenant_host` lekt de mapping niet — **geen blocker**. Twee "belangrijk"-bevindingen
op de nu anon-bereikbare publieke schrijf-surface, met follow-up-migratie
`2026_07_12_d1_hardening.sql`:

- **B1** — `contact_aanvraag_insert` is met de publieke anon-key direct aanroepbaar (buiten de
  route-guards om) en de rate-limit leunt op de caller-parameter `p_ip_hash` → bypass-baar. Dit is
  een bewuste posture-wijziging t.o.v. REQ-PV-042. **Mitigatie (gedaan):** lengte-CHECK
  `contact_aanvragen_lengtes` (payload-cap == VELD_MAX) tegen storage-bom. **Restrisico:**
  ongeauthenticeerde, ongelimiteerde *volume*-inserts van begrensde inhoud (spam in de contact-inbox).
  Correcte vervolgstap = een form-side bot-mitigatie. **Gekozen + geïmplementeerd (2026-07-12):
  Cloudflare Turnstile** op het contactformulier + serverside token-verificatie in `/api/contact`
  (siteverify). Widget expliciet gerenderd in `ContactForm.tsx` (token in de POST); de route dwingt af
  zodra `TURNSTILE_SECRET_KEY` gezet is (soft-config: zonder secret → overslaan, voor lokaal/dev),
  fail-open alleen bij een eigen netwerkfout. CSP in `next.config.ts` uitgebreid met
  `challenges.cloudflare.com` (script-/frame-/connect-src). Keys: site-key `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  (publiek), secret `TURNSTILE_SECRET_KEY` (gedeelde server-env — smal bot-secret, géén service-role).
  Hiermee is het B1-restrisico afgedekt: een directe RPC-aanroep mist de bot-verificatie die de route
  nu vóór de insert afdwingt.
- **B2** — `contact_notificatie_status` kon elke rij op `id` muteren (integriteit opvolg-status; de
  `mail_error`-XSS is niet realiseerbaar want de back-office rendert via JSX-escaping). **Mitigatie
  (gedaan):** one-shot gescope't (recente, nog niet gemarkeerde rij) + `mail_error` gekapt op 500.
- **K1** (rate-limit-race, geen regressie — niet gefixt) en **K2** (succes-pad logde de notificatie-
  RPC-fout niet — **gefixt** in `app/api/contact/route.ts`).

Least-privilege-observatie (niet gewijzigd, harmloos): de `grant … to authenticated` is voor de drie
RPC's overbodig omdat ze uitsluitend via de cookieless anon-client (rol `anon`) worden aangeroepen.
