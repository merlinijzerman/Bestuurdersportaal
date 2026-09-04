-- Microsoft 365 fase 2A — Outlook read-only.
-- Alle Graph-identiteiten, cursors en eventkoppelingen blijven private. De
-- microsoft_vault-rol is de enige technische aanroeper van de functies hieronder.
-- ROLLBACK: ../rollbacks/2026_09_04_microsoft_outlook_fase2a_ROLLBACK.sql
begin;

alter table public.vergaderingen
  add column if not exists outlook_beheerd boolean not null default false,
  add column if not exists outlook_sync_status text,
  add column if not exists outlook_tijdzone text,
  add column if not exists outlook_eind timestamptz,
  add column if not exists outlook_teams_link text,
  add column if not exists outlook_deelnemer_ids uuid[] not null default '{}',
  add column if not exists outlook_onbekende_deelnemers integer not null default 0,
  add column if not exists outlook_laatst_gesynchroniseerd_op timestamptz;
alter table public.vergaderingen drop constraint if exists vergaderingen_outlook_sync_status_check;
alter table public.vergaderingen add constraint vergaderingen_outlook_sync_status_check
  check (outlook_sync_status is null or outlook_sync_status in ('gesynchroniseerd','geannuleerd','afgeschermd'));
alter table public.vergaderingen drop constraint if exists vergaderingen_outlook_onbekende_deelnemers_check;
alter table public.vergaderingen add constraint vergaderingen_outlook_onbekende_deelnemers_check
  check (outlook_onbekende_deelnemers between 0 and 10000);

-- Dit zijn technische bronvelden, geen browser-beheerconfiguratie. Er worden
-- geen Graph-body, e-mailadressen, namen of tokens opgeslagen.
create table if not exists microsoft_private.outlook_agenda_configuraties (
  id uuid primary key default gen_random_uuid(),
  fonds_id uuid not null unique references public.fondsen(id) on delete cascade,
  verbinding_id uuid not null unique references microsoft_private.verbindingen(id) on delete restrict,
  gebruiker_id uuid not null references auth.users(id) on delete restrict,
  tenant_id text not null,
  mailbox_id text not null,
  calendar_id text not null,
  calendar_naam text not null,
  venster_start date not null,
  venster_eind date not null,
  delta_link text,
  status text not null default 'gereed' check (status in ('gereed','bezig','fout','toestemming_nodig')),
  laatst_gelukt_op timestamptz,
  laatst_foutcategorie text,
  bijgewerkt_op timestamptz not null default now(),
  check (venster_eind > venster_start),
  unique (tenant_id, mailbox_id, calendar_id)
);
create table if not exists microsoft_private.outlook_sync_runs (
  id uuid primary key default gen_random_uuid(),
  configuratie_id uuid not null references microsoft_private.outlook_agenda_configuraties(id) on delete cascade,
  fonds_id uuid not null references public.fondsen(id) on delete cascade,
  gestart_door uuid not null references auth.users(id) on delete restrict,
  correlation_id uuid not null,
  status text not null check (status in ('bezig','geslaagd','mislukt')),
  gestart_op timestamptz not null default now(),
  afgerond_op timestamptz,
  gelezen integer not null default 0 check (gelezen >= 0),
  aangemaakt integer not null default 0 check (aangemaakt >= 0),
  bijgewerkt integer not null default 0 check (bijgewerkt >= 0),
  overgeslagen integer not null default 0 check (overgeslagen >= 0),
  foutcategorie text
);
create unique index if not exists outlook_sync_een_actief_per_agenda
  on microsoft_private.outlook_sync_runs(configuratie_id) where status = 'bezig';
create table if not exists microsoft_private.outlook_event_koppelingen (
  id uuid primary key default gen_random_uuid(),
  configuratie_id uuid not null references microsoft_private.outlook_agenda_configuraties(id) on delete cascade,
  fonds_id uuid not null references public.fondsen(id) on delete cascade,
  tenant_id text not null,
  mailbox_id text not null,
  calendar_id text not null,
  immutable_event_id text not null,
  vergadering_id uuid not null unique references public.vergaderingen(id) on delete restrict,
  ical_uid text,
  change_key text,
  serie_master_id text,
  laatste_gezien_op timestamptz,
  sensitivity text not null default 'normal' check (sensitivity in ('normal','personal','private','confidential')),
  unique (tenant_id, mailbox_id, calendar_id, immutable_event_id)
);
alter table microsoft_private.outlook_agenda_configuraties enable row level security;
alter table microsoft_private.outlook_sync_runs enable row level security;
alter table microsoft_private.outlook_event_koppelingen enable row level security;
alter table microsoft_private.audit_log add column if not exists correlation_id uuid;
alter table microsoft_private.audit_log add column if not exists details jsonb not null default '{}'::jsonb;

