-- ============================================================================
-- T3 — Negatieve cross-tenant RLS-testsuite (controlekader, v0.4 §14 punt 7)
-- ----------------------------------------------------------------------------
-- Doel: bewijzen dat (a) geen enkele tenant-schrijf-policy de fonds_id/eigenaar
-- open laat en (b) een echt lek een test laat FALEN. Draai met psql; elke
-- overtreding doet `raise exception` → psql exit-code <> 0 → CI faalt.
--
-- Twee delen:
--   DEEL 1 — STRUCTUREEL (geen seed-data nodig, draait overal): mechanische
--     dekkingsgarantie. Faalt zodra een write-policy (ALL/INSERT/UPDATE) op een
--     tenant-tabel géén WITH CHECK heeft, of een audit-log de append-only-
--     trigger mist. Dit dekt ELKE tenant-tabel — ook toekomstige — zonder per
--     tabel een insert te hoeven schrijven. Verwijder één WITH CHECK en dit
--     deel faalt onmiddellijk.
--   DEEL 2 — GEDRAG (self-seeding, 2 synthetische fondsen): representatief
--     bewijs per isolatieklasse dat een cross-tenant schrijfpoging daadwerkelijk
--     door RLS wordt geweigerd, plus append-only-bewijs. Vereist het Supabase
--     auth-schema (auth.users + trigger maak_profiel). Alles in één transactie
--     met ROLLBACK — laat geen data achter.
--
-- Uitvoeren:  scripts/rls-cross-tenant-test.sh   (of: psql "$DB" -f dit-bestand)
-- ============================================================================

\set ON_ERROR_STOP on

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 1 — STRUCTURELE DEKKING (geen seed; harde CI-gate)                  ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- 1a. Elke schrijf-policy (ALL/INSERT/UPDATE) in public MOET een WITH CHECK
--     hebben, behalve de bewust globale referentietabellen (T3-register).
do $$
declare
  r record;
  offenders text := '';
  -- Bewust globaal/hybride, gedocumenteerd in
  -- 2026_07_08_t3_globale_tabellen_register.sql. Voor deze tabellen is een
  -- schrijf-policy zónder fonds-WITH CHECK een bewuste keuze (of niet van
  -- toepassing). Ze zijn uitgezonderd van de harde eis.
  global_allow text[] := array[
    'fondsen',                 -- lijst van fondsen (geen tenant-inhoud)
    'procedure_requirements'   -- globale template; write = beheerder-only (heeft nu wél WITH CHECK)
  ];
begin
  for r in
    select p.tablename, p.policyname, p.cmd
      from pg_policies p
     where p.schemaname = 'public'
       and p.cmd in ('ALL','INSERT','UPDATE')
       and p.with_check is null
       and not (p.tablename = any(global_allow))
     order by p.tablename, p.policyname
  loop
    offenders := offenders || format('  - %s.%s (%s)%s', r.tablename, r.policyname, r.cmd, chr(10));
  end loop;

  if offenders <> '' then
    raise exception E'T3-DEKKING FAALT: schrijf-policies zonder WITH CHECK (cross-tenant injectie mogelijk):\n%', offenders;
  end if;
  raise notice 'DEEL 1a OK: alle tenant-schrijf-policies hebben WITH CHECK.';
end $$;

-- 1b. De vier audit-logtabellen MOETEN de append-only-triggers dragen.
do $$
declare
  t text;
  logtabellen text[] := array['governance_log','risico_log','procedure_log','agendapunt_log',
                              'aqlab_log'];  -- AQLab append-only auditspoor (AQL-1)
  ontbreekt text := '';
