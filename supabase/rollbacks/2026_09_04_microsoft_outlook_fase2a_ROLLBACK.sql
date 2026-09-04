-- Rollback Microsoft 365 fase 2A. Alleen gebruiken als er geen actieve run is.
begin;
do $$ begin
  if exists (select 1 from microsoft_private.outlook_sync_runs where status='bezig') then
    raise exception 'Outlook rollback geweigerd: er loopt nog een synchronisatie';
  end if;
end $$;
revoke execute on function microsoft_private.outlook_misluk_run(uuid,text) from microsoft_vault;
revoke execute on function microsoft_private.outlook_voltooi_run(uuid,text,integer,integer,integer,integer) from microsoft_vault;
revoke execute on function microsoft_private.outlook_verwerk_event(uuid,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,boolean,uuid[],integer) from microsoft_vault;
revoke execute on function microsoft_private.outlook_start_run(uuid,uuid,uuid) from microsoft_vault;
revoke execute on function microsoft_private.outlook_lees_configuratie(uuid,uuid) from microsoft_vault;
revoke execute on function microsoft_private.outlook_configureer_agenda(uuid,uuid,text,text,text,text,date,date) from microsoft_vault;
drop function if exists microsoft_private.outlook_misluk_run(uuid,text);
drop function if exists microsoft_private.outlook_voltooi_run(uuid,text,integer,integer,integer,integer);
drop function if exists microsoft_private.outlook_verwerk_event(uuid,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,boolean,uuid[],integer);
drop function if exists microsoft_private.outlook_start_run(uuid,uuid,uuid);
drop function if exists microsoft_private.outlook_lees_configuratie(uuid,uuid);
drop function if exists microsoft_private.outlook_configureer_agenda(uuid,uuid,text,text,text,text,date,date);
drop table if exists microsoft_private.outlook_event_koppelingen;
drop table if exists microsoft_private.outlook_sync_runs;
drop table if exists microsoft_private.outlook_agenda_configuraties;
alter table public.vergaderingen drop constraint if exists vergaderingen_outlook_sync_status_check;
alter table public.vergaderingen drop constraint if exists vergaderingen_outlook_onbekende_deelnemers_check;
alter table public.vergadering_log drop constraint if exists vergadering_log_event_type_check;
alter table public.vergadering_log add constraint vergadering_log_event_type_check check (event_type in ('vergadering_gewijzigd','vergadering_gearchiveerd','vergadering_gedearchiveerd'));
alter table public.vergaderingen drop column if exists outlook_laatst_gesynchroniseerd_op,drop column if exists outlook_onbekende_deelnemers,drop column if exists outlook_deelnemer_ids,drop column if exists outlook_teams_link,drop column if exists outlook_eind,drop column if exists outlook_tijdzone,drop column if exists outlook_sync_status,drop column if exists outlook_beheerd;
commit;
