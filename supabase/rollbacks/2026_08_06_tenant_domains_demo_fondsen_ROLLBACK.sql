-- ============================================================================
-- ROLLBACK van 2026_08_06_tenant_domains_demo_fondsen.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de host→fonds-mappings van de drie demo-fondsen. Puur routing:
-- geen impact op documenten, gebruikers of andere fondsdata.
--
-- ⚠️ Draai dit NIET terwijl TENANT_ENFORCE=on staat en er gebruikers op deze
-- hosts werken: zonder rij resolveert de host als `onbekend` en worden zij
-- fail-closed geweigerd. Zet dan eerst enforce uit, of verwijder eerst het
-- domein in Vercel zodat er geen verkeer meer op binnenkomt.
--
-- De rij `app.bestuurdersportaal.com -> horizon` wordt hier NIET geraakt
-- (besluit 0135: dat is de vaste tenant-host van Horizon).
-- ============================================================================

begin;

delete from public.tenant_domains
 where host in (
   'pgb.bestuurdersportaal.com',
   'phenc.bestuurdersportaal.com',
   'huisartsenpensioen.bestuurdersportaal.com'
 );

commit;

-- Controle: verwacht 0 rijen.
-- select host from public.tenant_domains
--  where host in ('pgb.bestuurdersportaal.com',
--                 'phenc.bestuurdersportaal.com',
--                 'huisartsenpensioen.bestuurdersportaal.com');
