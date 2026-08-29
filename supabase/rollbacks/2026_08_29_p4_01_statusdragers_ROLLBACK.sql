-- ROLLBACK van 2026_08_29_p4_01_statusdragers.sql (P4 tranche 1).
-- Herstelt de CHECK-constraints naar hun vorige waardenbereik en de
-- dossierafleiding zonder 'beeindigd'. LET OP: draai NIET terug als er al rijen
-- met status 'beeindigd'/'niet_begonnen'/'vervallen' bestaan — de CHECK faalt dan.
begin;
alter table public.decision_objects drop constraint if exists decision_objects_status_check;
alter table public.decision_objects add constraint decision_objects_status_check
  check (status in (
    'concept','in_onderbouwing','in_validatie','in_review','geagendeerd','in_bespreking',
    'besloten','voorwaardelijk_besloten','afgewezen','aangehouden','geescaleerd','teruggezet',
    'in_uitvoering','in_evaluatie','afgesloten','heropend','geannuleerd'
  ));
alter table public.procedure_stappen drop constraint if exists procedure_stappen_status_check;
alter table public.procedure_stappen add constraint procedure_stappen_status_check
  check (status in ('open','geblokkeerd','actief','afgerond','heropend'));
-- fn_dossierstatus_van_decision: laat de beeindigd-tak staan (harmloos zonder rijen);
-- terugdraaien is niet nodig en zou de TS-spiegel uit sync brengen.
commit;
