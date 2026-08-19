-- ============================================================================
-- ROLLBACK voor 2026_07_10_aqlab_1_register.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de AQLab register-tabellen in omgekeerde afhankelijkheidsvolgorde.
-- Let op: draai eerst aqlab_3- en aqlab_2-rollbacks (die verwijzen naar deze
-- tabellen) voordat je deze rollback draait.
-- Idempotent (drop ... if exists). Transactioneel.
-- ============================================================================

begin;

drop index if exists public.idx_aqlab_fixtures_code_versie;
drop index if exists public.idx_aqlab_prompt_versions_feat;
drop index if exists public.idx_aqlab_tcf_fixture;
drop index if exists public.idx_aqlab_test_cases_soort;
drop index if exists public.idx_aqlab_test_cases_feature;
drop index if exists public.idx_aqlab_test_cases_set;
drop index if exists public.idx_aqlab_test_sets_feature;

drop table if exists public.aqlab_model_configurations;
drop table if exists public.aqlab_prompt_versions;
drop table if exists public.aqlab_test_case_fixtures;
drop table if exists public.aqlab_test_cases;
drop table if exists public.aqlab_fixture_documents;
drop table if exists public.aqlab_test_sets;
drop table if exists public.aqlab_ai_features;

commit;
