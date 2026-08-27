-- ROLLBACK van 2026_08_27_p3b_01_zwaarte.sql (P3/PR-B, #168, besluit 0192).
begin;
alter table public.procedure_requirement_instance drop column if exists besluitmoment_stap;
alter table public.procedure_requirement_instance drop column if exists zwaarte;
alter table public.procedure_requirements drop column if exists besluitmoment_stap;
alter table public.procedure_requirements drop column if exists zwaarte;
commit;
