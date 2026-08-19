-- ============================================================================
-- Migratie 2026-07-08 — Seed host→fonds-mapping: pilothost Horizon.
-- ----------------------------------------------------------------------------
-- Vult public.tenant_domains met de canonieke pilothost, zodat de fail-closed
-- host→fonds-afdwinging (T1.3, besluit 0042) echte hosts kan resolven. Zonder
-- deze seed resolveert elke host `onbekend` en zou enforce iedereen buitensluiten
-- (daarom is deze seed een HARDE GATE vóór TENANT_ENFORCE=on — zie besluit 0042).
--
-- FONDSVERWIJZING VIA slug, NIET via UUID:
--   De productie-UUID's staan bewust niet in de repo. We resolven fonds_id via de
--   stabiele natuurlijke sleutel `fondsen.slug` ('horizon'). Bestaat die rij niet,
--   dan inserten we niets (fail-safe, geen kapotte FK).
--
-- HOST GENORMALISEERD: lowercase, geen poort, geen leidende www. — identiek aan
-- lib/platform-host.ts (normaliseerHost) / lib/tenant-host.ts.
--
-- PGB: nog geen fonds in de database; wordt geseed zodra dat fonds bestaat (de
-- INSERT ... SELECT-vorm hieronder is idempotent en veilig herhaalbaar).
--
-- Conventies: idempotent (ON CONFLICT (host) DO NOTHING); migratie-eerst-dan-
-- deploy; ROLLBACK-bestand apart.
-- ============================================================================

insert into public.tenant_domains (host, fonds_id, actief)
select 'horizon.bestuurdersportaal.com', f.id, true
from public.fondsen f
where f.slug = 'horizon'
on conflict (host) do nothing;
