-- ROLLBACK van P2/PR-A ai_validation-binding (decision_ai_interactions). HAND-RUN.
begin;
drop trigger if exists trg_aivalidation_audit_binding on public.decision_ai_interactions;
drop function if exists public.fn_audit_aivalidation_binding();
drop trigger if exists trg_aivalidation_validate_binding on public.decision_ai_interactions;
drop function if exists public.fn_validate_aivalidation_binding();
drop index if exists public.idx_aivalidation_req_sleutel;
alter table public.decision_ai_interactions drop column if exists requirement_sleutel;
commit;
