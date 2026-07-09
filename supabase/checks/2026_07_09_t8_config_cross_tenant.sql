-- ============================================================================
-- T8 — Cross-tenant + rolgate + append-only testsuite voor de config-/manifestlaag.
-- ----------------------------------------------------------------------------
-- Doel: onder ÉCHTE RLS bewijzen dat de vijf T8-tabellen (fonds_theming,
-- fonds_module_manifest, fonds_feature_flags, fonds_content_overrides,
-- fonds_config_log) tenant-geïsoleerd zijn, dat de schrijf-ROLGATE hard is
-- (alleen voorzitter/beheerder van het eigen fonds), en dat het auditspoor
-- append-only is (UPDATE/DELETE geblokkeerd). Elke overtreding → raise exception
-- → psql exit-code <> 0 → CI faalt.
--
-- Getoetste scenario's (werkopdracht T8, acceptatiecriteria):
--   T8a — SELECT-isolatie: fonds A ziet GEEN config-rij van fonds B (5 tabellen).
--   T8b — Rolgate NEGATIEF: een niet-privileged lid (bestuurder) van fonds A mag
--         GEEN theming schrijven (RLS WITH CHECK weigert).
--   T8c — Rolgate POSITIEF: een beheerder van fonds A mag WEL theming schrijven.
--   T8d — Cross-tenant WRITE: een beheerder van A mag GEEN config voor fonds B
--         schrijven (WITH CHECK op fonds_id weigert).
--   T8e — Append-only: fonds_config_log UPDATE/DELETE worden geblokkeerd.
--   T8f — Atomisch loggen: een config-write levert via de AFTER-trigger
--         automatisch één auditregel (oud→nieuw + versie) in dezelfde transactie.
--
-- Self-seeding (2 fondsen + 3 users via auth-trigger maak_profiel; rol daarna als
-- tabel-eigenaar gezet). Alles in één transactie met ROLLBACK — laat niets achter.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed als tabel-eigenaar (RLS omzeild). Vaste UUID's voor de test. ────────
insert into public.fondsen (id, naam) values
  ('11111111-1111-1111-1111-111111111111', 'T8 Fonds A'),
  ('22222222-2222-2222-2222-222222222222', 'T8 Fonds B');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t8-a-beheer@test.local',
   '{"naam":"A Beheerder","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','t8-a-lid@test.local',
   '{"naam":"A Lid","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','t8-b-beheer@test.local',
   '{"naam":"B Beheerder","fonds_id":"22222222-2222-2222-2222-222222222222"}', now(), now());

-- Rol expliciet zetten (de auth-trigger maakt het profiel; rol = kolomdefault).
update public.profielen set rol = 'beheerder'  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.profielen set rol = 'bestuurder' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
update public.profielen set rol = 'beheerder'  where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

