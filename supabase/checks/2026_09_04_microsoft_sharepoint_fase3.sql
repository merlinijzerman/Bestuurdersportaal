-- Microsoft 365 fase 3 (#321) deel A: run dit als database-eigenaar na de migratie.
-- ROL: database-eigenaar/postgres; toetst private SharePoint-objecten en vault-ACL.
do $controle$
declare fouten text := ''; v_aantal integer;
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='microsoft_private' and c.relname in ('sharepoint_kandidaatsites','sharepoint_bronnen')
      and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('microsoft_vault',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
  ) then fouten := fouten || E'\n- SharePoint-private tabel mist RLS of heeft directe browser/vault-tabelrechten'; end if;
  select count(*) into v_aantal from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='microsoft_private' and p.proname in ('sharepoint_lees_kandidaten','sharepoint_lees_bron','sharepoint_configureer_bron','sharepoint_registreer_controle','sharepoint_ontkoppel_bron')
      and p.prosecdef and coalesce(array_to_string(p.proconfig, ',') ~ 'search_path=microsoft_private, public, pg_temp$', false)
      and has_function_privilege('microsoft_vault',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE');
  if v_aantal <> 5 then fouten := fouten || format(E'\n- verwacht 5 afgeschermde SharePoint-vaultfuncties, gevonden %s',v_aantal); end if;
  -- Het portaal mag zichzelf geen kandidaatsites toewijzen: er bestaat geen schrijffunctie voor kandidaten.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='microsoft_private' and p.proname like 'sharepoint_%kandida%' and p.proname not in ('sharepoint_lees_kandidaten'))
  then fouten := fouten || E'\n- onverwachte kandidaat-schrijffunctie in microsoft_private'; end if;
  if fouten <> '' then raise exception 'Microsoft SharePoint fase-3A databasecontract faalt:%',fouten; end if;
  raise notice 'Microsoft SharePoint fase-3A databasecontract OK.';
end $controle$;

-- Gedragstoets: fondsbinding van kandidaat en verbinding, versie-ophoging bij
-- herkeuze, cross-fonds onzichtbaarheid en niet-destructief ontkoppelen.
begin;
insert into public.fondsen(id,naam,slug) values
  ('73200000-0000-4000-8000-000000000001','SharePoint 3A checkfonds A','sp-3a-fonds-a'),
  ('73200000-0000-4000-8000-000000000002','SharePoint 3A checkfonds B','sp-3a-fonds-b');
insert into auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at) values
  ('73200000-0000-4000-8000-0000000000a1','authenticated','authenticated','sp-check-a@test.local','{"naam":"SP Check A"}',now(),now()),
  ('73200000-0000-4000-8000-0000000000b1','authenticated','authenticated','sp-check-b@test.local','{"naam":"SP Check B"}',now(),now());
insert into public.profielen(id,fonds_id,naam,rol) values
  ('73200000-0000-4000-8000-0000000000a1','73200000-0000-4000-8000-000000000001','SP Check A','beheerder'),
  ('73200000-0000-4000-8000-0000000000b1','73200000-0000-4000-8000-000000000002','SP Check B','beheerder');
insert into microsoft_private.verbindingen(id,fonds_id,gebruiker_id,tenant_id,microsoft_object_id,home_account_id,status,scopes) values
  ('73200000-0000-4000-8000-000000000010','73200000-0000-4000-8000-000000000001','73200000-0000-4000-8000-0000000000a1','tenant-check','user-a','home-a','gekoppeld',array['User.Read','Sites.Selected']),
  ('73200000-0000-4000-8000-000000000011','73200000-0000-4000-8000-000000000002','73200000-0000-4000-8000-0000000000b1','tenant-check','user-b','home-b','gekoppeld',array['User.Read']);
insert into microsoft_private.sharepoint_kandidaatsites(id,fonds_id,hostnaam,server_relatief_pad,weergavenaam) values
  ('73200000-0000-4000-8000-000000000020','73200000-0000-4000-8000-000000000001','check.sharepoint.com','/sites/bestuur-a','Bestuur A'),
  ('73200000-0000-4000-8000-000000000021','73200000-0000-4000-8000-000000000002','check.sharepoint.com','/sites/bestuur-b','Bestuur B');

