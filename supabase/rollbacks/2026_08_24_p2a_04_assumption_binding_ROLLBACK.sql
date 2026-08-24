-- ROLLBACK van P2/PR-A assumption-binding (decision_assumptions). HAND-RUN.
begin;
drop trigger if exists trg_assumption_audit_binding on public.decision_assumptions;
drop function if exists public.fn_audit_assumption_binding();
drop trigger if exists trg_assumption_validate_binding on public.decision_assumptions;
drop function if exists public.fn_validate_assumption_binding();
drop index if exists public.idx_assumption_req_sleutel;
alter table public.decision_assumptions drop column if exists requirement_sleutel;
commit;
