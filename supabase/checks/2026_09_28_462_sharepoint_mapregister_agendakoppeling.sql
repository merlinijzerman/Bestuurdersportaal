-- #462 PR-2 — SharePoint-mapregister en agendapuntkoppeling: structuur en gedrag.
-- ROL: database-eigenaar/postgres, na de migraties. `set role microsoft_vault`
-- werkt lokaal niet als postgres (loginrol zonder inherit), dus de ACL wordt
-- bewezen via has_table_privilege/has_function_privilege; het gedrag via de
-- definer-functies zelf. Elke overtreding → raise exception → psql exit ≠ 0.
do $controle$
declare fouten text := ''; v_aantal integer;
begin
  -- Beide tabellen: RLS aan, geen policies, geen enkel direct tabelrecht voor
  -- browser- of vaultrol.
  select count(*) into v_aantal
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'microsoft_private'
     and c.relname in ('sharepoint_mappen','agendapunt_sharepoint_koppelingen')
     and c.relrowsecurity
     and not has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     and not has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     and not has_table_privilege('microsoft_vault', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  if v_aantal <> 2 then fouten := fouten || format(E'\n- verwacht 2 afgeschermde tabellen met RLS, gevonden %s', v_aantal); end if;
  if exists (select 1 from pg_policies where schemaname = 'microsoft_private' and tablename in ('sharepoint_mappen','agendapunt_sharepoint_koppelingen')) then
    fouten := fouten || E'\n- mapregister/koppeltabel heeft een policy (browserpad hoort niet te bestaan)'; end if;

  -- Vijf RPC's: SECURITY DEFINER, gepind search_path, vault mag, browser niet.
  select count(*) into v_aantal from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'microsoft_private'
     and p.proname in ('sharepoint_upsert_mappen','sharepoint_lees_map','sharepoint_koppel_agendapunt','sharepoint_ontkoppel_agendapunt','sharepoint_lees_agendapunt_koppelingen')
     and p.prosecdef and coalesce(array_to_string(p.proconfig, ',') ~ 'search_path=microsoft_private, public, pg_temp$', false)
     and has_function_privilege('microsoft_vault', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_aantal <> 5 then fouten := fouten || format(E'\n- verwacht 5 afgeschermde koppel-/mapfuncties, gevonden %s', v_aantal); end if;

  -- Trigger: aanwezig, gepind search_path, niet uitvoerbaar door browser of vault.
  if not exists (select 1 from pg_trigger where tgname = 'trg_agendapunt_sharepoint_koppeling_validatie' and not tgisinternal
                  and tgrelid = 'microsoft_private.agendapunt_sharepoint_koppelingen'::regclass) then
    fouten := fouten || E'\n- validatietrigger op de koppeltabel ontbreekt'; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'microsoft_private' and p.proname = 'fn_agendapunt_sharepoint_koppeling_validatie'
                and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     or has_function_privilege('microsoft_vault', p.oid, 'EXECUTE')
                     or not coalesce(array_to_string(p.proconfig, ',') ~ 'search_path=microsoft_private, public, pg_temp$', false))) then
    fouten := fouten || E'\n- triggerfunctie is uitvoerbaar door een andere rol of mist een gepind search_path'; end if;

  -- Declaratieve fondsconsistentie: beide composite-FK's en de xor-check.
  select count(*) into v_aantal from pg_constraint
   where conrelid = 'microsoft_private.agendapunt_sharepoint_koppelingen'::regclass
     and conname in ('agendapunt_sp_koppeling_document_fk','agendapunt_sp_koppeling_map_fk') and contype = 'f'
     and array_length(conkey, 1) = 2;
  if v_aantal <> 2 then fouten := fouten || format(E'\n- verwacht 2 composite-FK''s (fonds_id, ref), gevonden %s', v_aantal); end if;
  if not exists (select 1 from pg_constraint where conrelid = 'microsoft_private.agendapunt_sharepoint_koppelingen'::regclass
                  and conname = 'agendapunt_sp_koppeling_precies_een_object' and contype = 'c') then
    fouten := fouten || E'\n- xor-check document_ref/map_ref ontbreekt'; end if;

  -- Geen inhoud-, URL- of previewkolom in het mapregister of de koppeltabel.
  if exists (select 1 from information_schema.columns where table_schema = 'microsoft_private'
              and table_name in ('sharepoint_mappen','agendapunt_sharepoint_koppelingen')
              and (column_name ~* 'inhoud|content|tekst|chunk|embedding|preview|url|token' or data_type in ('bytea','vector'))) then
    fouten := fouten || E'\n- mapregister/koppeltabel bevat een inhoud-/URL-kolom'; end if;
  -- De koppeltabel draagt geen Graph-identiteit; die blijft in de registers.
  if exists (select 1 from information_schema.columns where table_schema = 'microsoft_private'
              and table_name = 'agendapunt_sharepoint_koppelingen' and column_name ~* 'drive|item_id|site') then
    fouten := fouten || E'\n- koppeltabel bevat Graph-identiteit'; end if;

  if fouten <> '' then raise exception '#462 SharePoint mapregister/agendakoppeling databasecontract faalt:%', fouten; end if;
  raise notice '#462 SharePoint mapregister/agendakoppeling databasecontract OK.';
