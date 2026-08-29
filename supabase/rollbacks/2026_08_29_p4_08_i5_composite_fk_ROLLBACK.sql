-- ROLLBACK van 2026_08_29_p4_08_i5_composite_fk.sql (P4 tranche 8).
begin;
alter table public.procedure_requirement_instance   drop constraint if exists pri_decision_zelfde_fonds;
alter table public.procedure_requirement_uitsluiting drop constraint if exists pru_decision_zelfde_fonds;
alter table public.procedure_vaststelling            drop constraint if exists pv_procedure_zelfde_fonds;
alter table public.procedures drop constraint if exists procedures_id_fonds_uniek;
commit;
