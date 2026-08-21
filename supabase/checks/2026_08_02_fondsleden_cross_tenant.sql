-- ============================================================================
-- vw_fondsleden — cross-tenant, kolom-, lees- en SCHRIJFrechtentoets.
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
--   Sinds C-01 (2026-08-20) ook de SCHRIJFkant. De suite toetste tot dan alleen
--   SELECT, terwijl `authenticated` in de feitelijke databasestand INSERT,
--   UPDATE en DELETE op de view had — geërfd van de Supabase-default-ACL, niet
--   uit een migratie. Via een definer-view zonder WITH CHECK OPTION, op een
--   tabel zonder FORCE RLS, is dat een volledige rol- en tenantescalatie:
--   V7 — INSERT via de view weigert (sqlstate 42501).
--   V8 — UPDATE van de rij van een FONDSGENOOT weigert (rol/fonds_id).
--   V9 — DELETE van de eigen rij weigert; de tabel blijft aantoonbaar intact.
--   V10 — Generiek: GEEN ENKELE view in public heeft I/U/D voor anon of
--         authenticated, met een expliciete (lege) allowlist. Dit vangt ook de
--         volgende view — de structurele gates A–H kennen alleen tabellen en
--         functies als objectklasse, en precies daarin viel C-01.
--   V11 — vw_dossier_status: alleen SELECT voor authenticated, niets voor anon.
--   V12 — vw_governance_audit blijft dicht voor beide browserrollen (migratie
--         A2), zodat inzage alleen via de loggende definer-RPC kan.
--
-- Self-seeding (2 fondsen + 3 users via de auth-trigger maak_profiel).
-- Alles in één transactie met ROLLBACK — laat niets achter.
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed als tabel-eigenaar (RLS omzeild). Vaste UUID's voor de test. ────────
--
-- De twee metadatakanalen zijn NIET uitwisselbaar en de seed moet ze allebei
-- vullen, precies zoals de applicatie dat doet:
--   • `raw_app_meta_data.fonds_id` — service-role-gebied. `maak_profiel()` leest
--     de tenantsleutel sinds migratie 2026_08_17_maak_profiel_app_metadata.sql
--     UITSLUITEND hier; ontbreekt hij, dan blijft het account bewust profiel-
--     loos en wordt er dus niets aangemaakt.
--   • `raw_user_meta_data.naam` — client-gebied (signUp). Alleen de WEERGAVENAAM
--     komt hiervandaan; zonder die sleutel valt `maak_profiel()` terug op het
--     e-mailadres.
--
-- Stond de naam per abuis in app-metadata, dan werden de profielen wél
-- aangemaakt maar heette iedereen naar zijn e-mailadres — en dat is exact de
-- toestand die V1 hoort af te vangen. Dat die situatie tot 2026-08-20 in de
-- repo stond zonder dat iemand het zag, is geen toeval: deze suite draaide in
-- geen enkele CI-job. Sinds C-01 draait hij mee in scripts/cross-tenant-ci.sh.
insert into public.fondsen (id, naam, slug) values
  ('11111111-1111-1111-1111-111111111111', 'VW Fonds A', 'vw-fonds-a'),
  ('22222222-2222-2222-2222-222222222222', 'VW Fonds B', 'vw-fonds-b');

insert into auth.users (id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','vw-a1@test.local',
   '{"fonds_id":"11111111-1111-1111-1111-111111111111"}', '{"naam":"Anna Aalders"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','vw-a2@test.local',
   '{"fonds_id":"11111111-1111-1111-1111-111111111111"}', '{"naam":"Bram Bakker"}', now(), now()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','vw-b1@test.local',
   '{"fonds_id":"22222222-2222-2222-2222-222222222222"}', '{"naam":"Carla Cohen"}', now(), now());

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

-- ── V7/V8/V9 — SCHRIJVEN via de view moet WEIGEREN (C-01) ───────────────────
-- Tot 2026-08-20 had `authenticated` INSERT/UPDATE/DELETE op deze view, geërfd
-- van de Supabase-default-ACL (`ALTER DEFAULT PRIVILEGES … ON TABLES TO
-- authenticated`) en niet uit enige migratie. Omdat de view definer-semantiek
-- heeft, dezelfde eigenaar als `profielen`, géén `WITH CHECK OPTION` kent en
-- `FORCE ROW LEVEL SECURITY` nergens aanstaat, liepen die schrijfacties BUITEN
-- de policies op `profielen` om — inclusief de kolommen `rol` en `fonds_id`.
-- Migratie 2026_08_20_c01_view_schrijfrechten.sql trekt ze in; deze drie
-- scenario's maken de suite rood zodra ze terugkeren.
--
-- Er wordt getoetst op SQLSTATE 42501 (insufficient_privilege), niet op "er ging
-- iets fout". Dat onderscheid is wezenlijk: een INSERT met een onbekend id
-- struikelt óók mét schrijfrechten over de foreign key naar auth.users, en een
-- test die elke fout goedkeurt zou dan vals-groen zijn.
set local role authenticated;
set local request.jwt.claim.sub to 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- V7 — INSERT: een vreemd profiel aanmaken, desnoods in een ander fonds.
do $$
declare
  gezien text := 'GEEN FOUT';
begin
  begin
    insert into public.vw_fondsleden (id, fonds_id, naam, rol)
    values ('dddddddd-dddd-dddd-dddd-dddddddddddd',
            '22222222-2222-2222-2222-222222222222',
            'Indringer', 'beheerder');
  exception when others then
    gezien := sqlstate;
  end;

  if gezien <> '42501' then
    raise exception
      'LEK: INSERT via vw_fondsleden gaf sqlstate % (verwacht 42501, permission '
      'denied). authenticated heeft schrijfrecht op de definer-view — dat is de '
      'RLS-bypass uit C-01.', gezien;
  end if;
