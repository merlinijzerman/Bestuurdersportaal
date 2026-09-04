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
    where n.nspname='microsoft_private' and p.proname in ('outlook_configureer_agenda','outlook_lees_configuratie','outlook_start_run','outlook_verwerk_event','outlook_markeer_extern_gewijzigd','outlook_voltooi_run','outlook_misluk_run')
      and p.prosecdef and coalesce(array_to_string(p.proconfig, ',') ~ 'search_path=microsoft_private, public, pg_temp$', false)
      and has_function_privilege('microsoft_vault',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE');
  if v_aantal <> 7 then fouten := fouten || format(E'\n- verwacht 7 afgeschermde Outlook-vaultfuncties, gevonden %s',v_aantal); end if;
  if not exists (select 1 from pg_indexes where schemaname='microsoft_private' and indexname='outlook_sync_een_actief_per_agenda') then fouten := fouten || E'\n- unieke actieve synchronisatierun ontbreekt'; end if;
  -- PostgreSQL kapt automatisch gegenereerde constraintnamen af op 63 bytes;
  -- toets daarom het echte kolomcontract en niet een fragiele naamstring.
  if not exists (
    select 1 from pg_constraint
     where conrelid='microsoft_private.outlook_event_koppelingen'::regclass
       and contype='u'
       and conkey=array[
         (select attnum from pg_attribute where attrelid='microsoft_private.outlook_event_koppelingen'::regclass and attname='tenant_id'),
         (select attnum from pg_attribute where attrelid='microsoft_private.outlook_event_koppelingen'::regclass and attname='mailbox_id'),
         (select attnum from pg_attribute where attrelid='microsoft_private.outlook_event_koppelingen'::regclass and attname='calendar_id'),
         (select attnum from pg_attribute where attrelid='microsoft_private.outlook_event_koppelingen'::regclass and attname='immutable_event_id')
       ]::smallint[]
  ) then fouten := fouten || E'\n- immutable event-identiteit is niet uniek geborgd'; end if;
  if exists (select 1 from public.vergaderingen where outlook_onbekende_deelnemers < 0) then fouten := fouten || E'\n- ongeldige onbekende-deelnemertelling'; end if;
  if fouten <> '' then raise exception 'Microsoft Outlook fase-2A databasecontract faalt:%',fouten; end if;
  raise notice 'Microsoft Outlook fase-2A databasecontract OK.';
end $controle$;

-- Gedragstoets: dezelfde immutable event-ID wordt bijgewerkt in plaats van
-- gedupliceerd en @removed houdt de portaalvergadering intact.
begin;
insert into public.fondsen(id,naam,slug)
values('73100000-0000-4000-8000-000000000001','Outlook 2A checkfonds','outlook-2a-checkfonds');
insert into auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at)
values('73100000-0000-4000-8000-0000000000a1','authenticated','authenticated','outlook-check@test.local','{"naam":"Outlook Check"}',now(),now());
insert into public.profielen(id,fonds_id,naam,rol)
values('73100000-0000-4000-8000-0000000000a1','73100000-0000-4000-8000-000000000001','Outlook Check','beheerder');
insert into microsoft_private.verbindingen(id,fonds_id,gebruiker_id,tenant_id,microsoft_object_id,home_account_id,status,scopes)
values('73100000-0000-4000-8000-000000000010','73100000-0000-4000-8000-000000000001','73100000-0000-4000-8000-0000000000a1','tenant-check','mailbox-check','home-check','gekoppeld',array['Calendars.Read.Shared']);

do $gedrag$
declare v_run uuid; v_run_nieuw uuid; v_verg uuid; v_aantal integer; v_status text;
begin
  perform microsoft_private.outlook_configureer_agenda(
    '73100000-0000-4000-8000-000000000001','73100000-0000-4000-8000-0000000000a1',
    'tenant-check','mailbox-check','calendar-check','Checkagenda',current_date-30,current_date+365
  );
  select run_id into v_run from microsoft_private.outlook_start_run(
    '73100000-0000-4000-8000-000000000001','73100000-0000-4000-8000-0000000000a1',
    '73100000-0000-4000-8000-000000000099'
  );
  perform microsoft_private.outlook_verwerk_event(v_run,'CaseSensitiveEvent','ical-1','change-1','',
    'Eerste titel',now()+interval '1 day',now()+interval '1 day 1 hour','Etc/UTC','Kamer 1','',
    'normal',false,array['73100000-0000-4000-8000-0000000000a1'::uuid],0);
  perform microsoft_private.outlook_verwerk_event(v_run,'CaseSensitiveEvent','ical-1','change-2','',
    'Gewijzigde titel',now()+interval '2 days',now()+interval '2 days 1 hour','Etc/UTC','Kamer 2','',
    'normal',false,array['73100000-0000-4000-8000-0000000000a1'::uuid],0);

  select count(*) into v_aantal
    from microsoft_private.outlook_event_koppelingen where immutable_event_id='CaseSensitiveEvent';
  if v_aantal <> 1 then raise exception 'FAALT: herhaalde immutable event-ID leverde % koppelingen op',v_aantal; end if;
  select vergadering_id into v_verg
    from microsoft_private.outlook_event_koppelingen where immutable_event_id='CaseSensitiveEvent';
  if (select titel from public.vergaderingen where id=v_verg) <> 'Gewijzigde titel' then
    raise exception 'FAALT: herhaalde event-ID werkte de bestaande vergadering niet bij';
  end if;

  if not microsoft_private.outlook_markeer_extern_gewijzigd(v_run,'CaseSensitiveEvent') then
    raise exception 'FAALT: gekoppeld @removed-event werd niet gemarkeerd';
  end if;
  select outlook_sync_status into v_status from public.vergaderingen where id=v_verg;
  if v_status <> 'extern_gewijzigd_of_verwijderd' then
    raise exception 'FAALT: veilige @removed-status ontbreekt (%)',v_status;
  end if;
  if not exists(select 1 from public.vergaderingen where id=v_verg) then
    raise exception 'FAALT: @removed heeft portaalinhoud verwijderd';
  end if;
  update microsoft_private.outlook_sync_runs set gestart_op=now()-interval '16 minutes' where id=v_run;
  select run_id into v_run_nieuw from microsoft_private.outlook_start_run(
    '73100000-0000-4000-8000-000000000001','73100000-0000-4000-8000-0000000000a1',
    '73100000-0000-4000-8000-000000000098'
  );
  if v_run_nieuw is null
     or (select status from microsoft_private.outlook_sync_runs where id=v_run) <> 'mislukt'
     or not exists(select 1 from microsoft_private.audit_log where correlation_id='73100000-0000-4000-8000-000000000099' and foutcategorie='run_afgebroken') then
    raise exception 'FAALT: afgebroken run is niet veilig en auditbaar hersteld';
  end if;
  raise notice 'Microsoft Outlook fase-2A gedrag OK: idempotent, @removed niet-destructief en afgebroken run herstelbaar.';
end $gedrag$;
rollback;
