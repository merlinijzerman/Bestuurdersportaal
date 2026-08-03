-- ============================================================================
--  Check 2026-08-04 (plateau A) — ROL- en CAPABILITYGRENZEN op het auditspoor
-- ----------------------------------------------------------------------------
--  WAAROM DEZE SUITE APART BESTAAT. De bestaande cross-tenant-suite
--  (2026_07_08_t3_cross_tenant.sql) toetst TENANTgrenzen: fonds A tegen fonds B.
--  Plateau A introduceert iets anders — grenzen BINNEN één fonds: de auteur van
--  een auditregel tegenover een collega, en een collega tegenover een auditor
--  met capability. Geen enkele bestaande test raakt die as. Zonder deze suite is
--  de afscherming een aanname en geen aantoonbaarheid.
--
--  Dekt acceptatiecriteria AC-2 t/m AC-10 uit het technisch ontwerp, plus de
--  structurele checks 2, 3 en 4 uit §10.
--
--  Patroon gelijk aan 2026_07_08_t3_cross_tenant.sql:
--    • Deel 1 structureel, zonder seed.
--    • Deel 2 in één transactie met `rollback` aan het eind — er blijft niets
--      achter, ook niet bij een fout.
--    • Een verboden statement dat SLAAGT raise't 'LEK: …'; de exception-handler
--      laat die eigen melding door (`if sqlstate='P0001' and sqlerrm like 'LEK:%'
--      then raise; end if;`) in plaats van hem te slikken.
--
--  Uitvoeren — twee wegen:
--    • psql "$TEST_DATABASE_URL" -f supabase/checks/2026_08_04_a_rollen_capabilities.sql
--    • of plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--
--  Bewust GEEN `\set ON_ERROR_STOP on` en geen `\echo`: dat zijn psql-meta-
--  commando's die de SQL-editor niet kent, en de editor is hier de praktische
--  route (er is geen lokale psql). Zelfde keuze als in
--  2026_07_31_r1_structurele_gates.sql. Het kost niets aan strengheid: elke
--  controle is een `do $$`-blok dat een exception raise't, en zowel psql als de
--  SQL-editor breken de batch daarop af.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
--  DEEL 1 — STRUCTUREEL (geen seed nodig)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. De inhoudstabel is en blijft VERWIJDERBAAR ──────────────────────────
-- De belangrijkste structurele check van dit hele plateau. Wie
-- governance_log_inhoud "voor de consistentie" aan fn_log_append_only() hangt,
-- breekt precies datgene wat de tabel moest oplossen: dan kan een gebruiker zijn
-- gesprek weer niet verwijderen. Dit faalt luid.
do $$
declare n int;
begin
  select count(*) into n from pg_trigger
   where tgrelid = 'public.governance_log_inhoud'::regclass and not tgisinternal;
  if n <> 0 then
    raise exception
      'REGRESSIE: governance_log_inhoud heeft % trigger(s). Deze tabel MOET '
      'verwijderbaar zijn — een append-only trigger breekt het ontwerp van '
      'plateau A. Zie de migratiecommentaren in '
      '2026_08_04_a1_governance_log_inhoud.sql.', n;
  end if;
  raise notice 'OK 1: governance_log_inhoud is verwijderbaar (geen append-only trigger).';
end $$;

-- ── 2. De audittabellen zijn WEL append-only ──────────────────────────────
do $$
declare t text; n int; fouten text := '';
begin
  foreach t in array array['governance_log','governance_redacties','governance_audit_inzage']
  loop
    select count(*) into n from pg_trigger
     where tgrelid = ('public.'||t)::regclass and not tgisinternal;
    if n < 2 then
      fouten := fouten || format('  - %s heeft %s trigger(s), verwacht 2 (update+delete)%s', t, n, chr(10));
    end if;
  end loop;
  if fouten <> '' then
    raise exception E'REGRESSIE: append-only niet compleet:\n%', fouten;
  end if;
  raise notice 'OK 2: governance_log, _redacties en _audit_inzage zijn append-only.';
end $$;

