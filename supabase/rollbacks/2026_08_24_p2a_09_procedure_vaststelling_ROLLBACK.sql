-- ROLLBACK van P2/PR-A procedure_vaststelling. HAND-RUN.
begin;
drop trigger if exists trg_vaststelling_audit_binding on public.procedure_vaststelling;
drop function if exists public.fn_audit_vaststelling_binding();
drop trigger if exists trg_vaststelling_validate_binding on public.procedure_vaststelling;
drop function if exists public.fn_validate_vaststelling_binding();
drop table if exists public.procedure_vaststelling;
commit;
