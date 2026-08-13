-- ============================================================
--  ROLLBACK — 2026_08_13_d7a_requirement_types.sql
--  Herstelt de 10-waarden-enum. Faalt zolang er rijen met
--  'external_submission'/'consultation' bestaan (verwijder die eerst).
-- ============================================================

begin;

alter table public.procedure_requirements
  drop constraint if exists procedure_requirements_requirement_type_check;
alter table public.procedure_requirements
  add constraint procedure_requirements_requirement_type_check
  check (requirement_type in (
    'document','field','assumption','risk',
    'ai_validation','approval','mandate_check',
    'kpi','evaluation','dissent_review'
  ));

commit;
