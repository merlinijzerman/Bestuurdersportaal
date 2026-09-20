-- #413 T4-C — GEDRAGSBEWIJS voor de canonieke webUrl-locator met quarantaine.
-- Run dit als database-eigenaar na de migratie; hij seedt zichzelf en rollbackt.
-- ROL: database-eigenaar/postgres.
--
-- Waarom deze suite bestaat: de migratie raakt een BESTAAND schrijfpad
-- (`sharepoint_upsert_documenten`, de documentenlijst). De gevallen waarin een
-- naïeve unieke index stukloopt — een omwisseling van twee URL's binnen één
-- listing, een nieuwe rij die botst met een rij buiten de listing, twee
-- gelijktijdige listings — zijn precies de gevallen die nooit in een review
-- opvallen. Ze horen dus in de gate, niet in een scratchpad.

-- ── Structureel ─────────────────────────────────────────────────────────────
do $controle$
declare fouten text := ''; v_aantal integer; v_bron text;
begin
  select count(*) into v_aantal from information_schema.columns
   where table_schema = 'microsoft_private' and table_name = 'sharepoint_documenten'
     and column_name in ('web_url_canoniek', 'mapping_status');
  if v_aantal <> 2 then fouten := fouten || format(E'\n- verwacht web_url_canoniek en mapping_status, gevonden %s', v_aantal); end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'microsoft_private' and table_name = 'sharepoint_documenten'
       and column_name = 'web_url_canoniek' and is_generated = 'ALWAYS'
  ) then fouten := fouten || E'\n- web_url_canoniek is geen GEGENEREERDE kolom (opslag en opzoeking kunnen dan uiteenlopen)'; end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'microsoft_private' and indexname = 'sharepoint_documenten_weburl_canoniek_uniek'
       and indexdef like '%UNIQUE%'
       and indexdef like '%mapping_status = ''actief''%'
       and indexdef like '%web_url_canoniek IS NOT NULL%'
  ) then fouten := fouten || E'\n- de partiële unieke index op (bron_id, web_url_canoniek) ontbreekt of is niet partieel'; end if;

  -- De canonicalisering moet IMMUTABLE zijn: anders kan zij niet in een
  -- gegenereerde kolom staan en zou opslag van opzoeking kunnen afwijken.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'microsoft_private' and p.proname = 'sharepoint_canoniek_weburl'
       and p.provolatile = 'i' and p.proisstrict
  ) then fouten := fouten || E'\n- sharepoint_canoniek_weburl is niet IMMUTABLE STRICT'; end if;

  select count(*) into v_aantal from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'microsoft_private' and p.proname = 'sharepoint_zoek_document_op_weburl'
     and p.prosecdef
     and has_function_privilege('microsoft_vault', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_aantal <> 1 then fouten := fouten || E'\n- de locatorfunctie ontbreekt of is niet afgeschermd tot microsoft_vault'; end if;

  -- De serialisatie per bron is geen detail maar de voorwaarde waaronder de
  -- drie upsert-stappen samen correct zijn; een verdwenen lock is stil.
  select prosrc into v_bron from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'microsoft_private' and p.proname = 'sharepoint_upsert_documenten';
  if v_bron is null or v_bron !~ 'pg_advisory_xact_lock' then
    fouten := fouten || E'\n- sharepoint_upsert_documenten serialiseert niet per bron (advisory lock ontbreekt)';
  end if;

  if fouten <> '' then raise exception '#413 webUrl-locator structuur faalt:%', fouten; end if;
  raise notice '#413 webUrl-locator structuur OK.';
end $controle$;

-- ── Gedrag ──────────────────────────────────────────────────────────────────
begin;
insert into public.fondsen(id,naam,slug) values
  ('74130000-0000-4000-8000-000000000001','413 checkfonds A','413-fonds-a'),
  ('74130000-0000-4000-8000-000000000002','413 checkfonds B','413-fonds-b');
insert into auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at) values
  ('74130000-0000-4000-8000-0000000000a1','authenticated','authenticated','c413-a@test.local','{"naam":"C413 A"}',now(),now());
insert into public.profielen(id,fonds_id,naam,rol) values
  ('74130000-0000-4000-8000-0000000000a1','74130000-0000-4000-8000-000000000001','C413 A','beheerder');
insert into microsoft_private.verbindingen(id,fonds_id,gebruiker_id,tenant_id,microsoft_object_id,home_account_id,status,scopes) values
  ('74130000-0000-4000-8000-000000000010','74130000-0000-4000-8000-000000000001','74130000-0000-4000-8000-0000000000a1','tenant-413','user-a','home-a','gekoppeld',array['User.Read','Sites.Selected']);