-- De configuratie bindt de geselecteerde agenda aan precies de fase-1-koppeling
-- die hem in Graph heeft opgeleverd. Een browser krijgt nooit schrijfrechten.
create or replace function microsoft_private.outlook_configureer_agenda(
  p_fonds uuid,p_gebruiker uuid,p_tenant text,p_mailbox text,p_calendar text,p_naam text,p_start date,p_eind date
) returns uuid language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_verbinding uuid; v_config uuid;
begin
  if exists (
    select 1 from outlook_agenda_configuraties c
    where c.fonds_id=p_fonds and (c.tenant_id,c.mailbox_id,c.calendar_id) is distinct from (p_tenant,p_mailbox,p_calendar)
      and exists (select 1 from outlook_event_koppelingen k where k.configuratie_id=c.id)
  ) then raise exception 'kies geen andere agenda zolang bestaande Outlook-koppelingen nog actief zijn'; end if;
  select id into v_verbinding from verbindingen
   where fonds_id=p_fonds and gebruiker_id=p_gebruiker and tenant_id=p_tenant
     and microsoft_object_id=p_mailbox and status='gekoppeld' for update;
  if v_verbinding is null or p_calendar='' or p_naam='' or p_eind <= p_start then
    raise exception 'outlook agenda-configuratie is ongeldig';
  end if;
  insert into outlook_agenda_configuraties(fonds_id,verbinding_id,gebruiker_id,tenant_id,mailbox_id,calendar_id,calendar_naam,venster_start,venster_eind,delta_link,status,laatst_foutcategorie,bijgewerkt_op)
  values(p_fonds,v_verbinding,p_gebruiker,p_tenant,p_mailbox,p_calendar,left(p_naam,160),p_start,p_eind,null,'gereed',null,now())
  on conflict (fonds_id) do update set verbinding_id=excluded.verbinding_id,gebruiker_id=excluded.gebruiker_id,tenant_id=excluded.tenant_id,mailbox_id=excluded.mailbox_id,calendar_id=excluded.calendar_id,calendar_naam=excluded.calendar_naam,venster_start=excluded.venster_start,venster_eind=excluded.venster_eind,delta_link=null,status='gereed',laatst_foutcategorie=null,bijgewerkt_op=now()
  returning id into v_config;
  insert into audit_log(fonds_id,gebruiker_id,gebeurtenis,details) values(p_fonds,p_gebruiker,'microsoft.outlook.agenda_gekozen',jsonb_build_object('configuratie_id',v_config));
  return v_config;
end $$;

create or replace function microsoft_private.outlook_lees_configuratie(p_fonds uuid,p_gebruiker uuid)
returns table(id uuid,gebruiker_id uuid,tenant_id text,mailbox_id text,calendar_id text,calendar_naam text,venster_start date,venster_eind date,delta_link text,status text,laatst_gelukt_op timestamptz,laatst_foutcategorie text)
language sql security definer set search_path = microsoft_private, public, pg_temp as $$
  select c.id,c.gebruiker_id,c.tenant_id,c.mailbox_id,c.calendar_id,c.calendar_naam,c.venster_start,c.venster_eind,c.delta_link,c.status,c.laatst_gelukt_op,c.laatst_foutcategorie
    from outlook_agenda_configuraties c
   -- This is fund-wide, non-sensitive status. Management routes remain guarded
   -- by fonds.config.manage; ordinary bestuurders may only observe the result.
   where c.fonds_id=p_fonds
$$;

create or replace function microsoft_private.outlook_start_run(p_fonds uuid,p_gebruiker uuid,p_correlation uuid)
returns table(run_id uuid,configuratie_id uuid,tenant_id text,mailbox_id text,calendar_id text,venster_start date,venster_eind date,delta_link text)
language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_cfg outlook_agenda_configuraties%rowtype; v_run uuid;
begin
  select * into v_cfg from outlook_agenda_configuraties where fonds_id=p_fonds and gebruiker_id=p_gebruiker and status in ('gereed','fout') for update;
  if v_cfg.id is null then raise exception 'geen bruikbare Outlook-agenda voor deze gekoppelde gebruiker'; end if;
  insert into outlook_sync_runs(configuratie_id,fonds_id,gestart_door,correlation_id,status) values(v_cfg.id,p_fonds,p_gebruiker,p_correlation,'bezig') returning id into v_run;
  update outlook_agenda_configuraties set status='bezig',laatst_foutcategorie=null where id=v_cfg.id;
  return query select v_run,v_cfg.id,v_cfg.tenant_id,v_cfg.mailbox_id,v_cfg.calendar_id,v_cfg.venster_start,v_cfg.venster_eind,v_cfg.delta_link;
