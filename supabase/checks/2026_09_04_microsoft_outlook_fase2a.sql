-- Microsoft 365 fase 2A: run dit als database-eigenaar na de fase-2A-migratie.
-- ROL: database-eigenaar/postgres; toetst private Outlook-objecten en vault-ACL.
do $controle$
declare fouten text := ''; v_aantal integer;
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='microsoft_private' and c.relname in ('outlook_agenda_configuraties','outlook_sync_runs','outlook_event_koppelingen')
      and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('microsoft_vault',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
  ) then fouten := fouten || E'\n- Outlook-private tabel mist RLS of heeft directe browser/vault-tabelrechten'; end if;
  select count(*) into v_aantal from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='microsoft_private' and p.proname in ('outlook_configureer_agenda','outlook_lees_configuratie','outlook_start_run','outlook_verwerk_event','outlook_voltooi_run','outlook_misluk_run')
      and p.prosecdef and coalesce(array_to_string(p.proconfig, ',') ~ 'search_path=microsoft_private, public, pg_temp$', false)
      and has_function_privilege('microsoft_vault',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE');
  if v_aantal <> 6 then fouten := fouten || format(E'\n- verwacht 6 afgeschermde Outlook-vaultfuncties, gevonden %s',v_aantal); end if;
  if not exists (select 1 from pg_indexes where schemaname='microsoft_private' and indexname='outlook_sync_een_actief_per_agenda') then fouten := fouten || E'\n- unieke actieve synchronisatierun ontbreekt'; end if;
  if not exists (select 1 from pg_constraint where conname='outlook_event_koppelingen_tenant_id_mailbox_id_calendar_id_immutable_event_id_key') then fouten := fouten || E'\n- immutable event-identiteit is niet uniek geborgd'; end if;
  if exists (select 1 from public.vergaderingen where outlook_onbekende_deelnemers < 0) then fouten := fouten || E'\n- ongeldige onbekende-deelnemertelling'; end if;
  if fouten <> '' then raise exception 'Microsoft Outlook fase-2A databasecontract faalt:%',fouten; end if;
  raise notice 'Microsoft Outlook fase-2A databasecontract OK.';
end $controle$;
