-- ============================================================
--  ROLLBACK — 2026_08_13_d8_procedure_fasen.sql
--  Verwijdert de D8-fasentabellen. Onomkeerbaar voor eventuele
--  fonds-overrides; alleen draaien als de tranche wordt teruggedraaid.
-- ============================================================

begin;

drop table if exists public.procedure_fase_beschrijving_override;
drop table if exists public.procedure_template_fasen;

commit;
