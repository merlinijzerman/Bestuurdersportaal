-- ============================================================================
-- ROLLBACK van 2026_08_06_demo_fondsen_bootstrap.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de drie demo-fondsen met hun configuratielaag.
--
-- ⚠️ LEES DIT VOORDAT JE DRAAIT.
--   `fondsen` is de tenant-root. Vrijwel elke tenant-tabel draagt
--   `fonds_id -> fondsen(id)`, veelal met ON DELETE CASCADE. Een delete op
--   `fondsen` verwijdert dus NIET alleen de configuratie maar ALLES wat onder
--   het fonds is aangemaakt: documenten, chunks, dossiers, vergaderingen,
--   organisatieprofiel, auditregels. Dat is onomkeerbaar.
--
--   Deze rollback is daarom bedoeld voor de situatie "de seed is net gedraaid
--   en er is nog niets mee gedaan". Is er al inhoud geladen of heeft er een
--   gebruiker ingelogd, gebruik dan §A en laat de fondsen staan.
--
--   Stap 1 hieronder is een harde gate: hij faalt met een duidelijke melding
--   zodra er documenten of profielen aan een van de drie fondsen hangen.
--
-- VOLGORDE: draai eerst 2026_08_06_tenant_domains_demo_fondsen_ROLLBACK.sql
-- (die verwijst met een foreign key naar deze fondsen).
-- ============================================================================

-- ── §A. Alleen de configuratielaag terugdraaien (fondsen blijven bestaan) ────
-- Gebruik dit als er al iets met de fondsen is gedaan.
--
-- delete from public.fonds_feature_flags
--  where fonds_id in (select id from public.fondsen
--                      where slug in ('pgb','phenc','huisartsenpensioen'));
-- delete from public.fonds_module_manifest
--  where fonds_id in (select id from public.fondsen
--                      where slug in ('pgb','phenc','huisartsenpensioen'));
-- delete from public.fonds_theming
--  where fonds_id in (select id from public.fondsen
--                      where slug in ('pgb','phenc','huisartsenpensioen'));
-- NB: fonds_config_log is append-only en blijft bestaan — dat is het auditspoor
-- van de wijziging, geen configuratie.

-- ── §B. Volledige rollback (fondsen verwijderen) ────────────────────────────

begin;

-- 1. Harde gate: weiger zodra er inhoud of gebruikers aan hangen.
do $$
declare
  v_docs   integer;
  v_prof   integer;
begin
  select count(*) into v_docs
    from public.documenten d
    join public.fondsen f on f.id = d.fonds_id
   where f.slug in ('pgb','phenc','huisartsenpensioen');

  select count(*) into v_prof
    from public.profielen p
    join public.fondsen f on f.id = p.fonds_id
   where f.slug in ('pgb','phenc','huisartsenpensioen');

  if v_docs > 0 or v_prof > 0 then
    raise exception
      'Rollback geweigerd: % document(en) en % gebruiker(s) hangen aan deze fondsen. Een delete op fondsen cascadeert en zou die data vernietigen. Gebruik §A, of ruim eerst bewust op.',
      v_docs, v_prof;
  end if;
end $$;

-- 2. Configuratie expliciet weg (zou ook cascaderen; expliciet = leesbaar).
delete from public.fonds_feature_flags
 where fonds_id in (select id from public.fondsen
                     where slug in ('pgb','phenc','huisartsenpensioen'));

delete from public.fonds_module_manifest
 where fonds_id in (select id from public.fondsen
                     where slug in ('pgb','phenc','huisartsenpensioen'));

delete from public.fonds_theming
 where fonds_id in (select id from public.fondsen
                     where slug in ('pgb','phenc','huisartsenpensioen'));

-- 3. De fondsen zelf.
delete from public.fondsen
 where slug in ('pgb','phenc','huisartsenpensioen');

commit;

-- Controle: verwacht 0 rijen.
-- select slug from public.fondsen
--  where slug in ('pgb','phenc','huisartsenpensioen');
