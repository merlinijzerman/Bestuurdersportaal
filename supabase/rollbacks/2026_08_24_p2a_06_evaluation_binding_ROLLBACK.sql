-- ROLLBACK van P2/PR-A evaluation-binding (decision_evaluations). HAND-RUN.
begin;
drop trigger if exists trg_evaluation_audit_binding on public.decision_evaluations;
drop function if exists public.fn_audit_evaluation_binding();
drop trigger if exists trg_evaluation_validate_binding on public.decision_evaluations;
drop function if exists public.fn_validate_evaluation_binding();
drop index if exists public.idx_evaluation_req_sleutel;
alter table public.decision_evaluations drop column if exists requirement_sleutel;
commit;