end $$;

create or replace function microsoft_private.outlook_verwerk_event(
  p_run uuid,p_event text,p_ical text,p_change text,p_serie text,p_titel text,p_start timestamptz,p_eind timestamptz,p_tijdzone text,p_locatie text,p_teams_link text,p_sensitivity text,p_geannuleerd boolean,p_lokaal_deelnemers uuid[],p_onbekend integer
) returns text language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_run outlook_sync_runs%rowtype; v_cfg outlook_agenda_configuraties%rowtype; v_map outlook_event_koppelingen%rowtype; v_verg uuid; v_nieuw boolean := false; v_privacy boolean;
begin
  select * into v_run from outlook_sync_runs where id=p_run and status='bezig' for update;
  if v_run.id is null then raise exception 'outlook synchronisatierun is niet actief'; end if;
  select * into v_cfg from outlook_agenda_configuraties where id=v_run.configuratie_id for update;
  if p_event='' or p_sensitivity not in ('normal','personal','private','confidential') or p_onbekend < 0 then raise exception 'ongeldig Outlook-event'; end if;
  if exists (select 1 from unnest(coalesce(p_lokaal_deelnemers,'{}'::uuid[])) x where not exists (select 1 from public.profielen pr where pr.id=x and pr.fonds_id=v_cfg.fonds_id)) then raise exception 'deelnemers vallen niet binnen het fonds'; end if;
  select * into v_map from outlook_event_koppelingen where tenant_id=v_cfg.tenant_id and mailbox_id=v_cfg.mailbox_id and calendar_id=v_cfg.calendar_id and immutable_event_id=p_event for update;
  v_privacy := p_sensitivity in ('private','personal');
  if v_map.id is null and v_privacy then return 'overgeslagen_privacy'; end if;
  if v_map.id is null then
    insert into public.vergaderingen(fonds_id,titel,datum,locatie,status,aangemaakt_door,outlook_beheerd,outlook_sync_status,outlook_tijdzone,outlook_eind,outlook_teams_link,outlook_deelnemer_ids,outlook_onbekende_deelnemers,outlook_laatst_gesynchroniseerd_op)
    values(v_cfg.fonds_id,left(coalesce(nullif(p_titel,''),'Outlook-afspraak'),240),p_start, nullif(p_locatie,''),'in_voorbereiding',v_run.gestart_door,true,case when p_geannuleerd then 'geannuleerd' else 'gesynchroniseerd' end,nullif(p_tijdzone,''),p_eind,nullif(p_teams_link,''),coalesce(p_lokaal_deelnemers,'{}'::uuid[]),p_onbekend,now()) returning id into v_verg;
    insert into outlook_event_koppelingen(configuratie_id,fonds_id,tenant_id,mailbox_id,calendar_id,immutable_event_id,vergadering_id,ical_uid,change_key,serie_master_id,laatste_gezien_op,sensitivity)
    values(v_cfg.id,v_cfg.fonds_id,v_cfg.tenant_id,v_cfg.mailbox_id,v_cfg.calendar_id,p_event,v_verg,nullif(p_ical,''),nullif(p_change,''),nullif(p_serie,''),now(),p_sensitivity);
    v_nieuw := true;
  else
    v_verg := v_map.vergadering_id;
    update outlook_event_koppelingen set ical_uid=nullif(p_ical,''),change_key=nullif(p_change,''),serie_master_id=nullif(p_serie,''),laatste_gezien_op=now(),sensitivity=p_sensitivity where id=v_map.id;
    if v_privacy then
      update public.vergaderingen set titel=case when outlook_beheerd then 'Afgeschermde Outlook-afspraak' else titel end,locatie=null,outlook_sync_status='afgeschermd',outlook_eind=null,outlook_teams_link=null,outlook_deelnemer_ids='{}'::uuid[],outlook_onbekende_deelnemers=0,outlook_laatst_gesynchroniseerd_op=now() where id=v_verg;
      return 'afgeschermd';
    end if;
    update public.vergaderingen set titel=case when outlook_beheerd then left(coalesce(nullif(p_titel,''),'Outlook-afspraak'),240) else titel end,datum=case when outlook_beheerd then p_start else datum end,locatie=case when outlook_beheerd then nullif(p_locatie,'') else locatie end,outlook_sync_status=case when p_geannuleerd then 'geannuleerd' else 'gesynchroniseerd' end,outlook_tijdzone=nullif(p_tijdzone,''),outlook_eind=p_eind,outlook_teams_link=nullif(p_teams_link,''),outlook_deelnemer_ids=coalesce(p_lokaal_deelnemers,'{}'::uuid[]),outlook_onbekende_deelnemers=p_onbekend,outlook_laatst_gesynchroniseerd_op=now() where id=v_verg;
  end if;
  insert into public.vergadering_log(vergadering_id,event_type,actor_id,payload) values(v_verg,case when v_nieuw then 'outlook_geimporteerd' when p_geannuleerd then 'outlook_geannuleerd' else 'outlook_gesynchroniseerd' end,v_run.gestart_door,jsonb_build_object('bron','outlook','run_id',p_run));
  return case when v_nieuw then 'aangemaakt' when p_geannuleerd then 'bijgewerkt' else 'bijgewerkt' end;
