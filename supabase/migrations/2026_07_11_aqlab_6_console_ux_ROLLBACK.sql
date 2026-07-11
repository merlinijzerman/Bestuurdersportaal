-- ============================================================================
-- ROLLBACK voor 2026_07_11_aqlab_6_console_ux.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de AQL-5 console-UX-toevoegingen (run-naam + modelconfig-hash).
-- Idempotent (drop ... if exists). Transactioneel.
-- LET OP: dit verwijdert de config_hash-dedup; eventuele gepinde varianten
-- verliezen hun dedup-sleutel (de rijen zelf blijven bestaan).
-- ============================================================================

begin;

drop index if exists public.uq_aqlab_model_configurations_config_hash;
alter table public.aqlab_model_configurations drop column if exists config_hash;
alter table public.aqlab_runs drop column if exists naam;

commit;