do $$
begin
  if (select rol from public.profielen where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') <> 'bestuurder'
     or (select fonds_id from public.profielen where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
          is distinct from '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'SEED FAALT: profiel A-lid niet correct (rol/fonds).';
  end if;
end $$;

-- Config-rijen voor fonds B (eigenaar-insert; RLS omzeild bij seed). De AFTER-
-- trigger fn_fonds_config_capture (migratie t8b) genereert per insert AUTOMATISCH
-- een fonds_config_log-regel voor fonds B — daarom géén handmatige log-insert
-- meer (die zou botsen op de UNIQUE(fonds_id,config_type,sleutel,versie)).
insert into public.fonds_theming (fonds_id, tokens)
  values ('22222222-2222-2222-2222-222222222222', '{"accent-rgb":"9 9 9"}'::jsonb);
insert into public.fonds_module_manifest (fonds_id, module_key, actief)
  values ('22222222-2222-2222-2222-222222222222', 'risicomatrix', false);
insert into public.fonds_feature_flags (fonds_id, flag_key, waarde)
  values ('22222222-2222-2222-2222-222222222222', 'hybride_zoeken', 'true'::jsonb);
insert into public.fonds_content_overrides (fonds_id, sleutel, waarde)
  values ('22222222-2222-2222-2222-222222222222', 'welkom', 'Hoi B');

-- ════════════════════════════════════════════════════════════════════════════
-- T8a — SELECT-isolatie: fonds A ziet GÉÉN config-rij van fonds B.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

do $$
declare n int;
begin
  select
    (select count(*) from public.fonds_theming           where fonds_id='22222222-2222-2222-2222-222222222222')
  + (select count(*) from public.fonds_module_manifest   where fonds_id='22222222-2222-2222-2222-222222222222')
  + (select count(*) from public.fonds_feature_flags     where fonds_id='22222222-2222-2222-2222-222222222222')
  + (select count(*) from public.fonds_content_overrides where fonds_id='22222222-2222-2222-2222-222222222222')
  + (select count(*) from public.fonds_config_log        where fonds_id='22222222-2222-2222-2222-222222222222')
  into n;
  if n <> 0 then
    raise exception 'LEK T8a: fonds A ziet % config-rij(en) van fonds B (cross-tenant leesisolatie kapot).', n;
  end if;
  raise notice 'OK T8a: fonds A ziet geen enkele config-rij van fonds B (5 tabellen).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T8b — Rolgate NEGATIEF: een bestuurder (niet-privileged) mag geen theming schrijven.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}';

do $$
declare gelukt boolean := false;
begin
  begin
    insert into public.fonds_theming (fonds_id, tokens)
    values ('11111111-1111-1111-1111-111111111111', '{"accent-rgb":"1 1 1"}'::jsonb);
    gelukt := true; -- als we hier komen liet RLS de insert door
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: RLS WITH CHECK (rol) weigert
  end;
  if gelukt then
    raise exception 'LEK T8b: bestuurder kon theming SCHRIJVEN (rolgate geschonden).';
  end if;
  raise notice 'OK T8b: theming-INSERT geweigerd voor niet-privileged bestuurder.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T8c — Rolgate POSITIEF: een beheerder van fonds A mag WEL theming schrijven.
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

do $$
declare n int;
begin
  insert into public.fonds_theming (fonds_id, tokens)
  values ('11111111-1111-1111-1111-111111111111', '{"accent-rgb":"2 2 2"}'::jsonb);
  select count(*) into n from public.fonds_theming
   where fonds_id='11111111-1111-1111-1111-111111111111';
  if n <> 1 then
    raise exception 'REGRESSIE T8c: beheerder kon eigen theming niet schrijven (n=%).', n;
  end if;
  raise notice 'OK T8c: beheerder schrijft eigen theming (rolgate laat privileged door).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T8d — Cross-tenant WRITE: beheerder van A mag GEEN config voor fonds B schrijven.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare gelukt boolean := false;
begin
  begin
    insert into public.fonds_feature_flags (fonds_id, flag_key, waarde)
    values ('22222222-2222-2222-2222-222222222222', 'ingesloten', 'true'::jsonb);
    gelukt := true;
  exception when insufficient_privilege then
    gelukt := false; -- verwacht: WITH CHECK op fonds_id weigert vreemd fonds
  end;
  if gelukt then
    raise exception 'LEK T8d: beheerder van A kon een flag voor fonds B SCHRIJVEN (cross-tenant write).';
  end if;
  raise notice 'OK T8d: cross-tenant config-write (A→B) geweigerd.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T8e — Append-only: fonds_config_log UPDATE/DELETE worden geblokkeerd.
--       We schrijven eerst een eigen (fonds A) auditregel, dan proberen we die
--       te muteren/verwijderen — beide moeten falen op de append-only-trigger.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_id uuid; upd_geblokkeerd boolean := false; del_geblokkeerd boolean := false;
begin
  -- Aparte probe-sleutel: de theming/tokens/versie=1-logregel bestaat al (door de
  -- trigger uit T8c) en zou botsen op de UNIQUE-constraint.
  insert into public.fonds_config_log (fonds_id, gebruiker_id, config_type, config_sleutel, nieuwe_waarde, versie)
  values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'flag','append_only_probe','true'::jsonb, 1)
  returning id into v_id;

  begin
    update public.fonds_config_log set versie = 99 where id = v_id;
  exception when others then
    upd_geblokkeerd := true; -- verwacht: fn_log_append_only raise exception
  end;
  if not upd_geblokkeerd then
    raise exception 'LEK T8e: UPDATE op fonds_config_log toegestaan (append-only geschonden).';
  end if;

  begin
    delete from public.fonds_config_log where id = v_id;
  exception when others then
    del_geblokkeerd := true; -- verwacht: fn_log_append_only raise exception
  end;
  if not del_geblokkeerd then
    raise exception 'LEK T8e: DELETE op fonds_config_log toegestaan (append-only geschonden).';
  end if;

  raise notice 'OK T8e: UPDATE en DELETE op fonds_config_log geblokkeerd (append-only).';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- T8f — ATOMISCH loggen via trigger: de theming-write van T8c (beheerder A) heeft
--       AUTOMATISCH een fonds_config_log-regel opgeleverd (oud→nieuw + versie), in
--       dezelfde transactie. Bewijst dat het auditspoor niet los kan raken van de
--       wijziging (geen stil audit-gat) en dat de app-laag niets hoeft te doen.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare n int;
begin
  select count(*) into n from public.fonds_config_log
   where fonds_id = '11111111-1111-1111-1111-111111111111'
     and config_type = 'theming' and config_sleutel = 'tokens' and versie = 1
     and nieuwe_waarde = '{"accent-rgb":"2 2 2"}'::jsonb;
  if n <> 1 then
    raise exception 'GAT T8f: verwacht 1 trigger-gegenereerde theming-auditregel voor A, kreeg %.', n;
  end if;
  raise notice 'OK T8f: config-write logt atomisch via trigger (1 auditregel, oud→nieuw+versie).';
end $$;

reset role;

rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de "OK …"-notices zag (T8a–T8e).
-- Elke "LEK:"/"REGRESSIE" doet raise exception → non-zero exit → CI faalt.
-- ============================================================================