do $gedrag$
declare v_id uuid; v_id2 uuid; v_versie integer; v_status text; v_geweigerd boolean;
begin
  if (select count(*) from microsoft_private.sharepoint_lees_kandidaten('73200000-0000-4000-8000-000000000001')) <> 1 then
    raise exception 'FAALT: kandidatenlijst lekt over fondsen heen';
  end if;

  -- Kandidaat van fonds B mag niet als bron voor fonds A dienen.
  v_geweigerd := false;
  begin
    perform microsoft_private.sharepoint_configureer_bron('73200000-0000-4000-8000-000000000001','73200000-0000-4000-8000-0000000000a1','73200000-0000-4000-8000-000000000021','tenant-check','check.sharepoint.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222','Site','check.sharepoint.com','drive-1','Documenten','root-1','','Bron');
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: kandidaat van ander fonds geaccepteerd'; end if;

  -- Verbinding zonder Sites.Selected (fonds B) mag geen bron configureren.
  v_geweigerd := false;
  begin
    perform microsoft_private.sharepoint_configureer_bron('73200000-0000-4000-8000-000000000002','73200000-0000-4000-8000-0000000000b1','73200000-0000-4000-8000-000000000021','tenant-check','check.sharepoint.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222','Site','check.sharepoint.com','drive-1','Documenten','root-1','','Bron');
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: verbinding zonder Sites.Selected geaccepteerd'; end if;

  -- Hostnaam van de site-id moet bij de kandidaat horen.
  v_geweigerd := false;
  begin
    perform microsoft_private.sharepoint_configureer_bron('73200000-0000-4000-8000-000000000001','73200000-0000-4000-8000-0000000000a1','73200000-0000-4000-8000-000000000020','tenant-check','ander.sharepoint.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222','Site','ander.sharepoint.com','drive-1','Documenten','root-1','','Bron');
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: afwijkende hostnaam geaccepteerd'; end if;

  v_id := microsoft_private.sharepoint_configureer_bron('73200000-0000-4000-8000-000000000001','73200000-0000-4000-8000-0000000000a1','73200000-0000-4000-8000-000000000020','tenant-check','check.sharepoint.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222','Bestuur A','check.sharepoint.com','drive-1','Documenten','root-1','Vergaderstukken','Bestuur A · Documenten');
  v_id2 := microsoft_private.sharepoint_configureer_bron('73200000-0000-4000-8000-000000000001','73200000-0000-4000-8000-0000000000a1','73200000-0000-4000-8000-000000000020','tenant-check','check.sharepoint.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222','Bestuur A','check.sharepoint.com','drive-2','Archief','root-2','','Bestuur A · Archief');
  if v_id <> v_id2 then raise exception 'FAALT: herkeuze maakte een tweede bronrij'; end if;
  select configuratieversie into v_versie from microsoft_private.sharepoint_bronnen where id = v_id;
  if v_versie <> 2 then raise exception 'FAALT: configuratieversie is niet opgehoogd (%)', v_versie; end if;

  if exists (select 1 from microsoft_private.sharepoint_lees_bron('73200000-0000-4000-8000-000000000002')) then
    raise exception 'FAALT: bron van fonds A zichtbaar voor fonds B';
  end if;

  perform microsoft_private.sharepoint_registreer_controle('73200000-0000-4000-8000-000000000001','73200000-0000-4000-8000-0000000000a1',false,'toestemming_of_token');
  select status into v_status from microsoft_private.sharepoint_bronnen where id = v_id;
  if v_status <> 'toestemming_nodig' then raise exception 'FAALT: ingetrokken toestemming niet als toestemming_nodig gemarkeerd (%)', v_status; end if;
  perform microsoft_private.sharepoint_registreer_controle('73200000-0000-4000-8000-000000000001','73200000-0000-4000-8000-0000000000a1',true,null);
  select status into v_status from microsoft_private.sharepoint_bronnen where id = v_id;
  if v_status <> 'actief' then raise exception 'FAALT: geslaagde controle herstelt de bron niet'; end if;

  perform microsoft_private.sharepoint_ontkoppel_bron('73200000-0000-4000-8000-000000000001','73200000-0000-4000-8000-0000000000a1');
  select status into v_status from microsoft_private.sharepoint_bronnen where id = v_id;
  if v_status <> 'ontkoppeld' or not exists (select 1 from microsoft_private.sharepoint_bronnen where id = v_id) then
    raise exception 'FAALT: ontkoppelen is destructief of niet geregistreerd';
  end if;
  if (select count(*) from microsoft_private.audit_log where fonds_id='73200000-0000-4000-8000-000000000001' and gebeurtenis like 'microsoft.sharepoint.%') < 4 then
    raise exception 'FAALT: SharePoint-audit ontbreekt';
  end if;
  if exists (select 1 from microsoft_private.audit_log where gebeurtenis like 'microsoft.sharepoint.%' and (details::text ilike '%drive-%' or details::text ilike '%sharepoint.com%')) then
    raise exception 'FAALT: audit bevat externe SharePoint-identifiers';
  end if;
  raise notice 'Microsoft SharePoint fase-3A gedrag OK: fondsgebonden kandidaat en verbinding, versie-ophoging, cross-fonds dicht, ontkoppelen niet-destructief.';
end $gedrag$;
rollback;
