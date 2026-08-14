-- ============================================================================
-- AQLab — isolatie- en integriteitscheck onder échte RLS (werkticket AQL-1)
-- ----------------------------------------------------------------------------
-- Bewijst dat de aqlab_-tabellen (provider-globaal, synthetisch) veilig staan:
--   DEEL 1 — STRUCTUREEL (geen seed): RLS staat aan op elke aqlab_-tabel; de
--     append-only tabellen dragen de no_update/no_delete-triggers.
--   DEEL 2 — GEDRAG (self-seeding, begin ... rollback): synthetic=true wordt
--     afgedwongen; de release-beslisregel blokkeert een kritieke vrijgave; het
--     auditspoor is niet muteerbaar; en een tenant-anon/auth-sessie ziet GEEN
--     aqlab_-rijen (deny-by-default — toegang loopt via de service-role-wrapper).
--
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
--             (gebundeld in scripts/cross-tenant-ci.sh)
-- ============================================================================

\set ON_ERROR_STOP on

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 1 — STRUCTURELE DEKKING (geen seed)                                 ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- 1a. RLS staat aan op elke aqlab_-tabel.
do $$
declare
  t text;
  ontbreekt text := '';
begin
  for t in
    select relname from pg_class
     where relname like 'aqlab\_%' and relkind = 'r'
  loop
    if not (select relrowsecurity from pg_class where relname = t) then
      ontbreekt := ontbreekt || '  - ' || t || chr(10);
    end if;
  end loop;
  if ontbreekt <> '' then
    raise exception E'AQLAB-RLS FAALT: RLS niet aan op:\n%', ontbreekt;
  end if;
  raise notice 'DEEL 1a OK: RLS aan op alle aqlab_-tabellen.';
end $$;

-- 1b. De drie append-only tabellen dragen no_update/no_delete-triggers.
do $$
declare
  t text;
  logtabellen text[] := array['aqlab_log','aqlab_release_decisions','aqlab_audit_exports'];
  ontbreekt text := '';
begin
  foreach t in array logtabellen loop
    if not exists (select 1 from information_schema.triggers
       where event_object_schema='public' and event_object_table=t
         and trigger_name='trg_'||t||'_no_update') then
      ontbreekt := ontbreekt || '  - '||t||' (no_update)'||chr(10);
    end if;
    if not exists (select 1 from information_schema.triggers
       where event_object_schema='public' and event_object_table=t
         and trigger_name='trg_'||t||'_no_delete') then
      ontbreekt := ontbreekt || '  - '||t||' (no_delete)'||chr(10);
    end if;
  end loop;
  if ontbreekt <> '' then
    raise exception E'AQLAB-APPEND-ONLY FAALT: ontbrekende triggers:\n%', ontbreekt;
  end if;
  raise notice 'DEEL 1b OK: append-only afgedwongen op de drie aqlab_-tabellen.';
end $$;


-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ DEEL 2 — GEDRAG (self-seeding; begin ... rollback)                       ║
-- ╚════════════════════════════════════════════════════════════════════════╝

begin;

-- Tenant-fonds + user (via auth-trigger maak_profiel) om deny-by-default te toetsen.
insert into public.fondsen (id, naam, slug)
values ('33333333-3333-3333-3333-333333333333', 'AQLab Testfonds', 'aqlab-testfonds');
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('33333333-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','aqlab-x@test.local',
        '{"naam":"AQLab X","fonds_id":"33333333-3333-3333-3333-333333333333"}', now(), now());

-- Seed als tabel-eigenaar (RLS omzeild): één synthetische fixture + één log-regel.
insert into public.aqlab_fixture_documents (id, code, titel, synthetic)
values ('aaaa1111-0000-0000-0000-000000000001','HOR-CHECK-SYNTH-001','check synthetic', true);
insert into public.aqlab_log (id, actie) values ('aaaa2222-0000-0000-0000-000000000001','check_seed');

-- NEGATIEF #1 (synthetic-CHECK): niet-synthetische fixture mag NIET.
do $$
begin
  insert into public.aqlab_fixture_documents (code, titel, synthetic)
  values ('HOR-ECHT-001','poging echte data', false);
  raise exception 'LEK: niet-synthetische fixture SLAAGDE — CHECK (synthetic=true) ontbreekt/werkt niet.';
exception
  when check_violation then raise notice 'OK #1: niet-synthetische fixture geweigerd (CHECK).';
end $$;

-- NEGATIEF #2 (beslisregel): kritieke bevinding + vrijgegeven/accepteren mag NIET.
do $$
begin
  insert into public.aqlab_release_decisions (kritieke_bevindingen_count, besluit, release_advies)
  values (1, 'vrijgegeven', 'accepteren');
  raise exception 'LEK: vrijgave met kritieke bevinding SLAAGDE — beslisregel-CHECK ontbreekt/werkt niet.';
exception
  when check_violation then raise notice 'OK #2: vrijgave met kritieke bevinding geblokkeerd (CHECK).';
end $$;

-- NEGATIEF #3 (volledigheid): release_status=vrijgegeven zonder besluit/door/op mag NIET.
do $$
begin
  insert into public.aqlab_release_decisions (release_status)
  values ('vrijgegeven');
  raise exception 'LEK: vrijgegeven zonder besluit_door/_op SLAAGDE — volledigheid-CHECK ontbreekt.';
exception
  when check_violation then raise notice 'OK #3: onvolledige vrijgave geblokkeerd (CHECK).';
end $$;

-- NEGATIEF #4 (append-only): een bestaande aqlab_log-regel is niet muteerbaar.
do $$
begin
  update public.aqlab_log set actie='gemanipuleerd'
   where id='aaaa2222-0000-0000-0000-000000000001';
  raise exception 'LEK: UPDATE op aqlab_log SLAAGDE — append-only-trigger ontbreekt/werkt niet.';
exception
  when others then
    if sqlstate='P0001' and sqlerrm like 'LEK:%' then raise; end if;
    raise notice 'OK #4: UPDATE op aqlab_log geblokkeerd (append-only).';
end $$;

-- ── Impersoneer een tenant-user (fonds 3) ───────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-cccc-cccc-cccc-cccccccccccc"}';

-- NEGATIEF #5 (deny-by-default lees): tenant-sessie ziet GEEN aqlab_-rijen.
do $$
declare n int;
begin
  select count(*) into n from public.aqlab_fixture_documents;
  if n <> 0 then
    raise exception 'LEK: tenant-sessie ziet % aqlab_fixture_documents-rij(en) — deny-by-default kapot.', n;
  end if;
  raise notice 'OK #5: tenant-sessie ziet 0 aqlab_fixture_documents (deny-by-default).';
end $$;

-- NEGATIEF #6 (deny-by-default schrijf): tenant-sessie mag GEEN aqlab_-rij schrijven.
do $$
begin
  insert into public.aqlab_log (actie) values ('tenant-poging');
  raise exception 'LEK: tenant-insert in aqlab_log SLAAGDE — deny-by-default kapot.';
exception
  when insufficient_privilege then raise notice 'OK #6: tenant-insert aqlab_log geweigerd (RLS).';
  when others then if sqlstate='42501' then raise notice 'OK #6: tenant-insert aqlab_log geweigerd (RLS).'; else raise; end if;
end $$;

reset role;

rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de DEEL 1-OK's + zes "OK #"-notices
-- zag. Elke "LEK:"/"FAALT" doet raise exception → non-zero exit → CI faalt.
-- ============================================================================
