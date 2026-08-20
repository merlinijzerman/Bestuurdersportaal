-- ============================================================================
-- ROLLBACK van 2026_07_08_tenant_domains_seed.sql — verwijder de Horizon-seed.
-- ----------------------------------------------------------------------------
-- Verwijdert uitsluitend de door de seed toegevoegde mappingrij. De tabel zelf
-- (2026_07_08_tenant_domains.sql) blijft staan. Na rollback resolveert de host
-- weer `onbekend`; zet daarom TENANT_ENFORCE eerst uit voordat je dit draait,
-- anders sluit enforce iedereen buiten (besluit 0042).
-- ============================================================================

delete from public.tenant_domains
where host = 'horizon.bestuurdersportaal.com';
