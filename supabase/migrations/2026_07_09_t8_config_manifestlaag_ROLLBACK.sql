-- ============================================================================
-- ROLLBACK 2026-07-09 — T8: configuratie-/manifestlaag
-- ----------------------------------------------------------------------------
-- Verwijdert de vijf T8-config-tabellen (policies + triggers vallen mee weg).
-- De gedeelde functie public.fn_log_append_only() blijft staan: die is van T3
-- (2026_07_08_t3_append_only_logs.sql) en wordt door andere logtabellen gebruikt.
-- Idempotent (drop ... if exists). Transactioneel.
-- LET OP: rol dit alléén terug vóór er config-data in productie op leunt.
-- ============================================================================

begin;

drop table if exists public.fonds_config_log cascade;
drop table if exists public.fonds_content_overrides cascade;
drop table if exists public.fonds_feature_flags cascade;
drop table if exists public.fonds_module_manifest cascade;
drop table if exists public.fonds_theming cascade;

commit;