begin
  foreach t in array logtabellen loop
    if not exists (
      select 1 from information_schema.triggers
       where event_object_schema='public' and event_object_table=t
         and trigger_name = 'trg_'||t||'_no_update') then
      ontbreekt := ontbreekt || '  - '||t||' (no_update)'||chr(10);
    end if;
    if not exists (
      select 1 from information_schema.triggers
       where event_object_schema='public' and event_object_table=t
         and trigger_name = 'trg_'||t||'_no_delete') then
      ontbreekt := ontbreekt || '  - '||t||' (no_delete)'||chr(10);
    end if;
  end loop;

  if ontbreekt <> '' then
    raise exception E'T3-APPEND-ONLY FAALT: ontbrekende immutability-triggers:\n%', ontbreekt;
  end if;
  raise notice 'DEEL 1b OK: alle audit-logtabellen zijn append-only afgedwongen.';
end $$;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 2 — GEDRAG: cross-tenant schrijfpogingen worden geweigerd           ║
-- ║ Self-seeding (2 fondsen + 2 users via auth-trigger). begin ... rollback. ║
-- ╚════════════════════════════════════════════════════════════════════════╝

begin;

-- Seed als tabel-eigenaar (RLS omzeild). Vaste UUID's voor de test.
--   Fonds A = 11111111-...  user A = aaaa...
--   Fonds B = 22222222-...  user B = bbbb...
insert into public.fondsen (id, naam, slug)
values ('11111111-1111-1111-1111-111111111111', 'T3 Testfonds A', 't3-testfonds-a'),
       ('22222222-2222-2222-2222-222222222222', 'T3 Testfonds B', 't3-testfonds-b');

-- auth.users-insert vuurt trigger maak_profiel() → maakt profielen-rij met het
-- fonds uit raw_user_meta_data.fonds_id (migratie 2026_07_08). Zo ontstaan de
-- tenant-profielen zonder ze handmatig te seeden.
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t3-a@test.local',
   '{"naam":"Test A","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','t3-b@test.local',
   '{"naam":"Test B","fonds_id":"22222222-2222-2222-2222-222222222222"}', now(), now());