end $controle$;

begin;
insert into public.fondsen(id,naam,slug) values
  ('74620000-0000-4000-8000-000000000001','SP 462 checkfonds A','sp-462-fonds-a'),
  ('74620000-0000-4000-8000-000000000002','SP 462 checkfonds B','sp-462-fonds-b');
insert into auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at) values
  ('74620000-0000-4000-8000-0000000000a1','authenticated','authenticated','sp462-a@test.local','{"naam":"SP462 A"}',now(),now()),
  ('74620000-0000-4000-8000-0000000000b1','authenticated','authenticated','sp462-b@test.local','{"naam":"SP462 B"}',now(),now());
insert into public.profielen(id,fonds_id,naam,rol) values
  ('74620000-0000-4000-8000-0000000000a1','74620000-0000-4000-8000-000000000001','SP462 A','beheerder'),
  ('74620000-0000-4000-8000-0000000000b1','74620000-0000-4000-8000-000000000002','SP462 B','beheerder')
on conflict (id) do update set fonds_id = excluded.fonds_id, naam = excluded.naam, rol = excluded.rol;
insert into microsoft_private.verbindingen(id,fonds_id,gebruiker_id,tenant_id,microsoft_object_id,home_account_id,status,scopes) values
  ('74620000-0000-4000-8000-000000000010','74620000-0000-4000-8000-000000000001','74620000-0000-4000-8000-0000000000a1','tenant-a','user-a','home-a','gekoppeld',array['User.Read','Sites.Selected']),
  ('74620000-0000-4000-8000-000000000011','74620000-0000-4000-8000-000000000002','74620000-0000-4000-8000-0000000000b1','tenant-b','user-b','home-b','gekoppeld',array['User.Read','Sites.Selected']);
insert into microsoft_private.sharepoint_kandidaatsites(id,fonds_id,hostnaam,server_relatief_pad,weergavenaam) values
  ('74620000-0000-4000-8000-000000000020','74620000-0000-4000-8000-000000000001','check-a.sharepoint.com','/sites/bestuur-a','Bestuur A'),
  ('74620000-0000-4000-8000-000000000021','74620000-0000-4000-8000-000000000002','check-b.sharepoint.com','/sites/bestuur-b','Bestuur B');
insert into public.vergaderingen(id,fonds_id,titel,datum) values
  ('74620000-0000-4000-8000-0000000000e1','74620000-0000-4000-8000-000000000001','A-vergadering',now()),
  ('74620000-0000-4000-8000-0000000000e2','74620000-0000-4000-8000-000000000001','A-vergadering 2',now()),
  ('74620000-0000-4000-8000-0000000000e9','74620000-0000-4000-8000-000000000002','B-vergadering',now());
insert into public.agendapunten(id,vergadering_id,titel) values
  ('74620000-0000-4000-8000-0000000000c1','74620000-0000-4000-8000-0000000000e1','A-punt 1'),
  ('74620000-0000-4000-8000-0000000000c2','74620000-0000-4000-8000-0000000000e1','A-punt 2'),
  ('74620000-0000-4000-8000-0000000000c3','74620000-0000-4000-8000-0000000000e1','A-punt verwijderd'),
  ('74620000-0000-4000-8000-0000000000c9','74620000-0000-4000-8000-0000000000e9','B-punt');
update public.agendapunten set verwijderd_op = now() where id = '74620000-0000-4000-8000-0000000000c3';

