-- ============================================================
--  ROLLBACK — 2026_08_13_d7b_aanpasbare_vereisten.sql
--  LET OP: d7c (readiness-unie) leest deze tabel. Draai eerst de d7c-
--  rollback (herstel de readiness-functie zonder unie), dán deze.
-- ============================================================

begin;

drop table if exists public.procedure_requirement_instance;

alter table public.procedure_checklist
  drop column if exists bron,
  drop column if exists actief,
  drop column if exists governance_event_id,
  drop column if exists aangemaakt_door,
  drop column if exists aangemaakt_op;

commit;