end $$;

-- V8 — UPDATE: de rij van een FONDSGENOOT overnemen. Dit is het gevaarlijkste
-- pad: de bevriezingstrigger op `profielen` is BEFORE UPDATE en alleen actief
-- bij auth.uid() = old.id, en vuurt hier dus niet.
do $$
declare
  gezien text := 'GEEN FOUT';
begin
  begin
    update public.vw_fondsleden
       set rol = 'beheerder',
           fonds_id = '22222222-2222-2222-2222-222222222222'
     where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  exception when others then
    gezien := sqlstate;
  end;

  if gezien <> '42501' then
    raise exception
      'LEK: UPDATE van de rij van een fondsgenoot via vw_fondsleden gaf sqlstate '
      '% (verwacht 42501). Rol- en tenantescalatie staat open.', gezien;
  end if;
end $$;

-- V9 — DELETE: de eigen rij wissen (stap 1 van het delete-en-opnieuw-invoegen-pad).
do $$
declare
  gezien text := 'GEEN FOUT';
begin
  begin
    delete from public.vw_fondsleden
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  exception when others then
    gezien := sqlstate;
  end;

  if gezien <> '42501' then
    raise exception
      'LEK: DELETE via vw_fondsleden gaf sqlstate % (verwacht 42501).', gezien;
  end if;
end $$;

reset role;

-- Nawerking: de onderliggende tabel is aantoonbaar onaangeroerd gebleven.
do $$
declare
  n_rijen int;
  huidige_rol text;
  huidig_fonds uuid;
begin
  select count(*) into n_rijen from public.profielen;
  select rol, fonds_id into huidige_rol, huidig_fonds
    from public.profielen where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  if n_rijen <> 3 then
    raise exception 'LEK: profielen telt % rijen na de schrijfpogingen, verwacht 3.', n_rijen;
  end if;
  if huidige_rol <> 'voorzitter'
     or huidig_fonds <> '11111111-1111-1111-1111-111111111111' then
    raise exception
      'LEK: de rij van de fondsgenoot is gewijzigd naar rol=% / fonds=%.',
      huidige_rol, huidig_fonds;
  end if;
end $$;

-- ── V10 — GENERIEK: geen enkele view in public is schrijfbaar voor anon of
--          authenticated ───────────────────────────────────────────────────
-- De structurele gates A–H (2026_07_31_r1_structurele_gates.sql) redeneren over
-- TABELLEN en FUNCTIES als objectklasse, nooit over views. Precies in dat gat
-- viel C-01. Deze toets sluit de klasse: hij vangt niet alleen vw_fondsleden
-- maar ook de vólgende view die iemand aanmaakt en die de default-ACL van
-- Supabase automatisch schrijfbaar maakt.
--
-- De allowlist is bewust leeg en bewust expliciet. Hoort een view hier ooit in
-- te staan, dan is dat een besluit met een naam eronder — geen stilzwijgende
-- uitzondering.
do $$
declare
  overtreding text;
begin
  select string_agg(format('%s heeft %s op %s', r.rol, p.recht, c.relname), '; '
                    order by c.relname, r.rol, p.recht)
    into overtreding
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join lateral (values ('anon'), ('authenticated')) as r(rol)
   cross join lateral (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(recht)
   where c.relkind in ('v', 'm')                      -- views én materialized views
     and has_table_privilege(r.rol::name, c.oid, p.recht)
     and not exists (
       select 1
         from (values ('__geen_uitzonderingen__', '__geen_rol__')) as toegestaan(view_naam, rol)
        where toegestaan.view_naam = c.relname
          and toegestaan.rol = r.rol
     );

  if overtreding is not null then
    raise exception
      'LEK: schrijfrecht op view(s) voor een browserrol — %. '
      'Oorzaak is bijna altijd de Supabase-default-ACL op nieuwe objecten in '
      'public; zie migratie 2026_08_20_c01_view_schrijfrechten.sql.', overtreding;
  end if;
end $$;

-- ── V11 — vw_dossier_status: alleen SELECT voor authenticated, niets voor anon
-- Deze view heeft invoker-semantiek en is dus géén RLS-bypass, maar had dezelfde
-- grantdrift. De anon-SELECT is ingetrokken omdat geen publieke pagina de view
-- leest: alle drie de leespaden lopen achter een ingelogde sessie.
do $$
begin
  if has_table_privilege('anon', 'public.vw_dossier_status', 'select') then
    raise exception 'LEK: anon heeft SELECT op vw_dossier_status.';
  end if;
  if not has_table_privilege('authenticated', 'public.vw_dossier_status', 'select') then
    raise exception
      'V11 FAALT: authenticated heeft GEEN SELECT op vw_dossier_status — de '
      'dossieroverzichten en /api/dossiers breken hierop.';
  end if;
end $$;

-- ── V12 — vw_governance_audit blijft dicht voor beide browserrollen ─────────
-- Bewijs dat de opschoning uit migratie A2 (2026_08_04) intact is: het enige
-- leespad is de definer-RPC die de inzage vastlegt. Rechtstreekse SELECT zou de
-- belofte "elke inzage in andermans metadata wordt gelogd" breken.
do $$
begin
  if has_table_privilege('anon', 'public.vw_governance_audit', 'select')
     or has_table_privilege('authenticated', 'public.vw_governance_audit', 'select') then
    raise exception
      'LEK: vw_governance_audit is rechtstreeks leesbaar voor een browserrol — '
      'inzage zonder inzageregel en zonder motivering.';
  end if;
end $$;

rollback;

\echo 'vw_fondsleden cross-tenant-suite: alle scenario''s geslaagd (V1-V12).'
