-- ============================================================================
-- ROLLBACK 2026-07-10 — T11: tenant-veilige data-laag stuurinformatie + klantbeeld
-- ----------------------------------------------------------------------------
-- Verwijdert de drie T11-datatabellen (incl. RLS-policies via cascade van drop
-- table). Draai eerst de seed-ROLLBACK (of accepteer dat de seed-rijen mee
-- vallen bij drop table). Idempotent (drop ... if exists).
-- ============================================================================

begin;

drop table if exists public.fonds_klantbeeld_cohort;
drop table if exists public.fonds_stuurinfo_reeks;
drop table if exists public.fonds_stuurinfo_kpi;

commit;
