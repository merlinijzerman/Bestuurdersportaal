-- ============================================================================
-- Migratie 2026-07-08 — Transitionele bridge: app.bestuurdersportaal.com → Horizon.
-- ----------------------------------------------------------------------------
-- De canonieke per-fonds-host horizon.bestuurdersportaal.com staat nog niet in
-- DNS; de pilotgebruikers loggen nu in op de GEDEELDE app-host APP_HOST
-- (app.bestuurdersportaal.com). Om TENANT_ENFORCE=on te kunnen zetten zonder die
-- gebruikers buiten te sluiten, mapt deze migratie de app-host óók naar Horizon.
--
-- ⚠️ BEWUST TRANSITIONEEL (besluit 0043): dit werkt UITSLUITEND zolang Horizon het
-- enige fonds is. Een gedeelde app-host kan niet naar één fonds resolven zodra er
-- een tweede fonds bestaat (een tweede-fonds-gebruiker op app.* zou naar Horizon
-- resolven → mismatch → geweigerd). VERWIJDER deze rij (het _ROLLBACK-bestand)
-- vóór het onboarden van een tweede fonds (bv. PGB).
--
-- Fondsverwijzing via fondsen.slug (geen UUID in de repo); host genormaliseerd
-- (lowercase, geen poort, geen www.). Idempotent (ON CONFLICT DO NOTHING).
-- ============================================================================

insert into public.tenant_domains (host, fonds_id, actief)
select 'app.bestuurdersportaal.com', f.id, true
from public.fondsen f
where f.slug = 'horizon'
on conflict (host) do nothing;