-- ── 3. Geen foreign key van het spoor naar het gesprek ────────────────────
-- Bewust: ON DELETE SET NULL wordt door PostgreSQL als UPDATE uitgevoerd en
-- botst met fn_log_append_only(); ON DELETE CASCADE zou het spoor wissen.
do $$
declare n int;
begin
  select count(*) into n from pg_constraint
   where conrelid = 'public.governance_log'::regclass
     and contype = 'f'
     and confrelid = 'public.gesprekken'::regclass;
  if n <> 0 then
    raise exception
      'REGRESSIE: er is een foreign key van governance_log naar gesprekken. '
      'gesprek_audit_id is bewust een kale correlatiekolom — een FK maakt het '
      'auditspoor afhankelijk van verwijderbare data.';
  end if;
  raise notice 'OK 3: gesprek_audit_id draagt geen foreign key.';
end $$;

-- ── 4. Definer-functies: vaste search_path, geen anon EXECUTE ─────────────
do $$
declare r record; fouten text := '';
begin
  for r in
    select p.oid, p.proname, p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('mag_audit','mag_audit_bronnen','mag_audit_redacties',
                         'meta_projectie','meta_basisniveau','meta_bronniveau',
                         'lees_governance_audit','schrijf_ai_interactie',
                         'verwijder_gesprek')
  loop
    if not exists (select 1 from unnest(coalesce(r.proconfig,'{}'::text[])) c
                    where c like 'search_path=%') then
      fouten := fouten || format('  - %s mist een vaste search_path (search-path-hijack)%s',
                                 r.proname, chr(10));
    end if;
    -- Bevinding H-18: `revoke ... from public` is niet genoeg op Supabase; de
    -- default-ACL kent EXECUTE expliciet aan anon toe.
    if has_function_privilege('anon', r.oid, 'EXECUTE') then
      fouten := fouten || format('  - anon heeft EXECUTE op %s%s', r.proname, chr(10));
    end if;
  end loop;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='verwijder_gesprek') then
    fouten := fouten || '  - verwijder_gesprek() bestaat niet (migratie A2 niet gedraaid?)'||chr(10);
  end if;

  if fouten <> '' then
    raise exception E'REGRESSIE in de definer-objecten:\n%', fouten;
  end if;
  raise notice 'OK 4: alle nieuwe functies hebben search_path en geen anon-EXECUTE.';
end $$;

-- ── 5. Deny-by-default en het ontbreken van een DELETE-pad ────────────────
do $$
declare fouten text := '';
begin
  if (select count(*) from pg_policies
       where schemaname='public' and tablename='governance_audit_grants') <> 0 then
    fouten := fouten || '  - governance_audit_grants heeft een policy; moet deny-by-default'||chr(10);
  end if;
  if (select count(*) from pg_policies
       where schemaname='public' and tablename='gesprekken' and cmd in ('DELETE','ALL')) <> 0 then
    fouten := fouten || '  - gesprekken heeft een DELETE- of ALL-policy; verwijderen moet via de RPC'||chr(10);
  end if;
  if (select count(*) from pg_policies
       where schemaname='public' and tablename='governance_log_inhoud'
         and cmd in ('DELETE','ALL','INSERT','UPDATE')) <> 0 then
    fouten := fouten || '  - governance_log_inhoud heeft een schrijf-policy; alleen SELECT is toegestaan'||chr(10);
  end if;
  if (select count(*) from pg_policies
       where schemaname='public' and tablename='governance_log' and policyname='fonds log') <> 0 then
    fouten := fouten || '  - de fondsbrede policy "fonds log" bestaat nog'||chr(10);
  end if;
  if fouten <> '' then
    raise exception E'REGRESSIE in de policy-opzet:\n%', fouten;
  end if;
  raise notice 'OK 5: deny-by-default intact; geen direct DELETE-pad.';
end $$;

