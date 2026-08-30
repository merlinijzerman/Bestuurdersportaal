-- ROLLBACK van P2/PR-A approval-binding (procedure_besluiten). HAND-RUN.
begin;
drop trigger if exists trg_approval_audit_binding on public.procedure_besluiten;
drop function if exists public.fn_audit_approval_binding();
drop trigger if exists trg_approval_validate_binding on public.procedure_besluiten;
drop function if exists public.fn_validate_approval_binding();
drop index if exists public.idx_approval_req_sleutel;
alter table public.procedure_besluiten drop column if exists requirement_sleutel;
commit;
