-- ============================================================================
-- ROLLBACK voor 2026_07_12_aqlab_8_reasoning_effort.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de AQL-6 reasoning_effort-kolommen. Idempotent (drop column if exists).
-- Transactioneel. Rol eerst de code terug (die schrijft deze kolommen).
-- ============================================================================

begin;

alter table public.aqlab_run_outputs
  drop column if exists reasoning_effort_effective;

alter table public.aqlab_model_configurations
  drop column if exists reasoning_effort_requested;

commit;
