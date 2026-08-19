-- ============================================================================
-- ROLLBACK voor 2026_07_10_aqlab_3_governance.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de AQLab governance-tabellen + append-only-triggers. Draai dit
-- als EERSTE van de drie aqlab-rollbacks (aqlab_3 → aqlab_2 → aqlab_1).
-- fn_log_append_only() wordt NIET gedropt: die is gedeeld met de bestaande
-- *_log-tabellen (fonds_config_log e.a.) en hoort bij een eerdere migratie.
-- Idempotent (drop ... if exists). Transactioneel.
-- ============================================================================

begin;

drop trigger if exists trg_aqlab_audit_exports_no_delete     on public.aqlab_audit_exports;
drop trigger if exists trg_aqlab_audit_exports_no_update     on public.aqlab_audit_exports;
drop trigger if exists trg_aqlab_release_decisions_no_delete on public.aqlab_release_decisions;
drop trigger if exists trg_aqlab_release_decisions_no_update on public.aqlab_release_decisions;
drop trigger if exists trg_aqlab_log_no_delete               on public.aqlab_log;
drop trigger if exists trg_aqlab_log_no_update               on public.aqlab_log;

drop index if exists public.idx_aqlab_log_object;
drop index if exists public.idx_aqlab_log_tijd;
drop index if exists public.idx_aqlab_audit_run;
drop index if exists public.idx_aqlab_release_feature;
drop index if exists public.idx_aqlab_release_run;

-- FK release → audit_exports eerst weg (anders blokkeert de drop-volgorde niet,
-- maar expliciet voor de duidelijkheid).
alter table if exists public.aqlab_release_decisions
  drop constraint if exists aqlab_release_audit_export_fk;

drop table if exists public.aqlab_log;
drop table if exists public.aqlab_audit_exports;
drop table if exists public.aqlab_release_decisions;

commit;
