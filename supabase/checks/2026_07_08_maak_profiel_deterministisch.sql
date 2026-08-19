-- ============================================================================
-- Verificatie R1 (increment T2) — deterministische fondstoewijzing in
-- maak_profiel(). Hoort bij migratie 2026_07_08_maak_profiel_deterministisch.sql.
-- ----------------------------------------------------------------------------
-- WAAROM EEN CHECK-SCRIPT I.P.V. EEN TS-SANITY: de logica leeft in een DB-trigger
-- op auth.users (SECURITY DEFINER). Die is niet via de anon-key / het tsx-
-- sanity-pad (lib/*.sanity.ts) te draaien — hij vereist een insert in auth.users
-- en het auth-schema. Dit script is de reproduceerbare test: plak het als geheel
-- in de Supabase SQL-editor (die draait als 'postgres' en mag in auth.users
-- inserten) NADAT de migratie is gedraaid. Alles staat binnen één
-- begin;…rollback; — het is non-destructief en laat geen test-users of -profielen
-- achter.
--
-- DEKT (werkopdracht T2, acceptatie R1):
--   1. geldig fonds_id in APP-metadata → profiel op EXACT dat fonds;
--   2. ontbrekend fonds_id bij INSERT  → deferred (geen profiel);
--   3. ongeldige UUID                  → fail-closed (exception, geen profiel);
--   4. geldige maar onbekende UUID     → fail-closed (exception, geen profiel);
--   5. platform-account (app-metadata) → géén profiel (guard behouden).
--
-- AANGEVULD 17-08-2026 (WP1 / PT-1) — de grens tegen zelfregistratie:
--   6. fonds_id ALLEEN in user-metadata → geen profiel/toegang;
--   7. platform-vlag in user-metadata   → geweigerd;
--   8. tegensprekende metadata          → app-metadata wint, niet de client.
--
-- Het fonds komt sinds WP1 uit `raw_app_meta_data`. Dat veld is niet
-- client-schrijfbaar: `supabase.auth.signUp({ options: { data } })` vult
-- uitsluitend `raw_user_meta_data`. Case 6 is daarmee de bevinding zelf, in
-- testvorm — hij bootst precies na wat een buitenstaander met de publieke
-- anon-key kan sturen.
--
-- Elke negatieve case wordt POSITIEF bevestigd: er ontstaat geen profiel via
-- user-metadata en er is geen "eerste fonds"-fallback.
-- ============================================================================

begin;

do $$
declare
  v_fonds_a  uuid;
  v_user     uuid;
  v_rows     int;
  v_gefaald  boolean;
  v_onbekend uuid := '00000000-0000-0000-0000-0000000000ff';  -- bestaat niet
begin
  -- Testfonds (rolt straks mee terug).
  insert into public.fondsen (naam, slug)
  values ('CHECK Testfonds R1', 'check-testfonds-r1-' || gen_random_uuid())
  returning id into v_fonds_a;

  -- ── Case 1 — geldig fonds_id → profiel op dat fonds ──────────────────────
  v_user := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'check1@example.test',
          jsonb_build_object('fonds_id', v_fonds_a::text));

  select count(*) into v_rows
  from public.profielen where id = v_user and fonds_id = v_fonds_a;
  assert v_rows = 1,
    'Case 1: verwacht precies 1 profiel op het meegegeven fonds';
  raise notice 'Case 1 OK — geldig fonds_id → profiel op juist fonds';

  -- ── Case 2 — ontbrekend fonds_id → deferred, geen profiel ───────────────
  v_user := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'check2@example.test',
          '{}'::jsonb);   -- geen app-metadata bij de eerste Auth-INSERT
  select count(*) into v_rows from public.profielen where id = v_user;
  assert v_rows = 0, 'Case 2: er mag GEEN profiel zijn (geen eerste-fonds-fallback)';
  update auth.users
     set raw_app_meta_data = jsonb_build_object('fonds_id', v_fonds_a::text)
   where id = v_user;
  select count(*) into v_rows
  from public.profielen where id = v_user and fonds_id = v_fonds_a;
  assert v_rows = 1, 'Case 2: app-metadata-update moet het profiel provisionen';
  raise notice 'Case 2 OK — ontbrekend fonds_id bij INSERT → profiel pas na app-metadata-update';

  -- ── Case 3 — ongeldige UUID → exception, geen profiel ────────────────────
  v_user := gen_random_uuid();
  v_gefaald := false;
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'check3@example.test',
            jsonb_build_object('fonds_id', 'niet-een-uuid'));
  exception when others then
    v_gefaald := true;
  end;
  assert v_gefaald, 'Case 3: verwacht een exception bij ongeldige UUID';
  select count(*) into v_rows from public.profielen where id = v_user;
  assert v_rows = 0, 'Case 3: er mag GEEN profiel zijn';
  raise notice 'Case 3 OK — ongeldige UUID → fail-closed, geen profiel';

  -- ── Case 4 — geldige maar onbekende UUID → exception, geen profiel ───────
  v_user := gen_random_uuid();
  v_gefaald := false;
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'check4@example.test',
            jsonb_build_object('fonds_id', v_onbekend::text));
  exception when others then
    v_gefaald := true;
  end;
  assert v_gefaald, 'Case 4: verwacht een exception bij onbekend fonds';
  select count(*) into v_rows from public.profielen where id = v_user;
  assert v_rows = 0, 'Case 4: er mag GEEN profiel zijn';
  raise notice 'Case 4 OK — onbekend fonds → fail-closed, geen profiel';

  -- ── Case 5 — platform-account → geen profiel (guard behouden) ────────────
  v_user := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'checkplatform@example.test',
          jsonb_build_object('platform', true));   -- geen fonds_id nodig
  select count(*) into v_rows from public.profielen where id = v_user;
  assert v_rows = 0, 'Case 5: platform-account mag GEEN profiel krijgen';
  raise notice 'Case 5 OK — platform-account → geen profiel (guard behouden)';

  -- ══════════════════════════════════════════════════════════════════════════
  --  Cases 6-8 — WP1 (17-08-2026): de grens tegen zelfregistratie.
  --
  --  Dit zijn de cases die PT-1 sluiten. Case 6 is de bevinding zelf: precies
  --  wat `supabase.auth.signUp({ options: { data: { fonds_id } } })` met de
  --  PUBLIEKE anon-key in auth.users zet. Die insert mag hoogstens een
  --  profiel-loos account opleveren; `profielen.fonds_id` is de sleutel waar
  --  vrijwel elke RLS-policy op rust.
  -- ══════════════════════════════════════════════════════════════════════════

  -- ── Case 6 — fonds_id ALLEEN in user-metadata → geen profiel/toegang ──────
  v_user := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email,
                          raw_user_meta_data, raw_app_meta_data)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'check6@example.test',
          -- exact de vorm die een client zelf kan zetten:
          jsonb_build_object('naam', 'Zelf Geregistreerd',
                             'fonds_id', v_fonds_a::text),
          '{}'::jsonb);
  select count(*) into v_rows from public.profielen where id = v_user;
  assert v_rows = 0, 'Case 6: er mag GEEN profiel zijn';
  select count(*) into v_rows from auth.users where id = v_user;
  assert v_rows = 1, 'Case 6: de Auth-user mag bestaan zonder tenantprofiel';
  raise notice 'Case 6 OK — fonds_id in user-metadata → geen profiel/toegang';

  -- ── Case 7 — platform-vlag in user-metadata → weigeren ─────────────────────
  -- Zonder deze regel zou de vlag stil worden genegeerd en kreeg de aanvrager
  -- alsnog een tenant-profiel op een fonds naar keuze.
  v_user := gen_random_uuid();
  v_gefaald := false;
  begin
    insert into auth.users (id, instance_id, aud, role, email,
                            raw_user_meta_data, raw_app_meta_data)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'check7@example.test',
            jsonb_build_object('platform', true), '{}'::jsonb);
  exception when others then
    v_gefaald := true;
  end;
  assert v_gefaald,
    'LEK (PT-1): platform-vlag in user-metadata werd GEACCEPTEERD';
  select count(*) into v_rows from auth.users where id = v_user;
  assert v_rows = 0, 'Case 7: de auth-user moet zijn teruggerold';
  raise notice 'Case 7 OK — platform-vlag in user-metadata → geweigerd';

  -- ── Case 8 — app-metadata wint niet van een tegensprekende user-metadata ───
  -- Een aanvrager kan user-metadata meesturen; de back-office zet app-metadata.
  -- Het profiel moet op het APP-fonds landen, niet op het zelfgekozen fonds.
  declare
    v_fonds_b uuid;
  begin
    insert into public.fondsen (naam, slug)
    values ('CHECK Testfonds R1-B', 'check-testfonds-r1b-' || gen_random_uuid())
    returning id into v_fonds_b;

    v_user := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email,
                            raw_user_meta_data, raw_app_meta_data)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'check8@example.test',
            jsonb_build_object('naam', 'Tegenspraak',
                               'fonds_id', v_fonds_a::text),   -- zelfgekozen
            jsonb_build_object('fonds_id', v_fonds_b::text));  -- back-office

    select count(*) into v_rows
    from public.profielen where id = v_user and fonds_id = v_fonds_b;
    assert v_rows = 1,
      'LEK (PT-1): profiel landde niet op het fonds uit app-metadata';
    select count(*) into v_rows
    from public.profielen where id = v_user and fonds_id = v_fonds_a;
    assert v_rows = 0,
      'LEK (PT-1): het zelfgekozen fonds uit user-metadata won';
    raise notice 'Case 8 OK — bij tegenspraak wint app-metadata, niet de client';
  end;

  raise notice 'ALLE R1-CHECKS GESLAAGD';
end $$;

rollback;
