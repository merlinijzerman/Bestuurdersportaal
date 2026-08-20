-- ============================================================================
-- ROLLBACK van 2026_07_08_tenant_domains_bridge_app_host.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de transitionele app-host→Horizon-bridge. Draai dit VÓÓR het
-- onboarden van een tweede fonds (besluit 0043), zodat de gedeelde app-host niet
-- langer naar één fonds resolveert. Na verwijdering resolveert de app-host weer
-- `onbekend`; onder TENANT_ENFORCE=on worden gebruikers op die host dan geweigerd
-- (verwacht — ze horen dan op hun eigen per-fonds-host binnen te komen).
-- ============================================================================

delete from public.tenant_domains
where host = 'app.bestuurdersportaal.com';
