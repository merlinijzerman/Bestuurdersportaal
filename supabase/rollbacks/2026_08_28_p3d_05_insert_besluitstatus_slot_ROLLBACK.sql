-- ROLLBACK van 2026_08_28_p3d_05_insert_besluitstatus_slot.sql (P3/PR-D, #168, 0193).
begin;
drop trigger if exists trg_decision_insert_status_slot on public.decision_objects;
drop function if exists public.fn_guard_decision_insert_status();
commit;