-- ── 6. AC-2 — geen chatinhoud meer in het auditspoor ──────────────────────
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='governance_log'
     and column_name in ('vraag','antwoord','bronnen');
  if n <> 0 then
    raise exception
      'AC-2 NIET GEHAALD: governance_log heeft nog % kolom(men) met chatinhoud. '
      'Draai de contract-migratie 2026_08_04_a3_governance_log_contract.sql — '
      'maar pas nadat code v1 aantoonbaar naar governance_log_inhoud schrijft en '
      'er een geverifieerde kopie is.', n;
  end if;
  raise notice 'OK 6 (AC-2): governance_log draagt geen vraag/antwoord/bronnen meer.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  DEEL 2 — GEDRAG (seed als eigenaar, impersonatie, rollback)
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- Fonds A = 11111111  ·  Fonds B = 22222222
--   user A (aaaa…) — auteur, fonds A
--   user C (cccc…) — collega zonder capability, fonds A   → AC-3, AC-4
--   user D (dddd…) — auditor met governance_audit_read, fonds A → AC-5
--   user E (eeee…) — auditor met read + read_sources, fonds A   → AC-5, AC-6
--   user B (bbbb…) — ander fonds                                → tenantgrens
insert into public.fondsen (id, naam)
values ('11111111-1111-1111-1111-111111111111', 'A-check Fonds A'),
       ('22222222-2222-2222-2222-222222222222', 'A-check Fonds B');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','a-auteur@test.local',
   '{"naam":"Auteur A","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','c-collega@test.local',
   '{"naam":"Collega C","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','authenticated','authenticated','d-auditor@test.local',
   '{"naam":"Auditor D","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','authenticated','authenticated','e-auditor@test.local',
   '{"naam":"Auditor E","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','b-ander@test.local',
   '{"naam":"Ander B","fonds_id":"22222222-2222-2222-2222-222222222222"}', now(), now());

do $$
begin
  if (select count(*) from public.profielen
       where id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc',
                    'dddddddd-dddd-dddd-dddd-dddddddddddd','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
         and fonds_id = '11111111-1111-1111-1111-111111111111') <> 4 then
    raise exception 'SEED FAALT: niet alle vier de fonds-A-profielen zijn aangemaakt (trigger maak_profiel).';
  end if;
end $$;

-- Capabilities (deny-by-default: alleen wie hier staat, mag iets).
insert into public.governance_audit_grants (gebruiker_id, fonds_id, capability, motivering)
values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','11111111-1111-1111-1111-111111111111',
   'governance_audit_read', 'checksuite'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','11111111-1111-1111-1111-111111111111',
   'governance_audit_read', 'checksuite'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','11111111-1111-1111-1111-111111111111',
   'governance_audit_read_sources', 'checksuite');

-- Een gesprek van A, met twee auditregels eraan gekoppeld.
insert into public.gesprekken (id, gebruiker_id, fonds_id, titel, berichten)
values ('a0000000-0000-0000-0000-00000000000a',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
        'Gesprek van A', '[]'::jsonb);

-- retrieval_meta met alle drie de niveaus door elkaar, zoals een echte rij.
insert into public.governance_log
  (id, gebruiker_id, gebruiker_naam, fonds_id, modus, model,
   gesprek_audit_id, inhoud_hmac, retrieval_meta)
values
  ('10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Auteur A',
   '11111111-1111-1111-1111-111111111111','documenten','claude-sonnet-4-5',
   'a0000000-0000-0000-0000-00000000000a','zegel-1',
   jsonb_build_object(
     'methode','hybride_rrf', 'geselecteerd', 3, 'duur_model_ms', 4200,
     'chunks', jsonb_build_array(jsonb_build_object('id','c1','document_id','d1','rang',1)),
     'zoekvraag','GEHEIME VRAAG UIT EEN OUDE RIJ',
     'scope', jsonb_build_object('document_ids', jsonb_build_array('d1'),
                                 'titels', jsonb_build_array('GEHEIME TITEL')),
     'invoer', jsonb_build_object('beurten',2,'tekens',120,'historie_hash','HASHGEHEIM')
   )),
  ('10000000-0000-0000-0000-000000000002',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Auteur A',
   '11111111-1111-1111-1111-111111111111','documenten','claude-sonnet-4-5',
   'a0000000-0000-0000-0000-00000000000a','zegel-2',
   '{"methode":"geen","geselecteerd":0}'::jsonb);

insert into public.governance_log_inhoud (log_id, vraag, antwoord, bronnen, retrieval_meta_inhoud)
values
  ('10000000-0000-0000-0000-000000000001','Vraag van A','Antwoord aan A','[]'::jsonb,'{}'::jsonb),
  ('10000000-0000-0000-0000-000000000002','Tweede vraag van A',null,'[]'::jsonb,'{}'::jsonb);

