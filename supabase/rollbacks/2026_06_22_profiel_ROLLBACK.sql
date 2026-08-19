-- ============================================================================
-- ROLLBACK voor 2026_06_22_profiel.sql
--
-- ALLEEN gebruiken om Increment F (persoonlijk bestuurdersprofiel) volledig
-- terug te draaien. Verwijdert de profiel-join-tabellen, profiel_log, de nieuwe
-- profielvelden en de toegevoegde constraints. De autorisatiekolom 'rol' en alle
-- bestaande gegevens blijven intact. Front-end revert naar profielloze opbouw.
--
-- B9 is niet in scope van deze migratie; de bestaande eigenaars-FK-kolommen
-- (risicos.eigenaar_id, decision_dissent.bestuurder_id, procedure_eigenaars.
-- gebruiker_id) worden hier NIET aangeraakt.
--
-- Volgorde respecteert FK-afhankelijkheden: join-tabellen → log → constraints
-- op profielen → kolommen.
-- ============================================================================

-- 1. Join-tabellen (verwijzen naar profielen + catalogus)
drop table if exists public.profiel_expertises    cascade;
drop table if exists public.profiel_gremia         cascade;
drop table if exists public.profiel_focusgebieden  cascade;

-- 2. Profiel-audit
drop table if exists public.profiel_log cascade;

-- 3. Constraints op profielen
alter table public.profielen drop constraint if exists fk_profielen_primaire_expertise;
alter table public.profielen drop constraint if exists uq_profielen_fonds_id;

-- 4. Nieuwe profielvelden
alter table public.profielen
  drop column if exists bestuurlijke_rol,
  drop column if exists primaire_expertise_id,
  drop column if exists antwoordvoorkeur,
  drop column if exists standaard_ai_modus,
  drop column if exists detailniveau;
