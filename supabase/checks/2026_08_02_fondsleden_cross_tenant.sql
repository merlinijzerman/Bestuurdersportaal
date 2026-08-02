-- ============================================================================
-- vw_fondsleden — cross-tenant, kolom- en rechtentoets.
-- ----------------------------------------------------------------------------
-- Doel: onder ÉCHTE RLS bewijzen dat de view uit migratie 2026-08-02 doet wat
-- hij belooft. De view draait met DEFINER-semantiek en omzeilt daarmee bewust de
-- policy "profiel select eigen" op public.profielen. Die keuze is alleen
-- verdedigbaar zolang de scoping in de view zélf klopt — en dat is precies wat
-- hier wordt vastgelegd. Elke overtreding → raise exception → psql exit-code
-- <> 0 → CI faalt.
--
-- Getoetste scenario's:
--   V1 — Isolatie: een lid van fonds A ziet ALLE leden van A en GEEN lid van B.
--   V2 — Wederkerig: hetzelfde vanuit fonds B (geen asymmetrie in de scoping).
--   V3 — Kolomafscherming: de view exposeert uitsluitend id/fonds_id/naam/rol.
--        Het persoonlijke bestuurdersprofiel (besluit 0017) blijft buiten beeld.
--   V4 — Zonder sessie (auth.uid() null) levert de view NUL rijen.
--   V5 — anon heeft geen SELECT-recht op de view.
--   V6 — De onderliggende policy is ONgewijzigd: een lid van A kan via
--        public.profielen nog steeds alleen zijn eigen rij lezen.
--
-- Self-seeding (2 fondsen + 3 users via de auth-trigger maak_profiel).
-- Alles in één transactie met ROLLBACK — laat niets achter.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed als tabel-eigenaar (RLS omzeild). Vaste UUID's voor de test. ────────
insert into public.fondsen (id, naam) values
  ('11111111-1111-1111-1111-111111111111', 'VW Fonds A'),
  ('22222222-2222-2222-2222-222222222222', 'VW Fonds B');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','vw-a1@test.local',
   '{"naam":"Anna Aalders","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','vw-a2@test.local',
   '{"naam":"Bram Bakker","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','vw-b1@test.local',
   '{"naam":"Carla Cohen","fonds_id":"22222222-2222-2222-2222-222222222222"}', now(), now());

update public.profielen set rol = 'voorzitter' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

do $$
begin
  if (select count(*) from public.profielen
       where fonds_id = '11111111-1111-1111-1111-111111111111') <> 2 then
    raise exception 'SEED FAALT: fonds A heeft niet exact 2 profielen.';
  end if;
end $$;

-- ── V1/V2/V3 — als lid van fonds A ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

do $$
declare
  n_eigen  int;
  n_vreemd int;
begin
  select count(*) into n_eigen from public.vw_fondsleden
   where fonds_id = '11111111-1111-1111-1111-111111111111';
  select count(*) into n_vreemd from public.vw_fondsleden
   where fonds_id <> '11111111-1111-1111-1111-111111111111';

  if n_eigen <> 2 then
    raise exception 'V1 FAALT: lid van A ziet % eigen leden, verwacht 2.', n_eigen;
  end if;
  if n_vreemd <> 0 then
    raise exception 'V1 FAALT: lid van A ziet % rijen van een ander fonds.', n_vreemd;
  end if;

  -- De collega is zichtbaar mét naam en rol — dat is het doel van de view.
  if not exists (
    select 1 from public.vw_fondsleden
     where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
       and naam = 'Bram Bakker'
       and rol  = 'voorzitter'
  ) then
    raise exception 'V1 FAALT: naam/rol van de collega niet zichtbaar.';
  end if;
end $$;

-- V3 — kolomafscherming: precies vier kolommen, en geen profielvelden.
do $$
declare
  kolommen text;
begin
  select string_agg(column_name, ',' order by column_name)
    into kolommen
    from information_schema.columns
   where table_schema = 'public' and table_name = 'vw_fondsleden';

  if kolommen is distinct from 'fonds_id,id,naam,rol' then
    raise exception 'V3 FAALT: view exposeert kolommen [%], verwacht [fonds_id,id,naam,rol].', kolommen;
  end if;
end $$;

-- ── V2 — wederkerig, als lid van fonds B ────────────────────────────────────
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';

do $$
declare
  n_eigen  int;
  n_vreemd int;
begin
  select count(*) into n_eigen from public.vw_fondsleden
   where fonds_id = '22222222-2222-2222-2222-222222222222';
  select count(*) into n_vreemd from public.vw_fondsleden
   where fonds_id <> '22222222-2222-2222-2222-222222222222';

  if n_eigen <> 1 then
    raise exception 'V2 FAALT: lid van B ziet % eigen leden, verwacht 1.', n_eigen;
  end if;
  if n_vreemd <> 0 then
    raise exception 'V2 FAALT: lid van B ziet % rijen van een ander fonds.', n_vreemd;
  end if;
end $$;

-- ── V6 — de onderliggende policy is ONgewijzigd ─────────────────────────────
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

do $$
declare
  n int;
begin
  select count(*) into n from public.profielen;
  if n <> 1 then
    raise exception
      'V6 FAALT: lid van A leest % profielrijen direct, verwacht 1 (alleen de eigen rij). '
      'De view mag de policy op profielen niet hebben verruimd.', n;
  end if;
end $$;

-- ── V4 — zonder sessie: nul rijen ───────────────────────────────────────────
set local request.jwt.claims to '{}';

do $$
declare
  n int;
begin
  select count(*) into n from public.vw_fondsleden;
  if n <> 0 then
    raise exception 'V4 FAALT: zonder sessie levert de view % rijen, verwacht 0.', n;
  end if;
end $$;

reset role;

-- ── V5 — anon heeft geen SELECT-recht ───────────────────────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.vw_fondsleden', 'select') then
    raise exception 'V5 FAALT: anon heeft SELECT op vw_fondsleden.';
  end if;
  if not has_table_privilege('authenticated', 'public.vw_fondsleden', 'select') then
    raise exception 'V5 FAALT: authenticated heeft GEEN SELECT op vw_fondsleden.';
  end if;
end $$;

rollback;

\echo 'vw_fondsleden cross-tenant-suite: alle scenario''s geslaagd (V1-V6).'
