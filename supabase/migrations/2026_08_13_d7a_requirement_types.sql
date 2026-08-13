-- ============================================================
--  Migratie 2026-08-13 — Proceduremodule-engine v2, D7 (a)
--  Requirement-type-enum uitbreiden met de twee types uit het
--  proceduremodule-ontwerp v0.2 die de zwaarste invaarstappen (1, 8, 9)
--  auditbaar maken:
--   • external_submission — DNB/AFM-indiening (invaarmelding, prognose-/
--     definitief transitieoverzicht). Readiness-semantiek: als 'document'
--     (matchend procedure_bewijs op de stap). De bevestigings-/termijneis
--     is definitie-metadata en nog niet in het DB-model (openstaand OB-1/O2).
--   • consultation — hoorrecht / VO-BO-advies / afstemming vereniging.
--     Readiness-semantiek: als 'document' (matchend bewijsstuk op de stap).
--
--  Zonder deze uitbreiding faalt de CHECK bij het seeden van de
--  invaarrequirements én kan een handmatig toegevoegde `consultation`
--  (D7, Bijlage A) niet bestaan — precies wat D7 vereist.
--
--  Idempotent: drop/add constraint if exists. Toepassen VÓÓR de
--  requirements-seed en vóór d7c (readiness-unie).
-- ============================================================

begin;

alter table public.procedure_requirements
  drop constraint if exists procedure_requirements_requirement_type_check;
alter table public.procedure_requirements
  add constraint procedure_requirements_requirement_type_check
  check (requirement_type in (
    'document','field','assumption','risk',
    'ai_validation','approval','mandate_check',
    'kpi','evaluation','dissent_review',
    'external_submission','consultation'
  ));

commit;