do $gedrag$
declare
  fa constant uuid := '74620000-0000-4000-8000-000000000001';
  fb constant uuid := '74620000-0000-4000-8000-000000000002';
  ua constant uuid := '74620000-0000-4000-8000-0000000000a1';
  ub constant uuid := '74620000-0000-4000-8000-0000000000b1';
  ap1 constant uuid := '74620000-0000-4000-8000-0000000000c1';
  ap2 constant uuid := '74620000-0000-4000-8000-0000000000c2';
  ap_weg constant uuid := '74620000-0000-4000-8000-0000000000c3';
  ap_b constant uuid := '74620000-0000-4000-8000-0000000000c9';
  v_bron_a uuid; v_bron_b uuid;
  v_doc_a uuid; v_map_a uuid; v_map_a2 uuid; v_doc_b uuid; v_map_b uuid;
  v_k1 uuid; v_k1b uuid; v_k2 uuid; v_nieuw boolean; v_aantal integer; v_geweigerd boolean; v_ok boolean;
  r record;
begin
  v_bron_a := microsoft_private.sharepoint_configureer_bron(fa, ua, '74620000-0000-4000-8000-000000000020', 'tenant-a',
    'check-a.sharepoint.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222', 'Bestuur A', 'check-a.sharepoint.com',
    'drive-a', 'Documenten', 'root-a', '', 'Bestuur A · Documenten');
  v_bron_b := microsoft_private.sharepoint_configureer_bron(fb, ub, '74620000-0000-4000-8000-000000000021', 'tenant-b',
    'check-b.sharepoint.com,33333333-3333-4333-8333-333333333333,44444444-4444-4444-8444-444444444444', 'Bestuur B', 'check-b.sharepoint.com',
    'drive-b', 'Documenten', 'root-b', '', 'Bestuur B · Documenten');

  select ref into v_doc_a from microsoft_private.sharepoint_upsert_documenten(fa, v_bron_a, 1,
    '[{"item_id":"doc-a","naam":"Agenda.docx","bestandstype":"docx","ouder_item_id":"map-a","mappad":"2026"}]'::jsonb);
  select ref into v_doc_b from microsoft_private.sharepoint_upsert_documenten(fb, v_bron_b, 1,
    '[{"item_id":"doc-b","naam":"Nota B.pdf","bestandstype":"pdf","ouder_item_id":"root-b","mappad":""}]'::jsonb);

  -- ── Mapregister: één referentie per map, rename/move volgt ────────────────
  select ref into v_map_a from microsoft_private.sharepoint_upsert_mappen(fa, v_bron_a, 1,
    '[{"item_id":"map-a","naam":"2026","ouder_item_id":"root-a","mappad":"2026"},{"item_id":"map-a2","naam":"09 September","ouder_item_id":"map-a","mappad":"2026/09 September"}]'::jsonb)
   where extern_item_id = 'map-a';
  select m.id into v_map_a2 from microsoft_private.sharepoint_mappen m where m.bron_id = v_bron_a and m.item_id = 'map-a2';
  if v_map_a is null or v_map_a2 is null then raise exception 'FAALT: upsert_mappen leverde geen referenties'; end if;
  if (select ref from microsoft_private.sharepoint_upsert_mappen(fa, v_bron_a, 1,
        '[{"item_id":"map-a","naam":"2026 hernoemd","ouder_item_id":"root-a","mappad":"2026 hernoemd"}]'::jsonb)) <> v_map_a then
    raise exception 'FAALT: rename maakte een tweede mapreferentie';
  end if;
  select count(*) into v_aantal from microsoft_private.sharepoint_mappen where bron_id = v_bron_a;
  if v_aantal <> 2 then raise exception 'FAALT: dubbele mapregisterrij (%)', v_aantal; end if;
  if (select naam from microsoft_private.sharepoint_lees_map(fa, v_map_a)) <> '2026 hernoemd' then raise exception 'FAALT: mapref volgt de rename niet'; end if;
  -- Dubbele item_id binnen één aanroep mag de upsert niet breken ("cannot affect row a second time").
  perform microsoft_private.sharepoint_upsert_mappen(fa, v_bron_a, 1,
    '[{"item_id":"map-dup","naam":"X","mappad":"X"},{"item_id":"map-dup","naam":"X","mappad":"X"}]'::jsonb);
  select ref into v_map_b from microsoft_private.sharepoint_upsert_mappen(fb, v_bron_b, 1, '[{"item_id":"map-b","naam":"B-map","ouder_item_id":"root-b","mappad":"B-map"}]'::jsonb);

  -- Cross-fonds: ref van A onzichtbaar voor B; bron van A niet bruikbaar voor B.
  if exists (select 1 from microsoft_private.sharepoint_lees_map(fb, v_map_a)) then raise exception 'FAALT: mapref van fonds A zichtbaar voor fonds B'; end if;
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_upsert_mappen(fb, v_bron_a, 1, '[{"item_id":"x","naam":"x"}]'::jsonb);
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: upsert_mappen via bron van ander fonds geaccepteerd'; end if;
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_upsert_mappen(fa, v_bron_a, 99, '[{"item_id":"x","naam":"x"}]'::jsonb);
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: upsert_mappen met verkeerde configuratieversie geaccepteerd'; end if;

  -- ── Koppelen: idempotent, document én map ─────────────────────────────────
  select koppeling_id, nieuw into v_k1, v_nieuw from microsoft_private.sharepoint_koppel_agendapunt(fa, ua, ap1, 'document', v_doc_a);
  if v_k1 is null or not v_nieuw then raise exception 'FAALT: eerste documentkoppeling niet aangemaakt'; end if;
  select koppeling_id, nieuw into v_k1b, v_nieuw from microsoft_private.sharepoint_koppel_agendapunt(fa, ua, ap1, 'document', v_doc_a);
  if v_k1b is distinct from v_k1 or v_nieuw then raise exception 'FAALT: koppelen is niet idempotent'; end if;
  select koppeling_id into v_k2 from microsoft_private.sharepoint_koppel_agendapunt(fa, ua, ap1, 'map', v_map_a);
  perform microsoft_private.sharepoint_koppel_agendapunt(fa, ua, ap2, 'document', v_doc_a);
  select count(*) into v_aantal from microsoft_private.agendapunt_sharepoint_koppelingen where agendapunt_id = ap1;
  if v_aantal <> 2 then raise exception 'FAALT: verwacht 2 koppelingen op agendapunt 1, gevonden %', v_aantal; end if;
  if (select vergadering_id from microsoft_private.agendapunt_sharepoint_koppelingen where id = v_k1) <> '74620000-0000-4000-8000-0000000000e1' then
    raise exception 'FAALT: vergadering_id niet uit het agendapunt afgeleid'; end if;

  -- Leesprojectie: lokale refs, soort, naam, mappad; beschikbaar = true.
  select count(*) into v_aantal from microsoft_private.sharepoint_lees_agendapunt_koppelingen(fa, array[ap1, ap2]) k where k.beschikbaar;
  if v_aantal <> 3 then raise exception 'FAALT: verwacht 3 beschikbare koppelingen, gevonden %', v_aantal; end if;
  select * into r from microsoft_private.sharepoint_lees_agendapunt_koppelingen(fa, array[ap1]) k where k.soort = 'map';
  if r.ref <> v_map_a or r.naam <> '2026 hernoemd' or r.mappad <> '2026 hernoemd' then raise exception 'FAALT: mapkoppeling projecteert niet de actuele registerwaarden'; end if;
  if exists (select 1 from microsoft_private.sharepoint_lees_agendapunt_koppelingen(fb, array[ap1, ap2])) then
    raise exception 'FAALT: koppelingen van fonds A zichtbaar voor fonds B'; end if;

  -- ── Cross-fonds koppelen: alle varianten dicht, met één uniforme melding ──
  -- (a) ref van fonds B aan agendapunt van fonds A
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_koppel_agendapunt(fa, ua, ap1, 'document', v_doc_b);
  exception when others then v_geweigerd := sqlerrm = 'sharepoint object niet beschikbaar voor koppeling'; end;
  if not v_geweigerd then raise exception 'FAALT: documentref van fonds B gekoppeld aan agendapunt van fonds A'; end if;
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_koppel_agendapunt(fa, ua, ap1, 'map', v_map_b);
  exception when others then v_geweigerd := sqlerrm = 'sharepoint object niet beschikbaar voor koppeling'; end;
  if not v_geweigerd then raise exception 'FAALT: mapref van fonds B gekoppeld aan agendapunt van fonds A'; end if;
  -- (b) onbestaande ref: zelfde melding als (a) — geen bestaansorakel
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_koppel_agendapunt(fa, ua, ap1, 'document', gen_random_uuid());
  exception when others then v_geweigerd := sqlerrm = 'sharepoint object niet beschikbaar voor koppeling'; end;
  if not v_geweigerd then raise exception 'FAALT: onbestaande ref geeft een afwijkende uitkomst'; end if;
  -- (c) agendapunt van fonds B onder fonds A, en omgekeerd
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_koppel_agendapunt(fa, ua, ap_b, 'document', v_doc_a);
  exception when others then v_geweigerd := sqlerrm = 'agendapunt niet beschikbaar voor sharepoint koppeling'; end;
  if not v_geweigerd then raise exception 'FAALT: agendapunt van fonds B via fonds A koppelbaar'; end if;
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_koppel_agendapunt(fb, ub, ap1, 'document', v_doc_b);
  exception when others then v_geweigerd := sqlerrm = 'agendapunt niet beschikbaar voor sharepoint koppeling'; end;
  if not v_geweigerd then raise exception 'FAALT: agendapunt van fonds A via fonds B koppelbaar'; end if;
  -- (d) soft-verwijderd agendapunt
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_koppel_agendapunt(fa, ua, ap_weg, 'document', v_doc_a);
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: verwijderd agendapunt koppelbaar'; end if;
  -- (e) ongeldige soort
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_koppel_agendapunt(fa, ua, ap1, 'site', v_doc_a);
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: ongeldige koppelsoort geaccepteerd'; end if;

  -- ── Declaratieve laag buiten de RPC om ────────────────────────────────────
  -- composite-FK: fonds A + documentref van fonds B
  v_geweigerd := false;
  begin
    insert into microsoft_private.agendapunt_sharepoint_koppelingen(fonds_id, agendapunt_id, vergadering_id, document_ref)
    values (fa, ap2, '74620000-0000-4000-8000-0000000000e1', v_doc_b);
  exception when foreign_key_violation then v_geweigerd := true; when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: directe insert met ref van fonds B geaccepteerd'; end if;
  -- xor: beide refs, en geen van beide
  v_geweigerd := false;
  begin
    insert into microsoft_private.agendapunt_sharepoint_koppelingen(fonds_id, agendapunt_id, vergadering_id, document_ref, map_ref)
    values (fa, ap2, '74620000-0000-4000-8000-0000000000e1', v_doc_a, v_map_a);
  exception when check_violation then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: koppeling met document_ref EN map_ref geaccepteerd'; end if;
  v_geweigerd := false;
  begin
    insert into microsoft_private.agendapunt_sharepoint_koppelingen(fonds_id, agendapunt_id, vergadering_id)
    values (fa, ap2, '74620000-0000-4000-8000-0000000000e1');
  exception when check_violation then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: koppeling zonder object geaccepteerd'; end if;
  -- trigger: vergadering hoort niet bij het agendapunt
  v_geweigerd := false;
  begin
    insert into microsoft_private.agendapunt_sharepoint_koppelingen(fonds_id, agendapunt_id, vergadering_id, map_ref)
    values (fa, ap2, '74620000-0000-4000-8000-0000000000e2', v_map_a);
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: vergadering_id die niet bij het agendapunt hoort geaccepteerd'; end if;
  -- trigger: fonds B-koppelrij op agendapunt van fonds A met een B-ref (FK klopt, trigger niet)
  v_geweigerd := false;
  begin
    insert into microsoft_private.agendapunt_sharepoint_koppelingen(fonds_id, agendapunt_id, vergadering_id, document_ref)
    values (fb, ap1, '74620000-0000-4000-8000-0000000000e1', v_doc_b);
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: koppelrij van fonds B op agendapunt van fonds A geaccepteerd'; end if;
  -- uniek: dezelfde map twee keer aan hetzelfde agendapunt buiten de RPC om
  v_geweigerd := false;
  begin
    insert into microsoft_private.agendapunt_sharepoint_koppelingen(fonds_id, agendapunt_id, vergadering_id, map_ref)
    values (fa, ap1, '74620000-0000-4000-8000-0000000000e1', v_map_a);
  exception when unique_violation then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: dubbele mapkoppeling geaccepteerd'; end if;
  -- onveranderlijk
  v_geweigerd := false;
  begin update microsoft_private.agendapunt_sharepoint_koppelingen set map_ref = v_map_a2 where id = v_k2;
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: koppelrij bleek wijzigbaar'; end if;

  -- ── Ontkoppelen raakt uitsluitend de koppelrij ────────────────────────────
  if microsoft_private.sharepoint_ontkoppel_agendapunt(fb, ap1, v_k1) then raise exception 'FAALT: fonds B kon koppeling van fonds A ontkoppelen'; end if;
  if microsoft_private.sharepoint_ontkoppel_agendapunt(fa, ap2, v_k1) then raise exception 'FAALT: ontkoppelen via een ander agendapunt geaccepteerd'; end if;
  if not microsoft_private.sharepoint_ontkoppel_agendapunt(fa, ap1, v_k1) then raise exception 'FAALT: ontkoppelen van eigen koppeling mislukt'; end if;
  if exists (select 1 from microsoft_private.agendapunt_sharepoint_koppelingen where id = v_k1) then raise exception 'FAALT: koppelrij bestaat nog'; end if;
  if not exists (select 1 from microsoft_private.sharepoint_lees_document(fa, v_doc_a)) then raise exception 'FAALT: ontkoppelen raakte het documentregister'; end if;
  if not exists (select 1 from microsoft_private.agendapunt_sharepoint_koppelingen where agendapunt_id = ap2 and document_ref = v_doc_a) then
    raise exception 'FAALT: ontkoppelen raakte een koppeling van een ander agendapunt'; end if;
  if microsoft_private.sharepoint_ontkoppel_agendapunt(fa, ap1, v_k1) then raise exception 'FAALT: tweede ontkoppeling meldde succes'; end if;

  -- ── Status ≠ gezien: niet koppelbaar ──────────────────────────────────────
  perform microsoft_private.sharepoint_markeer_document(fa, v_doc_a, 'ontoegankelijk');
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_koppel_agendapunt(fa, ua, ap1, 'document', v_doc_a);
  exception when others then v_geweigerd := sqlerrm = 'sharepoint object niet beschikbaar voor koppeling'; end;
  if not v_geweigerd then raise exception 'FAALT: ontoegankelijk document koppelbaar'; end if;
  select k.beschikbaar into v_ok from microsoft_private.sharepoint_lees_agendapunt_koppelingen(fa, array[ap2]) k where k.ref = v_doc_a;
  if v_ok is distinct from false then raise exception 'FAALT: ontoegankelijk document als beschikbaar geprojecteerd'; end if;
  perform microsoft_private.sharepoint_markeer_document(fa, v_doc_a, 'gezien');

  -- ── Herconfiguratie (nieuwe configuratieversie): niets meer bruikbaar ─────
  perform microsoft_private.sharepoint_configureer_bron(fa, ua, '74620000-0000-4000-8000-000000000020', 'tenant-a',
    'check-a.sharepoint.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222', 'Bestuur A', 'check-a.sharepoint.com',
    'drive-a', 'Documenten', 'root-a', '', 'Bestuur A · Documenten (v2)');
  if exists (select 1 from microsoft_private.sharepoint_lees_map(fa, v_map_a)) then raise exception 'FAALT: mapref uit oude configuratieversie leesbaar'; end if;
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_koppel_agendapunt(fa, ua, ap2, 'map', v_map_a2);
  exception when others then v_geweigerd := sqlerrm = 'sharepoint object niet beschikbaar voor koppeling'; end;
  if not v_geweigerd then raise exception 'FAALT: mapref uit oude configuratieversie koppelbaar'; end if;
  select count(*) into v_aantal from microsoft_private.sharepoint_lees_agendapunt_koppelingen(fa, array[ap1, ap2]) k where k.beschikbaar;
  if v_aantal <> 0 then raise exception 'FAALT: % koppeling(en) uit oude configuratie als beschikbaar geprojecteerd', v_aantal; end if;
  select count(*) into v_aantal from microsoft_private.sharepoint_lees_agendapunt_koppelingen(fa, array[ap1, ap2]);
  if v_aantal <> 2 then raise exception 'FAALT: onbruikbare koppelingen verdwenen uit de projectie (% i.p.v. 2)', v_aantal; end if;
  -- Een volgende listing onder de nieuwe versie maakt de map weer bruikbaar, met dezelfde ref.
  if (select ref from microsoft_private.sharepoint_upsert_mappen(fa, v_bron_a, 2, '[{"item_id":"map-a","naam":"2026","ouder_item_id":"root-a","mappad":"2026"}]'::jsonb)) <> v_map_a then
    raise exception 'FAALT: herlisting onder nieuwe versie gaf een nieuwe mapref'; end if;
  if not exists (select 1 from microsoft_private.sharepoint_lees_map(fa, v_map_a)) then raise exception 'FAALT: mapref na herlisting niet leesbaar'; end if;

  -- ── Inactieve bron: niets leesbaar of koppelbaar; ontkoppelen blijft werken ─
  select koppeling_id into v_k1 from microsoft_private.sharepoint_koppel_agendapunt(fb, ub, ap_b, 'map', v_map_b);
  perform microsoft_private.sharepoint_ontkoppel_bron(fb, ub);
  if exists (select 1 from microsoft_private.sharepoint_lees_map(fb, v_map_b)) then raise exception 'FAALT: mapref van ontkoppelde bron leesbaar'; end if;
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_koppel_agendapunt(fb, ub, ap_b, 'document', v_doc_b);
  exception when others then v_geweigerd := sqlerrm = 'sharepoint object niet beschikbaar voor koppeling'; end;
  if not v_geweigerd then raise exception 'FAALT: koppelen op ontkoppelde bron geaccepteerd'; end if;
  -- Ook een al bestaande koppeling geeft bij opnieuw koppelen geen stille "bestaat al".
  v_geweigerd := false;
  begin perform microsoft_private.sharepoint_koppel_agendapunt(fb, ub, ap_b, 'map', v_map_b);
  exception when others then v_geweigerd := true; end;
  if not v_geweigerd then raise exception 'FAALT: herkoppelen op ontkoppelde bron gaf de bestaande koppeling terug'; end if;
  if not microsoft_private.sharepoint_ontkoppel_agendapunt(fb, ap_b, v_k1) then raise exception 'FAALT: ontkoppelen bij inactieve bron mislukt'; end if;

  -- ── Soft-delete: lees-RPC dwingt `verwijderd_op is null` zelf af ─────────
  -- ap1 draagt hier nog de (onbeschikbare) mapkoppeling v_k2. Na soft-delete
  -- mag de projectie niets meer opleveren; na herstel komt de rij terug. Zo
  -- bewijst de check dat precies `verwijderd_op` de filter is, en dat de rij
  -- zelf blijft bestaan (geen verborgen delete).
  select count(*) into v_aantal from microsoft_private.sharepoint_lees_agendapunt_koppelingen(fa, array[ap1]);
  if v_aantal < 1 then raise exception 'FAALT: soft-delete-voorwaarde: ap1 heeft geen koppeling om te verbergen'; end if;
  update public.agendapunten set verwijderd_op = now() where id = ap1;
  select count(*) into v_aantal from microsoft_private.sharepoint_lees_agendapunt_koppelingen(fa, array[ap1]);
  if v_aantal <> 0 then raise exception 'FAALT: % koppeling(en) van een soft-deleted agendapunt geprojecteerd', v_aantal; end if;
  if not exists (select 1 from microsoft_private.agendapunt_sharepoint_koppelingen where id = v_k2) then
    raise exception 'FAALT: soft-delete verwijderde de koppelrij'; end if;
  update public.agendapunten set verwijderd_op = null where id = ap1;
  select count(*) into v_aantal from microsoft_private.sharepoint_lees_agendapunt_koppelingen(fa, array[ap1]);
  if v_aantal < 1 then raise exception 'FAALT: koppeling na herstel van het agendapunt niet terug'; end if;

  -- ── Cascade: verwijderen agendapunt ruimt koppelingen op, register blijft ─
  delete from public.agendapunten where id = ap2;
  if exists (select 1 from microsoft_private.agendapunt_sharepoint_koppelingen where agendapunt_id = ap2) then
    raise exception 'FAALT: koppelingen bleven staan na verwijderen agendapunt'; end if;
  if not exists (select 1 from microsoft_private.sharepoint_documenten where id = v_doc_a) then
    raise exception 'FAALT: verwijderen agendapunt raakte het documentregister'; end if;

  raise notice '#462 SharePoint mapregister/agendakoppeling gedrag OK: één mapref per item, cross-fonds dicht (RPC, FK en trigger), xor, idempotent koppelen, ontkoppelen alleen koppelrij, oude configuratie en inactieve bron dicht, soft-deleted agendapunt verborgen, cascade.';
end $gedrag$;
rollback;
