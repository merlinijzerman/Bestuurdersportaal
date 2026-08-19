-- ============================================================================
-- ROLLBACK voor 2026_07_12_aqlab_7_run_outputs_provider.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de AQL-6 model_provider-kolom van aqlab_run_outputs.
-- Idempotent (drop column if exists). Transactioneel.
-- LET OP: rol eerst de code terug (die schrijft model_provider) vóór deze rollback.
-- ============================================================================

begin;

alter table public.aqlab_run_outputs
  drop column if exists model_provider;

commit;
