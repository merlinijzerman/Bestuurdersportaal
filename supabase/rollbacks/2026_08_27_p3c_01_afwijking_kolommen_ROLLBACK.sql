-- ROLLBACK van 2026_08_27_p3c_01_afwijking_kolommen.sql (P3/PR-C, #168, 0192).
-- Verwijdert de vier afwijkingskolommen van procedure_stappen. Puur additief
-- teruggedraaid; geen data-afhankelijkheden (de kolommen dragen alleen de laatste
-- afronding, procedure_log houdt de historie los daarvan).
begin;

alter table public.procedure_stappen drop column if exists afwijking_door;
alter table public.procedure_stappen drop column if exists afwijking_snapshot;
alter table public.procedure_stappen drop column if exists afwijking_motivering;
alter table public.procedure_stappen drop column if exists afgerond_met_afwijking;

commit;
