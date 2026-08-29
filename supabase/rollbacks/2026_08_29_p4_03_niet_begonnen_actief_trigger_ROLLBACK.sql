-- ROLLBACK van 2026_08_29_p4_03_niet_begonnen_actief_trigger.sql (P4 tranche 3).
-- Verwijdert de actief-trigger + functie + de twee kolommen. De status-
-- herclassificatie (actief → niet_begonnen) wordt NIET teruggedraaid — welke
-- stappen vóór de migratie 'actief' waren is niet reconstrueerbaar; draai eerst
-- p4_01 NIET terug zolang er 'niet_begonnen'-rijen zijn (CHECK zou falen).
begin;
drop trigger if exists trg_stap_actief_checklist on public.procedure_checklist;
drop trigger if exists trg_stap_actief_bewijs on public.procedure_bewijs;
drop trigger if exists trg_stap_actief_besluit on public.procedure_besluiten;
drop function if exists public.fn_stap_actief_bij_handeling();
drop function if exists public.fn_stap_activeerbaar_maken(uuid, uuid);
alter table public.procedure_stappen
  drop column if exists actief_sinds,
  drop column if exists gestart_door;
commit;
