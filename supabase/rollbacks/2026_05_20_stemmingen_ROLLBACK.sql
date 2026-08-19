-- ============================================================
--  ROLLBACK voor 2026_05_20_stemmingen.sql
--
--  ALLEEN gebruiken als je de stemming-functionaliteit volledig
--  moet terugdraaien. Dit verwijdert alle stemmingen en stemmen.
--  De notificatie-type-check wordt teruggezet naar de tranche-1-versie.
-- ============================================================

-- 1. FK-kolommen verwijderen
alter table public.procedure_bewijs drop column if exists stemming_id;
alter table public.decision_dissent drop column if exists stemming_id;

-- 2. Tabellen droppen (stem_uitbrengingen eerst i.v.m. FK)
drop table if exists public.stem_uitbrengingen cascade;
drop table if exists public.stemmingen cascade;

-- 3. Notificatie-type-check terug naar tranche-1-versie
alter table public.notificaties
  drop constraint if exists notificaties_type_check;

alter table public.notificaties
  add constraint notificaties_type_check check (type in (
    'inbreng_geplaatst',
    'ai_validatie_wacht',
    'procedure_afgerond',
    'besluit_geregistreerd',
    'dissent_formeel_vastgelegd',
    'agendapunt_gewijzigd',
    'agendapunt_verplaatst',
    'agendapunt_verwijderd'
  ));

-- Let op: bestaande notificatie-rijen met een stemming-type
-- (stemronde_geopend etc.) moeten eerst verwijderd worden, anders
-- faalt de check-constraint. Indien nodig:
--   delete from public.notificaties
--    where type in ('stemronde_geopend','volmachtstem_uitgebracht',
--                   'stemronde_gesloten','stemronde_ingetrokken');
