-- ============================================================================
-- ROLLBACK 2026-07-09 — T8: backfill hybride_zoeken → fonds_feature_flags
-- ----------------------------------------------------------------------------
-- Verwijdert uitsluitend de door de backfill aangemaakte hybride_zoeken-flags.
-- fonds_instellingen (de bron) blijft ongemoeid. Idempotent.
-- ============================================================================

begin;

delete from public.fonds_feature_flags where flag_key = 'hybride_zoeken';

commit;
