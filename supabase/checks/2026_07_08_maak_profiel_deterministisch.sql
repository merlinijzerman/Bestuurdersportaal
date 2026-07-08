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
--   1. geldig fonds_id in metadata  → profiel op EXACT dat fonds;
--   2. ontbrekend fonds_id          → fail-closed (exception, geen profiel);
--   3. ongeldige UUID               → fail-closed (exception, geen profiel);
--   4. geldige maar onbekende UUID  → fail-closed (exception, geen profiel);
--   5. platform-account             → géén profiel (guard behouden), geen fonds nodig.
-- Elke faal-case wordt POSITIEF bevestigd: we vangen de exception en asserten dat
-- er géén profielen-rij ontstond (geen "eerste fonds"-fallback).
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
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'check1@example.test',
          jsonb_build_object('naam', 'Check Een', 'fonds_id', v_fonds_a::text));

  select count(*) into v_rows
  from public.profielen where id = v_user and fonds_id = v_fonds_a;
  assert v_rows = 1,
    'Case 1: verwacht precies 1 profiel op het meegegeven fonds';
  raise notice 'Case 1 OK — geldig fonds_id → profiel op juist fonds';

  -- ── Case 2 — ontbrekend fonds_id → exception, geen profiel ───────────────
  v_user := gen_random_uuid();
  v_gefaald := false;
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'check2@example.test',
            jsonb_build_object('naam', 'Check Twee'));   -- géén fonds_id
  exception when others then
    v_gefaald := true;
  end;
  assert v_gefaald, 'Case 2: verwacht een exception bij ontbrekend fonds_id';
  select count(*) into v_rows from public.profielen where id = v_user;
  assert v_rows = 0, 'Case 2: er mag GEEN profiel zijn (geen eerste-fonds-fallback)';
  raise notice 'Case 2 OK — ontbrekend fonds_id → fail-closed, geen profiel';

  -- ── Case 3 — ongeldige UUID → exception, geen profiel ────────────────────
  v_user := gen_random_uuid();
  v_gefaald := false;
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
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
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
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
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'checkplatform@example.test',
          jsonb_build_object('platform', true));   -- geen fonds_id nodig
  select count(*) into v_rows from public.profielen where id = v_user;
  assert v_rows = 0, 'Case 5: platform-account mag GEEN profiel krijgen';
  raise notice 'Case 5 OK — platform-account → geen profiel (guard behouden)';

  raise notice 'ALLE R1-CHECKS GESLAAGD';
end $$;

rollback;