-- ── AC-3 — een collega in HETZELFDE fonds ziet niets van A ────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';

do $$
declare n int;
begin
  select count(*) into n from public.governance_log_inhoud;
  if n <> 0 then
    raise exception 'LEK (AC-3): collega C ziet % rij(en) chatinhoud van A.', n;
  end if;

  select count(*) into n from public.governance_log
   where gebruiker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n <> 0 then
    raise exception 'LEK (AC-3): collega C ziet % auditregel(s) van A zonder capability.', n;
  end if;
  raise notice 'OK AC-3: collega zonder capability ziet noch inhoud noch andermans auditregels.';
end $$;

-- ── AC-4 — dezelfde collega ziet in de auditweergave alleen eigen regels ──
do $$
declare n int;
begin
  select count(*) into n
    from public.lees_governance_audit('11111111-1111-1111-1111-111111111111');
  if n <> 0 then
    raise exception 'LEK (AC-4): beheerder zonder auditcapability ziet % regel(s).', n;
  end if;
  raise notice 'OK AC-4: zonder capability toont de auditweergave uitsluitend eigen regels.';
end $$;

-- ── De auditview is GEEN directe leessurface ─────────────────────────────
-- Zonder deze grens kan een houder van …_read_sources het spoor van collega's
-- lezen zonder inzageregel en zonder motivering; de RPC is het enige pad.
do $$
declare n int;
begin
  select count(*) into n from public.vw_governance_audit;
  raise exception
    'LEK: vw_governance_audit is rechtstreeks leesbaar (% rij(en)) — inzage kan '
    'de logging in governance_audit_inzage omzeilen.', n;
exception
  when insufficient_privilege then
    raise notice 'OK: vw_governance_audit is niet rechtstreeks leesbaar (alleen via de RPC).';
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
    raise notice 'OK: directe toegang tot vw_governance_audit geweigerd (sqlstate %).', sqlstate;
end $$;

-- ── AC-7 — geen direct verwijderpad ──────────────────────────────────────
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

do $$
declare n int;
begin
  -- gesprekken: er is geen DELETE-policy, dus RLS filtert alles weg → 0 rijen.
  delete from public.gesprekken where id = 'a0000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'LEK (AC-7): directe DELETE op gesprekken verwijderde % rij(en).', n;
  end if;

  delete from public.governance_log_inhoud where log_id = '10000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'LEK (AC-7): directe DELETE op governance_log_inhoud verwijderde % rij(en).', n;
  end if;
  raise notice 'OK AC-7: directe DELETE via de anon-key raakt niets.';
exception
  when insufficient_privilege then
    raise notice 'OK AC-7: directe DELETE geweigerd (privilege).';
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
    raise notice 'OK AC-7: directe DELETE geweigerd (sqlstate %).', sqlstate;
end $$;

-- ── Eigenaarschap: A mag niet het gesprek van een ander verwijderen ───────
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';
do $$
begin
  perform public.verwijder_gesprek('a0000000-0000-0000-0000-00000000000a',
                                   'f0000000-0000-0000-0000-0000000000ff');
  raise exception 'LEK: C kon het gesprek van A verwijderen.';
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
    raise notice 'OK: verwijderen van andermans gesprek geweigerd (sqlstate %).', sqlstate;
end $$;

