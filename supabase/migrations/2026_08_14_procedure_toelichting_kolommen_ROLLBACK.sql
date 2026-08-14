-- ROLLBACK van 2026_08_14_procedure_toelichting_kolommen.sql

begin;

alter table public.procedure_requirements drop column if exists toelichting;
alter table public.procedure_checklist   drop column if exists toelichting;

commit;
