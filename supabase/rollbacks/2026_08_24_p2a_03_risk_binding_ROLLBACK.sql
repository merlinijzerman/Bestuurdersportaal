-- ROLLBACK van P2/PR-A risk-binding (decision_risks). HAND-RUN.
begin;
drop trigger if exists trg_risk_audit_binding on public.decision_risks;
drop function if exists public.fn_audit_risk_binding();
drop trigger if exists trg_risk_validate_binding on public.decision_risks;
drop function if exists public.fn_validate_risk_binding();
drop index if exists public.idx_risk_req_sleutel;
alter table public.decision_risks drop column if exists requirement_sleutel;
commit;