-- ── AC-5 — auditor MET read, ZONDER read_sources ─────────────────────────
set local request.jwt.claims to '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd"}';
do $$
declare v_meta jsonb; n int; v_json text;
begin
  select count(*) into n
    from public.lees_governance_audit('11111111-1111-1111-1111-111111111111');
  if n < 2 then
    raise exception 'REGRESSIE (AC-5): auditor D ziet % regel(s), verwacht >= 2. Capability werkt niet.', n;
  end if;

  select r.retrieval_meta into v_meta
    from public.lees_governance_audit('11111111-1111-1111-1111-111111111111') r
   where r.id = '10000000-0000-0000-0000-000000000001';
  v_json := v_meta::text;

  -- Basisniveau: geen bron-ID's, geen objectreferenties, geen inhoud.
  if v_meta ? 'chunks' then
    raise exception 'LEK (AC-5): auditor zonder read_sources ziet chunk-ID''s.';
  end if;
  if (v_meta->'scope') ? 'document_ids' then
    raise exception 'LEK (AC-5): auditor zonder read_sources ziet scope.document_ids.';
  end if;
  if v_json like '%GEHEIME VRAAG%' then
    raise exception 'LEK (AC-5): de zoekvraag uit een oude rij lekt via retrieval_meta.';
  end if;
  if v_json like '%GEHEIME TITEL%' then
    raise exception 'LEK (AC-5): documenttitels lekken via retrieval_meta.';
  end if;
  if v_json like '%HASHGEHEIM%' then
    raise exception 'LEK (AC-5): invoer.historie_hash lekt via retrieval_meta.';
  end if;

  -- Telemetrie moet wél zichtbaar blijven, anders is de weergave waardeloos.
  if (v_meta->>'duur_model_ms') is distinct from '4200' then
    raise exception 'REGRESSIE (AC-5): basisniveau verloor de operationele telemetrie.';
  end if;

  -- De inhoud zelf blijft ook voor een auditor onbereikbaar.
  select count(*) into n from public.governance_log_inhoud;
  if n <> 0 then
    raise exception 'LEK (AC-5): auditor D ziet % rij(en) chatinhoud.', n;
  end if;

  raise notice 'OK AC-5: basisniveau toont telemetrie, geen bron-ID''s en geen inhoud.';
end $$;

-- ── AC-6 — inzagelogging en de motiveringsplicht ─────────────────────────
do $$
declare n_voor int; n_na int;
begin
  select count(*) into n_voor from public.governance_audit_inzage;
  perform public.lees_governance_audit('11111111-1111-1111-1111-111111111111',
                                       '{"periode":"2026-08"}'::jsonb, null, 50);
  select count(*) into n_na from public.governance_audit_inzage;
  if n_na <> n_voor + 1 then
    raise exception 'REGRESSIE (AC-6): inzage door auditor D leverde geen inzageregel op.';
  end if;
  raise notice 'OK AC-6a: elke inzage in andermans metadata schrijft een inzageregel.';
end $$;

-- Eigen regels opvragen is géén inzage in die van een ander → geen inzageregel.
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';
do $$
declare n_voor int; n_na int;
begin
  select count(*) into n_voor from public.governance_audit_inzage;
  perform public.lees_governance_audit('11111111-1111-1111-1111-111111111111');
  select count(*) into n_na from public.governance_audit_inzage;
  if n_na <> n_voor then
    raise exception 'REGRESSIE (AC-6): eigen regels inzien schreef ten onrechte een inzageregel.';
  end if;
  raise notice 'OK AC-6b: eigen spoor inzien logt geen inzage.';
end $$;

-- Bronniveau zonder motivering wordt geweigerd.
set local request.jwt.claims to '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}';
do $$
begin
  perform public.lees_governance_audit('11111111-1111-1111-1111-111111111111',
                                       '{}'::jsonb, null, 50, true);
  raise exception 'LEK (AC-6): bronniveau-inzage zonder motivering werd toegestaan.';
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
    raise notice 'OK AC-6c: bronniveau zonder motivering geweigerd (sqlstate %).', sqlstate;
end $$;

-- Een lege of blanco motivering telt niet als motivering.
do $$
begin
  perform public.lees_governance_audit('11111111-1111-1111-1111-111111111111',
                                       '{}'::jsonb, '   ', 50, true);
  raise exception 'LEK (AC-6): een blanco motivering werd geaccepteerd.';
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
    raise notice 'OK AC-6c2: blanco motivering geweigerd (sqlstate %).', sqlstate;
end $$;

-- Zónder een bronniveau-VERZOEK krijgt ook een houder van …_read_sources het
-- basisniveau. Bronniveau is een bewuste handeling, geen automatisch gevolg van
-- de capability — anders zou de motiveringsplicht een formaliteit zijn.
do $$
declare v_meta jsonb;
begin
  select r.retrieval_meta into v_meta
    from public.lees_governance_audit('11111111-1111-1111-1111-111111111111') r
   where r.id = '10000000-0000-0000-0000-000000000001';
  if v_meta ? 'chunks' then
    raise exception
      'LEK (AC-6): bronniveau werd toegekend zonder expliciet verzoek en zonder motivering.';
  end if;
  raise notice 'OK AC-6d: bronniveau vereist een expliciet verzoek.';
