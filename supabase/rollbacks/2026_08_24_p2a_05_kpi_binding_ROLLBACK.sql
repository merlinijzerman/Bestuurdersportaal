-- ROLLBACK van P2/PR-A kpi-binding (decision_conditions). HAND-RUN.
begin;
drop trigger if exists trg_kpi_audit_binding on public.decision_conditions;
drop function if exists public.fn_audit_kpi_binding();
drop trigger if exists trg_kpi_validate_binding on public.decision_conditions;
drop function if exists public.fn_validate_kpi_binding();
drop index if exists public.idx_kpi_req_sleutel;
alter table public.decision_conditions drop column if exists requirement_sleutel;
commit;