insert into microsoft_private.sharepoint_kandidaatsites(id,fonds_id,hostnaam,server_relatief_pad,weergavenaam) values
  ('74130000-0000-4000-8000-000000000020','74130000-0000-4000-8000-000000000001','check.sharepoint.com','/sites/bestuur-a','Bestuur A');

do $gedrag$
declare
  v_bron uuid;
  v_ref uuid;
  v_status text;
  v_gevonden uuid;
  v_aantal integer;
  v_url text := 'https://check.sharepoint.com/sites/bestuur-a/Documenten/';
begin
  v_bron := microsoft_private.sharepoint_configureer_bron(
    '74130000-0000-4000-8000-000000000001','74130000-0000-4000-8000-0000000000a1','74130000-0000-4000-8000-000000000020',
    'tenant-413','check.sharepoint.com,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222',
    'Bestuur A','check.sharepoint.com','drive-1','Documenten','root-1','','Bestuur A · Documenten');

  -- 1. Eén unieke URL is actief en vindbaar.
  select ref into v_ref from microsoft_private.sharepoint_upsert_documenten(
    '74130000-0000-4000-8000-000000000001', v_bron, 1,
    format('[{"item_id":"a1","naam":"Uniek.docx","web_url":"%sUniek.docx"}]', v_url)::jsonb);
  select id into v_gevonden from microsoft_private.sharepoint_zoek_document_op_weburl(
    '74130000-0000-4000-8000-000000000001', v_bron, v_url || 'Uniek.docx');
  if v_gevonden is distinct from v_ref then raise exception 'FAALT: unieke URL niet gevonden'; end if;

  -- 2. Schrijfwijzevarianten wijzen dezelfde rij aan; canonicalisering werkt.
  for v_status in select unnest(array[
      v_url || 'Uniek.docx/',
      v_url || 'Uniek.docx?web=1',
      'https://CHECK.sharepoint.com/sites/bestuur-a/Documenten/Uniek.docx',
      'https://check.sharepoint.com:443/sites/bestuur-a/Documenten/Uniek.docx'])
  loop
    select id into v_gevonden from microsoft_private.sharepoint_zoek_document_op_weburl(
      '74130000-0000-4000-8000-000000000001', v_bron, v_status);
    if v_gevonden is distinct from v_ref then raise exception 'FAALT: variant % wijst niet dezelfde rij aan', v_status; end if;
  end loop;

  -- 3. %2F mag NOOIT samenvallen met een echte padscheiding.
  perform microsoft_private.sharepoint_upsert_documenten('74130000-0000-4000-8000-000000000001', v_bron, 1,
    format('[{"item_id":"p1","naam":"Map.docx","web_url":"%smap%%2FX.docx"},{"item_id":"p2","naam":"Map2.docx","web_url":"%smap/X.docx"}]', v_url, v_url)::jsonb);
  select count(*) into v_aantal from microsoft_private.sharepoint_documenten
   where bron_id = v_bron and item_id in ('p1','p2') and mapping_status = 'actief';
  if v_aantal <> 2 then raise exception 'FAALT: %%2F en een echte padscheiding vielen samen'; end if;

  -- 4. Twee items met dezelfde canonieke URL: de upsert valt NIET om en beide
  --    belanden in quarantaine — met hun web_url intact.
  perform microsoft_private.sharepoint_upsert_documenten('74130000-0000-4000-8000-000000000001', v_bron, 1,
    format('[{"item_id":"b1","naam":"Dubbel.docx","web_url":"%sDubbel.docx"},{"item_id":"b2","naam":"Dubbel.docx","web_url":"%sDubbel.docx/"}]', v_url, v_url)::jsonb);
  select count(*) into v_aantal from microsoft_private.sharepoint_documenten
   where bron_id = v_bron and item_id in ('b1','b2') and mapping_status = 'botsing' and web_url is not null;
  if v_aantal <> 2 then raise exception 'FAALT: botsende rijen niet in quarantaine of web_url gewist (%)', v_aantal; end if;

  -- 5. En dan vindt de locator die URL niet meer: fail-closed bij ambiguïteit.
  if exists (select 1 from microsoft_private.sharepoint_zoek_document_op_weburl(
    '74130000-0000-4000-8000-000000000001', v_bron, v_url || 'Dubbel.docx')) then
    raise exception 'FAALT: quarantainerij is via de locator bereikbaar';
  end if;

  -- 6. Maar de rij blijft gewoon leesbaar in het register (geen gegevensverlies).
  select count(*) into v_aantal from microsoft_private.sharepoint_documenten
   where bron_id = v_bron and item_id = 'b1' and web_url = v_url || 'Dubbel.docx';
  if v_aantal <> 1 then raise exception 'FAALT: quarantaine heeft de web_url aangetast'; end if;

  -- 7. HERSTEL: verdwijnt de botsing, dan wordt de rij vanzelf weer actief.
  perform microsoft_private.sharepoint_upsert_documenten('74130000-0000-4000-8000-000000000001', v_bron, 1,
    format('[{"item_id":"b2","naam":"Anders.docx","web_url":"%sAnders.docx"}]', v_url)::jsonb);
  select count(*) into v_aantal from microsoft_private.sharepoint_documenten
   where bron_id = v_bron and item_id in ('b1','b2') and mapping_status = 'actief';
  if v_aantal <> 2 then raise exception 'FAALT: quarantaine is permanent gebleken (%)', v_aantal; end if;

  -- 8. OMWISSELING binnen één listing — hier loopt een naïeve index op stuk.
  perform microsoft_private.sharepoint_upsert_documenten('74130000-0000-4000-8000-000000000001', v_bron, 1,
    format('[{"item_id":"b1","naam":"A.docx","web_url":"%sAnders.docx"},{"item_id":"b2","naam":"B.docx","web_url":"%sDubbel.docx"}]', v_url, v_url)::jsonb);
  select count(*) into v_aantal from microsoft_private.sharepoint_documenten
   where bron_id = v_bron and item_id in ('b1','b2') and mapping_status = 'actief';
  if v_aantal <> 2 then raise exception 'FAALT: omwisseling van twee URL''s leverde geen twee actieve rijen (%)', v_aantal; end if;

  -- 9. Een nieuwe rij die botst met een BESTAANDE rij buiten de listing.
  perform microsoft_private.sharepoint_upsert_documenten('74130000-0000-4000-8000-000000000001', v_bron, 1,
    format('[{"item_id":"c1","naam":"Botst.docx","web_url":"%sUniek.docx?x=1"}]', v_url)::jsonb);
  select count(*) into v_aantal from microsoft_private.sharepoint_documenten
   where bron_id = v_bron and item_id in ('a1','c1') and mapping_status = 'botsing';
  if v_aantal <> 2 then raise exception 'FAALT: botsing met een rij buiten de listing niet opgemerkt (%)', v_aantal; end if;
  if exists (select 1 from microsoft_private.sharepoint_zoek_document_op_weburl(
    '74130000-0000-4000-8000-000000000001', v_bron, v_url || 'Uniek.docx')) then
    raise exception 'FAALT: locator geeft nog een treffer terwijl de URL ambigu is';
  end if;

  -- 10. De invariant zelf: nooit twee ACTIEVE rijen met dezelfde canonieke URL.
  select count(*) into v_aantal from (
    select bron_id, web_url_canoniek from microsoft_private.sharepoint_documenten
     where web_url_canoniek is not null and mapping_status = 'actief'
     group by bron_id, web_url_canoniek having count(*) > 1) g;
  if v_aantal <> 0 then raise exception 'FAALT: % actieve canonieke botsing(en)', v_aantal; end if;

  -- 11. Cross-tenant: fonds B vindt niets in de bron van fonds A.
  if exists (select 1 from microsoft_private.sharepoint_zoek_document_op_weburl(
    '74130000-0000-4000-8000-000000000002', v_bron, v_url || 'Anders.docx')) then
    raise exception 'FAALT: locator van fonds A bereikbaar voor fonds B';
  end if;

  -- 12. Onbekende en niet-canonicaliseerbare URL's leveren niets op.
  for v_status in select unnest(array[
      v_url || 'Bestaat-niet.docx',
      'http://check.sharepoint.com/sites/bestuur-a/Documenten/Anders.docx',
      'https://evil.test/sites/bestuur-a/Documenten/Anders.docx',
      'geen-url', ''])
  loop
    if exists (select 1 from microsoft_private.sharepoint_zoek_document_op_weburl(
      '74130000-0000-4000-8000-000000000001', v_bron, v_status)) then
      raise exception 'FAALT: locator gaf een treffer op %', v_status;
    end if;
  end loop;

  raise notice '#413 webUrl-locator gedrag OK: canonicalisering, quarantaine zonder gegevensverlies, herstel, omwisseling, botsing buiten de listing, invariant, cross-tenant en fail-closed opzoeking.';
end $gedrag$;
rollback;