end $$;

-- Mét verzoek én motivering ziet E de bron-ID's wél — maar nog steeds geen inhoud.
do $$
declare v_meta jsonb; v_json text; n_voor int; n_na int; v_gelogd boolean;
begin
  select count(*) into n_voor from public.governance_audit_inzage;

  select r.retrieval_meta into v_meta
    from public.lees_governance_audit('11111111-1111-1111-1111-111111111111',
                                      '{}'::jsonb, 'jaarcontrole 2026', 50, true) r
   where r.id = '10000000-0000-0000-0000-000000000001';
  v_json := v_meta::text;

  if not (v_meta ? 'chunks') then
    raise exception 'REGRESSIE (AC-5): auditor MET read_sources ziet de chunk-ID''s niet.';
  end if;
  if v_json like '%GEHEIME VRAAG%' or v_json like '%GEHEIME TITEL%' or v_json like '%HASHGEHEIM%' then
    raise exception 'LEK: inhoud lekt zelfs op bronniveau via retrieval_meta.';
  end if;

  -- De inzageregel legt vast dat het om bronniveau ging, mét de motivering.
  select count(*) into n_na from public.governance_audit_inzage;
  if n_na <= n_voor then
    raise exception 'REGRESSIE (AC-6): bronniveau-inzage schreef geen inzageregel.';
  end if;
  select i.bronniveau and i.motivering = 'jaarcontrole 2026' into v_gelogd
    from public.governance_audit_inzage i
   order by i.tijdstip desc limit 1;
  if not coalesce(v_gelogd, false) then
    raise exception 'REGRESSIE (AC-6): de inzageregel legt bronniveau/motivering niet vast.';
  end if;

  raise notice 'OK AC-5/6e: bronniveau toont bron-ID''s, nooit inhoud, en wordt gemotiveerd gelogd.';
end $$;

-- ── AC-8 / AC-10 — verwijderen: idempotent, spoor intact ─────────────────
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
do $$
declare
  v1 jsonb; v2 jsonb;
  n_spoor_voor int; n_spoor_na int;
  n_inhoud int; n_gesprek int; n_redactie int;
  v_correlatie uuid;
begin
  select count(*) into n_spoor_voor from public.governance_log
   where gesprek_audit_id = 'a0000000-0000-0000-0000-00000000000a';

  v1 := public.verwijder_gesprek('a0000000-0000-0000-0000-00000000000a',
                                 'f1000000-0000-0000-0000-00000000000f');
  -- Tweede aanroep met HETZELFDE request_id (netwerkretry / dubbelklik).
  v2 := public.verwijder_gesprek('a0000000-0000-0000-0000-00000000000a',
                                 'f1000000-0000-0000-0000-00000000000f');

  if (v1->>'aantal_regels')::int <> 2 then
    raise exception 'REGRESSIE: verwijderen ruimde % inhoudrijen op, verwacht 2.', v1->>'aantal_regels';
  end if;
  if (v2->>'aantal_regels')::int <> (v1->>'aantal_regels')::int then
    raise exception 'REGRESSIE (AC-8): tweede aanroep gaf een ander resultaat: % vs %.', v2, v1;
  end if;
  if (v2->>'status') <> 'reeds_uitgevoerd' then
    raise exception 'REGRESSIE (AC-8): tweede aanroep meldde status %, verwacht reeds_uitgevoerd.', v2->>'status';
  end if;

  select count(*) into n_redactie from public.governance_redacties
   where request_id = 'f1000000-0000-0000-0000-00000000000f';
  if n_redactie <> 1 then
    raise exception 'REGRESSIE (AC-8): % redactieregels voor één request_id, verwacht 1.', n_redactie;
  end if;

  -- AC-1: gesprek en inhoud zijn weg.
  select count(*) into n_gesprek from public.gesprekken
   where id = 'a0000000-0000-0000-0000-00000000000a';
  select count(*) into n_inhoud from public.governance_log_inhoud
   where log_id in ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
  if n_gesprek <> 0 or n_inhoud <> 0 then
    raise exception 'REGRESSIE (AC-1): gesprek (%) of inhoud (%) bestaat nog.', n_gesprek, n_inhoud;
  end if;

  -- AC-10: het SPOOR is ongemoeid en gesprek_audit_id is niet ge-update.
  select count(*) into n_spoor_na from public.governance_log
   where gesprek_audit_id = 'a0000000-0000-0000-0000-00000000000a';
  if n_spoor_na <> n_spoor_voor then
    raise exception
      'REGRESSIE (AC-10): het auditspoor veranderde van % naar % regels. '
      'gesprek_audit_id moet blijven staan; een UPDATE zou de append-only '
      'trigger raken.', n_spoor_voor, n_spoor_na;
  end if;

  select gl.gesprek_audit_id into v_correlatie from public.governance_log gl
   where gl.id = '10000000-0000-0000-0000-000000000001';
  if v_correlatie is distinct from 'a0000000-0000-0000-0000-00000000000a'::uuid then
    raise exception 'REGRESSIE (AC-10): gesprek_audit_id is gewijzigd naar %.', v_correlatie;
  end if;

  raise notice 'OK AC-1/8/10: verwijderen is idempotent, laat het spoor intact en logt één redactie.';