end $$;

create or replace function microsoft_private.outlook_voltooi_run(p_run uuid,p_delta_link text,p_gelezen integer,p_aangemaakt integer,p_bijgewerkt integer,p_overgeslagen integer)
returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_run outlook_sync_runs%rowtype;
begin
  select * into v_run from outlook_sync_runs where id=p_run and status='bezig' for update;
  if v_run.id is null or p_delta_link='' or least(p_gelezen,p_aangemaakt,p_bijgewerkt,p_overgeslagen) < 0 then raise exception 'outlook run kan niet worden voltooid'; end if;
  update outlook_sync_runs set status='geslaagd',afgerond_op=now(),gelezen=p_gelezen,aangemaakt=p_aangemaakt,bijgewerkt=p_bijgewerkt,overgeslagen=p_overgeslagen where id=p_run;
  update outlook_agenda_configuraties set delta_link=p_delta_link,status='gereed',laatst_gelukt_op=now(),laatst_foutcategorie=null where id=v_run.configuratie_id;
  insert into audit_log(fonds_id,gebruiker_id,gebeurtenis,correlation_id,details) values(v_run.fonds_id,v_run.gestart_door,'microsoft.outlook.sync.geslaagd',v_run.correlation_id,jsonb_build_object('gelezen',p_gelezen,'aangemaakt',p_aangemaakt,'bijgewerkt',p_bijgewerkt,'overgeslagen',p_overgeslagen));
end $$;

create or replace function microsoft_private.outlook_misluk_run(p_run uuid,p_fout text)
returns void language plpgsql security definer set search_path = microsoft_private, public, pg_temp as $$
declare v_run outlook_sync_runs%rowtype;
begin
  select * into v_run from outlook_sync_runs where id=p_run and status='bezig' for update;
  if v_run.id is null then return; end if;
  update outlook_sync_runs set status='mislukt',afgerond_op=now(),foutcategorie=left(coalesce(nullif(p_fout,''),'onverwachte_fout'),80) where id=p_run;
  update outlook_agenda_configuraties set status='fout',laatst_foutcategorie=left(coalesce(nullif(p_fout,''),'onverwachte_fout'),80) where id=v_run.configuratie_id;
  insert into audit_log(fonds_id,gebruiker_id,gebeurtenis,correlation_id,foutcategorie) values(v_run.fonds_id,v_run.gestart_door,'microsoft.outlook.sync.mislukt',v_run.correlation_id,left(coalesce(nullif(p_fout,''),'onverwachte_fout'),80));
end $$;

alter table public.vergadering_log drop constraint if exists vergadering_log_event_type_check;
alter table public.vergadering_log add constraint vergadering_log_event_type_check check (event_type in ('vergadering_gewijzigd','vergadering_gearchiveerd','vergadering_gedearchiveerd','outlook_geimporteerd','outlook_gesynchroniseerd','outlook_geannuleerd'));
revoke all on all tables in schema microsoft_private from public, anon, authenticated;
revoke all on all functions in schema microsoft_private from public, anon, authenticated;
grant execute on function microsoft_private.outlook_configureer_agenda(uuid,uuid,text,text,text,text,date,date) to microsoft_vault;
grant execute on function microsoft_private.outlook_lees_configuratie(uuid,uuid) to microsoft_vault;
grant execute on function microsoft_private.outlook_start_run(uuid,uuid,uuid) to microsoft_vault;
grant execute on function microsoft_private.outlook_verwerk_event(uuid,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,boolean,uuid[],integer) to microsoft_vault;
grant execute on function microsoft_private.outlook_voltooi_run(uuid,text,integer,integer,integer,integer) to microsoft_vault;
grant execute on function microsoft_private.outlook_misluk_run(uuid,text) to microsoft_vault;
commit;
