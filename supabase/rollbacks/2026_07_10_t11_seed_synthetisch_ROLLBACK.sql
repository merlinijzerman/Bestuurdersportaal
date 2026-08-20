-- ============================================================================
-- ROLLBACK 2026-07-10 — T11 SEED (synthetische aggregaatdata + module-config)
-- ----------------------------------------------------------------------------
-- Verwijdert de geseede T11-data voor 'horizon' en 'meridiaan' en de T11-
-- module-config (config terug naar '{}'; module blijft actief). Laat de tabellen
-- staan (die verwijder je met 2026_07_10_t11_stuurinfo_klantbeeld_data_ROLLBACK.sql).
-- Idempotent.
-- ============================================================================

begin;

delete from public.fonds_klantbeeld_cohort
 where fonds_id in (select id from public.fondsen where slug in ('horizon','meridiaan'));

delete from public.fonds_stuurinfo_reeks
 where fonds_id in (select id from public.fondsen where slug in ('horizon','meridiaan'));

delete from public.fonds_stuurinfo_kpi
 where fonds_id in (select id from public.fondsen where slug in ('horizon','meridiaan'));

-- Config terug naar leeg (module blijft beschikbaar; geen manifest-rij verwijderen
-- omdat die ook 'actief' kan borgen — alleen de T11-config leegmaken).
update public.fonds_module_manifest
   set config = '{}'::jsonb, bijgewerkt = now()
 where module_key in ('stuurinformatie','klantbeeld')
   and fonds_id in (select id from public.fondsen where slug in ('horizon','meridiaan'));

commit;
