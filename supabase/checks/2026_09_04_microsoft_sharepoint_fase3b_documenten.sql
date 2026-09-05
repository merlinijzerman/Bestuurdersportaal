-- Microsoft 365 fase 3 (#321) deel B: run dit als database-eigenaar na de migratie.
-- ROL: database-eigenaar/postgres; toetst het private documentregister en de audit-poort.
do $controle$
declare fouten text := ''; v_aantal integer;
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='microsoft_private' and c.relname='sharepoint_documenten'
      and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('microsoft_vault',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
  ) then fouten := fouten || E'\n- sharepoint_documenten mist RLS of heeft directe browser/vault-tabelrechten'; end if;
  select count(*) into v_aantal from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='microsoft_private' and p.proname in ('sharepoint_upsert_documenten','sharepoint_lees_document','sharepoint_markeer_document','sharepoint_registreer_gebeurtenis')
      and p.prosecdef and coalesce(array_to_string(p.proconfig, ',') ~ 'search_path=microsoft_private, public, pg_temp$', false)
      and has_function_privilege('microsoft_vault',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE');
  if v_aantal <> 4 then fouten := fouten || format(E'\n- verwacht 4 afgeschermde documentfuncties, gevonden %s',v_aantal); end if;
  -- Geen kolom voor bestandsinhoud, tekst, chunks, embeddings of preview-URL's.
  if exists (select 1 from information_schema.columns where table_schema='microsoft_private' and table_name='sharepoint_documenten' and (column_name ~* 'inhoud|content|tekst|chunk|embedding|preview' or data_type in ('bytea','vector'))) then
    fouten := fouten || E'\n- documentregister bevat een inhoud-/preview-kolom'; end if;
  if fouten <> '' then raise exception 'Microsoft SharePoint fase-3B databasecontract faalt:%',fouten; end if;
  raise notice 'Microsoft SharePoint fase-3B databasecontract OK.';
end $controle$;

begin;
insert into public.fondsen(id,naam,slug) values
  ('73300000-0000-4000-8000-000000000001','SharePoint 3B checkfonds A','sp-3b-fonds-a'),
  ('73300000-0000-4000-8000-000000000002','SharePoint 3B checkfonds B','sp-3b-fonds-b');
insert into auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at) values
  ('73300000-0000-4000-8000-0000000000a1','authenticated','authenticated','sp3b-a@test.local','{"naam":"SP3B A"}',now(),now());
insert into public.profielen(id,fonds_id,naam,rol) values
  ('73300000-0000-4000-8000-0000000000a1','73300000-0000-4000-8000-000000000001','SP3B A','beheerder');
insert into microsoft_private.verbindingen(id,fonds_id,gebruiker_id,tenant_id,microsoft_object_id,home_account_id,status,scopes) values
  ('73300000-0000-4000-8000-000000000010','73300000-0000-4000-8000-000000000001','73300000-0000-4000-8000-0000000000a1','tenant-check','user-a','home-a','gekoppeld',array['User.Read','Sites.Selected']);
insert into microsoft_private.sharepoint_kandidaatsites(id,fonds_id,hostnaam,server_relatief_pad,weergavenaam) values
  ('73300000-0000-4000-8000-000000000020','73300000-0000-4000-8000-000000000001','check.sharepoint.com','/sites/bestuur-a','Bestuur A');

do $gedrag$
declare v_bron uuid; v_ref uuid; v_ref2 uuid; v_aantal integer; v_geweigerd boolean;
begin
  v_bron := microsoft_private.sharepoint_configureer_bron('73300000-0000-4000-8000-000000000001','73300000-0000-4000-8000-0000000000a1','73300000-0000-4000-8000-000000000020','tenant-check','check.sharepoint.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222','Bestuur A','check.sharepoint.com','drive-1','Documenten','root-1','','Bestuur A · Documenten');

  select ref into v_ref from microsoft_private.sharepoint_upsert_documenten('73300000-0000-4000-8000-000000000001', v_bron, 1,
    '[{"item_id":"item-1","naam":"Nota.pdf","bestandstype":"pdf","mime_type":"application/pdf","grootte":1234,"gewijzigd_op":"2026-09-01T10:00:00Z","etag":"e1","ctag":"c1","ouder_item_id":"root-1","mappad":"","web_url":"https://check.sharepoint.com/sites/bestuur-a/Documenten/Nota.pdf"}]'::jsonb);
  select ref into v_ref2 from microsoft_private.sharepoint_upsert_documenten('73300000-0000-4000-8000-000000000001', v_bron, 1,
    '[{"item_id":"item-1","naam":"Nota v2.pdf","bestandstype":"pdf","mime_type":"application/pdf","grootte":2345,"gewijzigd_op":"2026-09-02T10:00:00Z","etag":"e2","ctag":"c2","ouder_item_id":"map-1","mappad":"2026","web_url":null}]'::jsonb);
  if v_ref <> v_ref2 then raise exception 'FAALT: rename/move maakte een tweede referentie voor hetzelfde item'; end if;
  select count(*) into v_aantal from microsoft_private.sharepoint_documenten where bron_id = v_bron;
  if v_aantal <> 1 then raise exception 'FAALT: dubbele registerrij (%)', v_aantal; end if;
  if (select naam from microsoft_private.sharepoint_lees_document('73300000-0000-4000-8000-000000000001', v_ref)) <> 'Nota v2.pdf' then
    raise exception 'FAALT: referentie volgt de rename niet';
  end if;

  if exists (select 1 from microsoft_private.sharepoint_lees_document('73300000-0000-4000-8000-000000000002', v_ref)) then
    raise exception 'FAALT: referentie van fonds A zichtbaar voor fonds B';
  end if;

  -- Bron van een ander fonds mag geen documenten schrijven.
  v_geweigerd := false;
  begin
    perform microsoft_private.sharepoint_upsert_documenten('73300000-0000-4000-8000-000000000002', v_bron, 1, '[{"item_id":"x","naam":"x.pdf"}]'::jsonb);
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: upsert via bron van ander fonds geaccepteerd'; end if;

  -- Een ongeldige web_url (niet-SharePoint) wordt geweigerd door de tabelconstraint.
  v_geweigerd := false;
  begin
    perform microsoft_private.sharepoint_upsert_documenten('73300000-0000-4000-8000-000000000001', v_bron, 1, '[{"item_id":"item-2","naam":"y.pdf","web_url":"https://evil.test/x"}]'::jsonb);
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: niet-SharePoint web_url geaccepteerd'; end if;

  perform microsoft_private.sharepoint_markeer_document('73300000-0000-4000-8000-000000000001', v_ref, 'verwijderd');
  if (select status from microsoft_private.sharepoint_documenten where id = v_ref) <> 'verwijderd' then raise exception 'FAALT: markering niet toegepast'; end if;
  perform microsoft_private.sharepoint_markeer_document('73300000-0000-4000-8000-000000000002', v_ref, 'gezien');
  if (select status from microsoft_private.sharepoint_documenten where id = v_ref) <> 'verwijderd' then raise exception 'FAALT: ander fonds kon de markering wijzigen'; end if;

  -- Audit-poort: preview-URL's, tokens en externe id's worden geweigerd.
  perform microsoft_private.sharepoint_registreer_gebeurtenis('73300000-0000-4000-8000-000000000001','73300000-0000-4000-8000-0000000000a1','microsoft.sharepoint.preview.geslaagd','73300000-0000-4000-8000-000000000099',null,jsonb_build_object('document_ref',v_ref,'latency_ms',12));
  v_geweigerd := false;
  begin
    perform microsoft_private.sharepoint_registreer_gebeurtenis('73300000-0000-4000-8000-000000000001','73300000-0000-4000-8000-0000000000a1','microsoft.sharepoint.preview.geslaagd','73300000-0000-4000-8000-000000000099',null,'{"url":"https://check.sharepoint.com/embed?x=1"}'::jsonb);
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: preview-URL in audit geaccepteerd'; end if;
  v_geweigerd := false;
  begin
    perform microsoft_private.sharepoint_registreer_gebeurtenis('73300000-0000-4000-8000-000000000001','73300000-0000-4000-8000-0000000000a1','microsoft.sharepoint.preview.geslaagd','73300000-0000-4000-8000-000000000099',null,'{"drive_id":"b!x"}'::jsonb);
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: externe id in audit geaccepteerd'; end if;

  -- Een herconfiguratie maakt eerder uitgegeven referenties en gelijktijdige
  -- writes met de oude versie onmiddellijk onbruikbaar.
  perform microsoft_private.sharepoint_configureer_bron('73300000-0000-4000-8000-000000000001','73300000-0000-4000-8000-0000000000a1','73300000-0000-4000-8000-000000000020','tenant-check','check.sharepoint.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222','Bestuur A','check.sharepoint.com','drive-2','Documenten nieuw','root-2','','Bestuur A · Documenten nieuw');
  if exists (select 1 from microsoft_private.sharepoint_lees_document('73300000-0000-4000-8000-000000000001', v_ref)) then
    raise exception 'FAALT: referentie uit oude bronconfiguratie blijft leesbaar';
  end if;
  v_geweigerd := false;
  begin
    perform microsoft_private.sharepoint_upsert_documenten('73300000-0000-4000-8000-000000000001', v_bron, 1, '[{"item_id":"stale","naam":"stale.pdf"}]'::jsonb);
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: write met oude configuratieversie geaccepteerd'; end if;

  raise notice 'Microsoft SharePoint fase-3B gedrag OK: één referentie per item, cross-fonds dicht, web_url-constraint, audit-poort en oude bronconfiguratie dicht.';
end $gedrag$;
rollback;
