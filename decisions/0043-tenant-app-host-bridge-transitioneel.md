# 0043 — Transitionele bridge: gedeelde app-host → Horizon (single-tenant)

- **Status:** Geaccepteerd
- **Datum:** 2026-07-08
- **Betrokkenen:** Merlin (akkoord), Claude (uitvoering)

## Context

T1.3 (besluit 0042) maakt de host→fonds-afdwinging fail-closed achter
`TENANT_ENFORCE`. De canonieke per-fonds-host `horizon.bestuurdersportaal.com` is
geseed, maar staat **nog niet in DNS**: de pilotgebruikers loggen vandaag in op de
**gedeelde app-host** `app.bestuurdersportaal.com` (prod `APP_HOST`, sinds W0
livegang 29-06-2026). Zou `TENANT_ENFORCE=on` gaan met alleen de per-fonds-host
geseed, dan resolveert de app-host `onbekend` en worden alle huidige gebruikers
geweigerd. Merlin wil dat de bestaande URL `app.bestuurdersportaal.com` blijft
werken.

Randvoorwaarde: er is op dit moment feitelijk **één fonds** (Horizon); PGB bestaat
nog niet in de database.

## Besluit

We seeden de gedeelde app-host `app.bestuurdersportaal.com` **óók** naar het
Horizon-fonds (via `fondsen.slug='horizon'`), als **bewust transitionele bridge**.
Zo laat de fail-closed afdwinging zowel de bestaande app-host als de per-fonds-host
door zolang Horizon de enige tenant is. De bridge is een **aparte migratie**
(`2026_07_08_tenant_domains_bridge_app_host.sql` + `_ROLLBACK`) en **moet worden
verwijderd (rollback) vóór het onboarden van een tweede fonds**.

## Overwogen alternatieven

- **Geen bridge — eerst DNS + gebruikersmigratie naar de per-fonds-host** —
  verworpen voor nu: schoner qua model, maar blokkeert `TENANT_ENFORCE=on` tot DNS
  staat én alle pilotgebruikers zijn verhuisd. Blijft het einddoel (zie Gevolgen).
- **Bridge (gekozen)** — laat enforce nu al aan zolang single-tenant, met expliciet
  belegde, terugdraaibare schuld.
- **Bridge blijvend laten staan** — verworpen: een gedeelde host kan niet naar één
  fonds resolven zodra er een tweede fonds is; een tweede-fonds-gebruiker op
  `app.*` zou naar Horizon resolven → `fonds-mismatch` → geweigerd. Daarom is
  verwijderen vóór het tweede fonds een harde voorwaarde.

## Gevolgen

- **Afdwinging:** `TENANT_ENFORCE=on` kan aan terwijl single-tenant; Horizon-
  gebruikers passeren op zowel `app.bestuurdersportaal.com` als
  `horizon.bestuurdersportaal.com`.
- **RLS/tenant-isolatie:** ongewijzigd. RLS per `fonds_id` blijft primair; dit
  raakt alleen de host→fonds-mapping (defense-in-depth).
- **Bewust belegde schuld (harde voorwaarde):** het per-fonds-model is op de
  gedeelde host tijdelijk opgerekt. **Vóór** het onboarden van een tweede fonds
  (bv. PGB) moet de bridge via `_ROLLBACK` weg, en moeten gebruikers hun eigen
  per-fonds-host gebruiken. Genoteerd bij het PGB-onboardingpunt in HANDOVER.
- **Datamodel/migraties:** één extra idempotente seed-rij; geen schemawijziging.
- **Einddoel:** `horizon.bestuurdersportaal.com` in DNS zetten en de pilot daarheen
  verhuizen; dan kan de app-host-bridge vervallen ook binnen single-tenant.

## Referenties

- Besluit [`0042`](./0042-tenant-enforce-fail-closed-env-schakelaar.md) (fail-closed enforce),
  [`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md) (B4),
  [`0029`](./0029-publieke-voorkant-host-indeling.md) (`APP_HOST`, fail-safe app-surface)
- Migratie: [`2026_07_08_tenant_domains_bridge_app_host.sql`](../supabase/migrations/2026_07_08_tenant_domains_bridge_app_host.sql)
