-- ============================================================================
--  Gedragssuite — Microsoft-login startlimiet (#335 T2, V9); hoort bij
--  supabase/migrations/2026_09_07_microsoft_login_startlimiet.sql.
--
--  DEEL 1 — STRUCTUUR: tabel zonder rolrechten (RLS aan), functie SECURITY DEFINER
--           met gepind search_path, EXECUTE uitsluitend login_gateway (die daarmee
--           veertien functies mag uitvoeren — geteld in de F1B-suite).
--  DEEL 2 — GEDRAG (transactie, rollback): 20 tellingen toegestaan, 21e geweigerd
--           met resterend 0 en reset_op = vensterstart + venster; andere sleutel telt
--           apart; ongeldige sleutel/limiet raisen; login_gateway kan de functie
--           uitvoeren maar de tabel niet lezen; oude vensters worden opgeruimd.
--  Draaien:  psql "$DB" -v ON_ERROR_STOP=1 -f supabase/checks/2026_09_07_microsoft_login_startlimiet.sql
-- ============================================================================
-- ROL: postgres; per scenario `set local role login_gateway` (lidmaatschap binnen de
--      transactie verleend en teruggedraaid).

\echo '== DEEL 1 — STRUCTUUR (startlimiet) =='
do $$
declare fouten text := ''; v_def boolean; v_path text;
begin
  if to_regclass('login_private.start_pogingen') is null then fouten := fouten || E'\n- tabel login_private.start_pogingen ontbreekt'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('login_private.start_pogingen')) then
    fouten := fouten || E'\n- RLS staat uit op start_pogingen';
  end if;
  for v_path in select r from unnest(array['anon','authenticated','service_role','login_gateway']) r loop
    if has_table_privilege(v_path, 'login_private.start_pogingen', 'SELECT,INSERT,UPDATE,DELETE') then
      fouten := fouten || format(E'\n- %s heeft tabelrechten op start_pogingen', v_path);
    end if;
  end loop;
  select p.prosecdef, array_to_string(p.proconfig, ',') into v_def, v_path
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'login_private' and p.proname = 'tel_startpoging';
  if v_def is null then fouten := fouten || E'\n- functie tel_startpoging ontbreekt';
  else
    if not v_def then fouten := fouten || E'\n- tel_startpoging is geen SECURITY DEFINER'; end if;
    if coalesce(v_path,'') not like '%search_path=login_private, public, pg_temp%' then fouten := fouten || E'\n- tel_startpoging heeft geen gepind search_path'; end if;
  end if;
  if not has_function_privilege('login_gateway', 'login_private.tel_startpoging(text, integer, integer)', 'EXECUTE') then
    fouten := fouten || E'\n- login_gateway mag tel_startpoging niet uitvoeren';
  end if;
  for v_path in select r from unnest(array['anon','authenticated','service_role']) r loop
    if has_function_privilege(v_path, 'login_private.tel_startpoging(text, integer, integer)', 'EXECUTE') then
      fouten := fouten || format(E'\n- %s mag tel_startpoging uitvoeren', v_path);
    end if;
  end loop;
  if fouten <> '' then raise exception 'STARTLIMIET DEEL 1 FAALT:%', fouten; end if;
  raise notice 'OK DEEL 1: start_pogingen dicht, tel_startpoging DEFINER met gepind pad, alleen login_gateway.';
end $$;

\echo '== DEEL 2 — GEDRAG (startlimiet) =='
begin;
grant login_gateway to postgres;
do $$
declare
  k1 text := repeat('a', 64); k2 text := repeat('b', 64);
  r record; i int; v_reset timestamptz; v_venster timestamptz;
begin
  set local role login_gateway;
  for i in 1..20 loop
    select * into r from login_private.tel_startpoging(k1, 20, 600);
    assert r.toegestaan, format('poging %s moet toegestaan zijn', i);
    assert r.resterend = 20 - i, format('resterend na poging %s = %s', i, r.resterend);
  end loop;
  select * into r from login_private.tel_startpoging(k1, 20, 600);
  assert not r.toegestaan, '21e poging moet geweigerd worden';
  assert r.resterend = 0, 'resterend na weigering = 0';
  v_venster := to_timestamp(floor(extract(epoch from now()) / 600) * 600);
  assert r.reset_op = v_venster + interval '600 seconds', 'reset_op = vensterstart + venster';
  select * into r from login_private.tel_startpoging(k2, 20, 600);
  assert r.toegestaan and r.resterend = 19, 'andere sleutel telt apart';

  -- Fail-closed op ongeldige invoer.
  begin
    perform login_private.tel_startpoging('geen-hash', 20, 600);
    raise exception 'FAALT: ongeldige sleutel werd geaccepteerd';
  exception when check_violation then null;
  end;
  begin
    perform login_private.tel_startpoging(k1, 0, 600);
    raise exception 'FAALT: limiet 0 werd geaccepteerd';
  exception when check_violation then null;
  end;

  -- login_gateway kan de tabel niet lezen.
  begin
    perform count(*) from login_private.start_pogingen;
    raise exception 'FAALT: login_gateway kon start_pogingen lezen';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Opruiming: een oud venster verdwijnt bij de volgende telling.
  insert into login_private.start_pogingen (sleutel, venster_start, aantal) values (repeat('c', 64), now() - interval '1 day', 5);
  perform login_private.tel_startpoging(k2, 20, 600);
  assert (select count(*) from login_private.start_pogingen where sleutel = repeat('c', 64)) = 0, 'oud venster opgeruimd';
  raise notice 'OK DEEL 2: 20 toegestaan, 21e geweigerd, sleutels apart, fail-closed invoer, rolgrens, opruiming.';
end $$;
rollback;
