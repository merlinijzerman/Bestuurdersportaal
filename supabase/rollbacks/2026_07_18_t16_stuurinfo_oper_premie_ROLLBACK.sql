-- ============================================================================
-- ROLLBACK 2026-07-18 — T16: RPC's tabs 6 + 7 (stuurinfo_operationeel_opslaan
-- en stuurinfo_premie_opslaan)
-- ----------------------------------------------------------------------------
-- Draai EERST de seed-rollback (2026_07_18_t16b_…_seed_ROLLBACK.sql) als die
-- seed is uitgevoerd; daarna deze. Verwijdert uitsluitend de twee functies —
-- er zijn geen schema-/policywijzigingen om terug te draaien.
-- ============================================================================

begin;

drop function if exists public.stuurinfo_operationeel_opslaan(
  text, text, jsonb, numeric, numeric, numeric, jsonb, jsonb
);

drop function if exists public.stuurinfo_premie_opslaan(
  text, text, jsonb, jsonb, jsonb, numeric, numeric, numeric
);

commit;

-- Verificatie: beide functies weg —
--   select proname from pg_proc
--    where proname in ('stuurinfo_operationeel_opslaan','stuurinfo_premie_opslaan');
--   -- verwacht: 0 rijen
