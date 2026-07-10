-- ============================================================================
-- ROLLBACK voor 2026_07_10_aqlab_2_runs.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de AQLab run-/output-/score-tabellen in omgekeerde volgorde.
-- Draai vóór aqlab_1-rollback en NA aqlab_3-rollback.
-- Idempotent (drop ... if exists). Transactioneel.
-- ============================================================================

begin;

drop index if exists public.idx_aqlab_reviews_output;
drop index if exists public.idx_aqlab_findings_output;
drop index if exists public.idx_aqlab_findings_score;
drop index if exists public.idx_aqlab_scores_output;
drop index if exists public.idx_aqlab_run_outputs_tc;
drop index if exists public.idx_aqlab_run_outputs_run;
drop index if exists public.idx_aqlab_runs_baseline;
drop index if exists public.idx_aqlab_runs_test_set;

drop table if exists public.aqlab_human_reviews;
drop table if exists public.aqlab_findings;
drop table if exists public.aqlab_scores;
drop table if exists public.aqlab_run_outputs;
drop table if exists public.aqlab_runs;

commit;