-- Controle: beide profielen bestaan en zitten in het juiste fonds.
do $$
begin
  if (select fonds_id from public.profielen where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
       is distinct from '11111111-1111-1111-1111-111111111111'::uuid
     or (select fonds_id from public.profielen where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
       is distinct from '22222222-2222-2222-2222-222222222222'::uuid then
    raise exception 'SEED FAALT: profielen niet aan het juiste fonds gekoppeld (trigger maak_profiel).';
  end if;
end $$;

-- Seed een vergadering + agendapunt van FONDS B (om cross-tenant child-insert te toetsen).
insert into public.vergaderingen (id, fonds_id, titel, datum)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd','22222222-2222-2222-2222-222222222222','B-vergadering', now());

-- ── Impersoneer user A (fonds A) ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub to 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- POSITIEVE controle: A mag in EIGEN fonds schrijven (policy niet over-restrictief).
--
-- Sinds plateau A (2026-08-04) draagt governance_log geen `vraag` meer — die
-- staat in governance_log_inhoud — en eist de insert-policy naast het fonds ook
-- de auteur (`gebruiker_id = auth.uid()`). De strekking van deze controle is
-- ongewijzigd: schrijven in het EIGEN fonds moet blijven werken.
do $$
begin
  insert into public.governance_log (fonds_id, gebruiker_id)
  values ('11111111-1111-1111-1111-111111111111',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
exception when others then
  raise exception 'REGRESSIE: eigen-fonds insert in governance_log geweigerd (sqlstate %). Policy te streng.', sqlstate;
end $$;

-- NEGATIEF #1 (klasse A, LEIDEND): A mag GEEN governance_log-rij met fonds B injecteren.
do $$
begin
  insert into public.governance_log (fonds_id, gebruiker_id)
  values ('22222222-2222-2222-2222-222222222222',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  raise exception 'LEK: cross-tenant insert governance_log (fonds B) SLAAGDE — WITH CHECK ontbreekt/werkt niet.';
exception
  when insufficient_privilege then raise notice 'OK #1: governance_log cross-tenant insert geweigerd (RLS).';
  when others then
    if sqlstate = '42501' then raise notice 'OK #1: governance_log cross-tenant insert geweigerd (RLS).';
    else raise; end if;
end $$;

-- NEGATIEF #2 (klasse A): idem voor vergaderingen.
do $$
begin
  insert into public.vergaderingen (fonds_id, titel, datum)
  values ('22222222-2222-2222-2222-222222222222', 'LEK-poging', now());
  raise exception 'LEK: cross-tenant insert vergaderingen (fonds B) SLAAGDE.';
exception
  when insufficient_privilege then raise notice 'OK #2: vergaderingen cross-tenant insert geweigerd (RLS).';
  when others then if sqlstate='42501' then raise notice 'OK #2: vergaderingen cross-tenant insert geweigerd (RLS).'; else raise; end if;
end $$;

-- NEGATIEF #3 (klasse B, parent-subquery): A mag geen agendapunt hangen onder een B-vergadering.
do $$
begin
  insert into public.agendapunten (vergadering_id, titel)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'LEK-poging child');
  raise exception 'LEK: cross-tenant insert agendapunten onder B-vergadering SLAAGDE.';
exception
  when insufficient_privilege then raise notice 'OK #3: agendapunten cross-tenant child-insert geweigerd (RLS).';
  when others then if sqlstate='42501' then raise notice 'OK #3: agendapunten cross-tenant child-insert geweigerd (RLS).'; else raise; end if;
end $$;

-- NEGATIEF #4 (klasse C, eigenaar): A mag geen notificatie voor fonds B / andere ontvanger inschieten.
do $$
begin
  insert into public.notificaties (ontvanger_id, fonds_id, type)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','procedure_afgerond');
  raise exception 'LEK: cross-tenant insert notificaties (fonds B) SLAAGDE.';
exception
  when insufficient_privilege then raise notice 'OK #4: notificaties cross-tenant insert geweigerd (RLS).';
  when others then if sqlstate='42501' then raise notice 'OK #4: notificaties cross-tenant insert geweigerd (RLS).'; else raise; end if;
end $$;

-- NEGATIEF #5 (leesisolatie): A ziet de B-vergadering NIET.
do $$
declare n int;
begin
  select count(*) into n from public.vergaderingen where id='dddddddd-dddd-dddd-dddd-dddddddddddd';
  if n <> 0 then raise exception 'LEK: fonds A ziet vergadering van fonds B (leesisolatie kapot).'; end if;
  raise notice 'OK #5: B-vergadering onzichtbaar voor A (leesisolatie).';
end $$;

reset role;

-- NEGATIEF #6 (append-only): een bestaande auditregel is niet muteerbaar.
--   Seed als eigenaar een governance_log-rij in fonds A, probeer 'm te updaten.
--   Sinds plateau A muteren we `modus` in plaats van `antwoord`: die kolom is
--   naar governance_log_inhoud verhuisd. De trigger die wordt getoetst is
--   dezelfde (trg_governance_log_no_update, kolomonafhankelijk).
insert into public.governance_log (id, fonds_id, modus)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc','11111111-1111-1111-1111-111111111111','documenten');
do $$
begin
  update public.governance_log set modus='algemeen'
   where id='cccccccc-cccc-cccc-cccc-cccccccccccc';
  raise exception 'LEK: UPDATE op governance_log SLAAGDE — append-only-trigger ontbreekt/werkt niet.';
exception
  when others then
    -- de trigger raise't een generieke exception; elke fout hier = correct geblokkeerd,
    -- behalve als het toevallig onze eigen LEK-exception was.
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
    raise notice 'OK #6: UPDATE op governance_log geblokkeerd (append-only).';
end $$;

rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je zes "OK #"-notices + de DEEL 1-OK's
-- zag. Elke "LEK:"/"FAALT" doet raise exception → non-zero exit → CI faalt.
-- ============================================================================
