-- ROLLBACK van 2026_08_29_p4_04_status_feitenmatrix.sql (P4 tranche 4).
begin;
drop trigger if exists trg_besluitstatus_feit on public.decision_objects;
drop function if exists public.fn_guard_besluitstatus_feit();
drop function if exists public.fn_toets_besluitstatus_feit(uuid, text);
drop table if exists public.besluitstatus_vereist_feit;
alter table public.procedure_besluiten
  drop constraint if exists procedure_besluiten_uitkomst_check,
  drop column if exists uitkomst;
commit;