end $$;

-- ── Schrijfpad: fonds en gebruiker komen server-side ─────────────────────
do $$
declare v_id uuid; v_fonds uuid; v_naam text; v_meta jsonb;
begin
  v_id := public.schrijf_ai_interactie(
    p_vraag                 => 'Nieuwe vraag via de RPC',
    p_antwoord              => 'Nieuw antwoord',
    p_retrieval_meta        => '{"methode":"geen","geselecteerd":0}'::jsonb,
    p_retrieval_meta_inhoud => '{"zoekvraag":"Nieuwe vraag via de RPC"}'::jsonb,
    p_gesprek_audit_id      => 'a0000000-0000-0000-0000-00000000000b'
  );

  select gl.fonds_id, gl.gebruiker_naam, gl.retrieval_meta
    into v_fonds, v_naam, v_meta
    from public.governance_log gl where gl.id = v_id;

  if v_fonds is distinct from '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'REGRESSIE: fonds_id niet server-side afgeleid (kreeg %).', v_fonds;
  end if;
  if v_naam is distinct from 'Auteur A' then
    raise exception 'REGRESSIE: gebruiker_naam niet server-side afgeleid (kreeg %).', v_naam;
  end if;
  if v_meta ? 'zoekvraag' then
    raise exception 'LEK: de zoekvraag belandde in governance_log.retrieval_meta.';
  end if;
  if not exists (select 1 from public.governance_log_inhoud where log_id = v_id) then
    raise exception 'REGRESSIE: de inhoud is niet in governance_log_inhoud beland.';
  end if;
  raise notice 'OK: schrijf_ai_interactie leidt fonds en gebruiker server-side af en splitst de meta.';
end $$;

-- ── Tenantgrens blijft staan: B ziet niets van fonds A ───────────────────
set local request.jwt.claims to '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}';
do $$
declare n int;
begin
  select count(*) into n
    from public.lees_governance_audit('11111111-1111-1111-1111-111111111111');
  if n <> 0 then
    raise exception 'LEK: gebruiker uit fonds B ziet % auditregel(s) van fonds A.', n;
  end if;
  select count(*) into n from public.governance_log_inhoud;
  if n <> 0 then
    raise exception 'LEK: gebruiker uit fonds B ziet % inhoudrij(en) van fonds A.', n;
  end if;
  -- Ook niet met een capability voor een fonds waar hij niet in zit: die heeft hij niet.
  if public.mag_audit('11111111-1111-1111-1111-111111111111') then
    raise exception 'LEK: mag_audit() geeft true voor een fonds zonder grant.';
  end if;
  raise notice 'OK: tenantgrens ongewijzigd — fonds B ziet niets van fonds A.';
end $$;

reset role;

rollback;

-- ── Slot ────────────────────────────────────────────────────────────────────
-- Alles hierboven draaide binnen één transactie die zojuist is teruggerold: er
-- blijft geen testdata achter, ook niet bij een fout halverwege.
do $$
begin
  raise notice 'Plateau A rol-/capabilitysuite doorlopen. Elke OK-regel hierboven is een geslaagde controle; bij een fout was de batch afgebroken.';
end $$;
