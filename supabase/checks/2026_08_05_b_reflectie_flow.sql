-- ============================================================================
--  Check 2026-08-05 (plateau B) — DE REFLECTIEFLOW IS SERVER-CONTROLLED
-- ----------------------------------------------------------------------------
--  WAAROM DEZE SUITE BESTAAT. Vier gedragswijzigingen in de chatlaag (G1-G4)
--  hangen aan één vraag: "loopt er nu een reflectie?". Zou de client dat antwoord
--  kunnen geven, dan kan hij ook de bronset kiezen waarop de assistent zich
--  baseert, de beurtteller terugzetten of een reflectie afronden die nooit is
--  gevoerd. Besluit 0110 legt de autoriteit daarom bij de server; deze suite
--  bewijst dat.
--
--  Dekt acceptatiecriteria AC-18 (de vijf pogingen falen) en AC-24 (verwijderen
--  ruimt de flowstatus mee op), plus de structurele checks uit het technisch
--  ontwerp §10.
--
--  Patroon gelijk aan 2026_08_04_a_rollen_capabilities.sql:
--    • Deel 1 structureel, zonder seed.
--    • Deel 2 in één transactie met `rollback` aan het eind — er blijft niets
--      achter, ook niet bij een fout.
--    • Een verboden statement dat SLAAGT raise't 'LEK: …'; de exception-handler
--      laat die eigen melding door in plaats van hem te slikken.
--
--  Uitvoeren — twee wegen:
--    • psql "$TEST_DATABASE_URL" -f supabase/checks/2026_08_05_b_reflectie_flow.sql
--    • of plak dit bestand in Supabase Dashboard → SQL Editor → Run.
--
--  Bewust GEEN `\set ON_ERROR_STOP on` en geen `\echo`: dat zijn psql-meta-
--  commando's die de SQL-editor niet kent, en de editor is hier de praktische
--  route (er is geen lokale psql). Zelfde keuze als de A-suite.
--
--  VOORWAARDE: 2026_08_05_b1_reflectie_state.sql is gedraaid.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
--  DEEL 1 — STRUCTUREEL (geen seed nodig)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. De statustabel heeft UITSLUITEND een SELECT-policy ─────────────────
-- Dit is de dragende maatregel van AC-18. Komt er ooit een insert-, update- of
-- delete-policy bij, dan kan de browser met de anon-key rechtstreeks schrijven
-- en is de hele toestandsmachine decoratie.
-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw en afbraak, authenticated per scenario — de meting
--      gebeurt onder RLS, niet onder BYPASSRLS.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

do $$
declare fouten text := ''; r record; n int;
begin
  for r in select policyname, cmd from pg_policies
            where schemaname = 'public' and tablename = 'gesprek_reflectie_state'
  loop
    if r.cmd <> 'SELECT' then
      fouten := fouten || format('  - policy "%s" heeft cmd %s, verwacht alleen SELECT%s',
                                 r.policyname, r.cmd, chr(10));
    end if;
  end loop;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'gesprek_reflectie_state';
  if n = 0 then
    fouten := fouten || '  - er is GEEN policy; met RLS aan ziet niemand iets, '
                     || 'zonder RLS ziet iedereen alles'||chr(10);
  end if;

  if not exists (select 1 from pg_class
                  where oid = 'public.gesprek_reflectie_state'::regclass
                    and relrowsecurity) then
    fouten := fouten || '  - row level security staat UIT op de statustabel'||chr(10);
  end if;

  if fouten <> '' then
    raise exception E'STRUCTUUR 1 FAALT — de flowstatus is client-muteerbaar geworden:\n%', fouten;
  end if;
  raise notice 'OK 1: gesprek_reflectie_state heeft RLS aan en uitsluitend een SELECT-policy.';
end $$;

-- ── 2. De statustabel is NIET append-only ─────────────────────────────────
-- Spiegelbeeld van check 1 uit de A-suite. Een statusmachine die niet van status
-- kan wisselen is geen statusmachine; wie hier "voor de consistentie"
-- fn_log_append_only() aan hangt, breekt de hele flow.
do $$
declare n int;
begin
  select count(*) into n from pg_trigger
   where tgrelid = 'public.gesprek_reflectie_state'::regclass and not tgisinternal;
  if n <> 0 then
    raise exception
      'REGRESSIE: gesprek_reflectie_state heeft % trigger(s). Deze tabel moet '
      'muteerbaar zijn — de toestandsmachine wisselt van status. Het auditspoor '
      '(governance_log) blijft append-only; deze tabel is geen auditspoor.', n;
  end if;
  raise notice 'OK 2: gesprek_reflectie_state draagt geen append-only trigger.';
end $$;

-- ── 3. Cascade vanaf `gesprekken` (AC-24) ─────────────────────────────────
-- Dit is de HELE implementatie van "verwijderen ruimt de flowstatus mee op":
-- verwijder_gesprek() doet een DELETE op gesprekken en hoeft niet te weten dat
-- plateau B bestaat. Valt de cascade weg, dan blijft de status van een verwijderd
-- gesprek achter — een spoor van iemands twijfel dat de gebruiker niet meer kan
-- opruimen, precies wat besluit 0112 uitsluit.
do $$
declare v_type "char";
begin
  select confdeltype into v_type
    from pg_constraint
   where conrelid = 'public.gesprek_reflectie_state'::regclass
     and contype  = 'f'
     and confrelid = 'public.gesprekken'::regclass;

  if v_type is null then
    raise exception 'STRUCTUUR 3 FAALT: er is geen foreign key van '
                    'gesprek_reflectie_state naar gesprekken.';
  end if;
  if v_type <> 'c' then
    raise exception 'STRUCTUUR 3 FAALT: de FK naar gesprekken heeft ON DELETE-'
                    'gedrag "%", verwacht "c" (cascade). AC-24 is dan niet '
                    'geborgd.', v_type;
  end if;
  raise notice 'OK 3: cascade vanaf gesprekken bestaat (AC-24 structureel geborgd).';
end $$;

-- ── 4. De definer-functies zijn gehard ────────────────────────────────────
-- Gepinde search_path (gate E) én geen EXECUTE voor PUBLIC of anon (gate H).
-- `revoke ... from public` alléén is op Supabase niet genoeg: de default-ACL
-- kent EXECUTE expliciet aan anon toe. Dat is bevinding H-18, en dit is de test
-- die voorkomt dat hij terugkomt.
do $$
declare fouten text := ''; f text; cfg text[];
begin
  foreach f in array array[
    'public.reflectie_transitie(uuid,text,text,uuid)',
    'public.reflectie_bronset_hash(jsonb)'
  ]
  loop
    if not exists (select 1 from pg_proc where oid = f::regprocedure) then
      fouten := fouten || format('  - functie %s bestaat niet%s', f, chr(10));
      continue;
    end if;

    select proconfig into cfg from pg_proc where oid = f::regprocedure;
    if cfg is null or not exists (
      select 1 from unnest(cfg) c where c like 'search_path=%'
    ) then
      fouten := fouten || format('  - %s heeft GEEN gepinde search_path '
                              || '(search-path-hijack mogelijk)%s', f, chr(10));
    end if;

    if has_function_privilege('anon', f, 'execute') then
      fouten := fouten || format('  - anon heeft EXECUTE op %s — '
                              || 'ongeauthenticeerd aanroepbaar (H-18)%s', f, chr(10));
    end if;
    if has_function_privilege('public', f, 'execute') then
      fouten := fouten || format('  - PUBLIC heeft EXECUTE op %s%s', f, chr(10));
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      fouten := fouten || format('  - authenticated heeft GEEN EXECUTE op %s — '
                              || 'de route kan de functie niet aanroepen%s', f, chr(10));
    end if;
  end loop;

  if fouten <> '' then
    raise exception E'STRUCTUUR 4 FAALT — definer-hardening:\n%', fouten;
  end if;
  raise notice 'OK 4: beide functies hebben een gepinde search_path; anon/PUBLIC hebben geen EXECUTE.';
end $$;

-- ── 5. Granthygiëne op de statustabel (gate F) ────────────────────────────
-- TRUNCATE valt volledig buiten RLS: die grant maakt "de flowstatus is niet
-- manipuleerbaar" onhoudbaar, hoe streng de policies ook zijn.
do $$
declare fouten text := ''; r record;
begin
  for r in select grantee, privilege_type
             from information_schema.role_table_grants
            where table_schema = 'public'
              and table_name   = 'gesprek_reflectie_state'
              and grantee in ('anon','authenticated')
  loop
    if r.grantee = 'anon' then
      fouten := fouten || format('  - anon heeft %s op de statustabel%s',
                                 r.privilege_type, chr(10));
    elsif r.privilege_type <> 'SELECT' then
      fouten := fouten || format('  - authenticated heeft %s (verwacht alleen SELECT)%s',
                                 r.privilege_type, chr(10));
    end if;
  end loop;

  if fouten <> '' then
    raise exception E'STRUCTUUR 5 FAALT — te ruime tabelgrants:\n%', fouten;
  end if;
  raise notice 'OK 5: anon heeft niets; authenticated heeft uitsluitend SELECT.';
end $$;

-- ── 6. Geen reflectiemarkering elders in het datamodel (AC-17) ────────────
-- Besluit 0112: er bestaat geen tabel, kolom of rij die registreert dát een
-- interactie een reflectie was. De statustabel zelf is de enige uitzondering en
-- is auteur-only. Deze check vangt de verleiding om "even" een vlag toe te
-- voegen aan het auditspoor of aan een fondsbreed leesbare tabel.
--
-- DE GRENS DIE HIER WORDT BEWAAKT (besluit 0126): een VOORKEUR van de gebruiker
-- mag bestaan, een registratie van zijn GEDRAG niet. Daarom staat hieronder een
-- expliciete, smalle allowlist in plaats van een uitzondering op tabelniveau —
-- `profielen.reflectie_uitnodiging` is toegestaan, maar een hypothetische
-- `profielen.reflectie_teller`, `…_laatst_getoond` of `…_aantal_weggeklikt` valt
-- gewoon door deze check heen. Dat is precies de bedoeling.
--
-- (Hersteld 05-08-2026: de eerste versie scande blind op elke kolomnaam met
-- "reflectie" en sloeg daardoor alarm op de opt-out uit B-6 — een check die zijn
-- eigen migratie niet kende.)
do $$
declare
  fouten text := '';
  r record;
  -- tabel.kolom die WÉL mag bestaan, met de reden erbij.
  toegestaan text[] := array[
    'profielen.reflectie_uitnodiging'   -- permanente opt-out (FR-15, besluiten 0121/0126)
  ];
begin
  for r in select c.table_name, c.column_name
             from information_schema.columns c
            where c.table_schema = 'public'
              and c.table_name <> 'gesprek_reflectie_state'
              and c.column_name ilike '%reflectie%'
              and (c.table_name || '.' || c.column_name) <> all (toegestaan)
  loop
    fouten := fouten || format('  - %s.%s%s', r.table_name, r.column_name, chr(10));
  end loop;

  -- En de CHECK-constraint op governance_log.modus mag geen reflectiewaarde kennen.
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.governance_log'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%reflectie%'
  ) then
    fouten := fouten || '  - governance_log heeft een CHECK met een reflectiewaarde'||chr(10);
  end if;

  if fouten <> '' then
    raise exception
      E'AC-17 FAALT — reflectiemarkering gevonden buiten de auteur-only statustabel.\n'
      'Besluit 0112 sluit dit uit: het auditspoor is leesbaar voor houders van een\n'
      'auditcapability, en een markering maakt dan zichtbaar dat een specifieke\n'
      'bestuurder op een specifiek moment twijfelde.\n'
      'Is dit een VOORKEUR van de gebruiker en geen registratie van zijn GEDRAG '
      '(besluit 0126), voeg hem dan expliciet toe aan de allowlist hierboven — '
      'mét motivering. Twijfel je, dan is het gedrag.\n%', fouten;
  end if;
  raise notice 'OK 6: geen reflectiemarkering buiten de statustabel en de opt-out (AC-17).';
end $$;

-- ── 6b. De CHECK-constraints op status én ingang bestaan allebei ──────────
-- Regressievangnet (B-opt tranche 2b): de ingang-CHECK wordt bij de 8→4-migratie
-- gedropt en herbouwd via een DO-block. Matcht dat block per ongeluk óók de
-- status-CHECK (die de literal 'ingang_gekozen' bevat), dan verdwijnt die stil.
-- Deze check faalt luid als een van beide CHECKs ontbreekt.
do $$
declare v_status boolean; v_ingang boolean;
begin
  select
    bool_or(pg_get_constraintdef(con.oid) ilike '%status%'
            and pg_get_constraintdef(con.oid) ilike '%ingang_gekozen%'),
    bool_or(con.conkey = array[(select attnum from pg_attribute
              where attrelid = 'public.gesprek_reflectie_state'::regclass
                and attname = 'ingang' and not attisdropped)])
    into v_status, v_ingang
    from pg_constraint con
   where con.conrelid = 'public.gesprek_reflectie_state'::regclass
     and con.contype = 'c';
  if v_status is not true then
    raise exception 'CHECK-REGRESSIE: de status-CHECK op gesprek_reflectie_state ontbreekt (gedropt door een te brede DO-block?).';
  end if;
  if v_ingang is not true then
    raise exception 'CHECK-REGRESSIE: de ingang-CHECK op gesprek_reflectie_state ontbreekt.';
  end if;
  raise notice 'OK 6b: status- én ingang-CHECK bestaan allebei.';
end $$;

-- ── 7. De bronsethash komt overeen met de TypeScript-spiegel ──────────────
-- Twee implementaties van dezelfde hash die uiteenlopen, lopen STIL uiteen. De
-- verwachte waarde is berekend en vastgepind in core/lib/bronset.sanity.ts.
-- Let op het `collate "C"`-detail in de functie: de standaardcollatie sorteert
-- taalkundig en zou een andere volgorde — en dus een andere hash — geven dan
-- Array.prototype.sort() in JavaScript.
do $$
declare v_hash text; v_verwacht text :=
  'fcd8476d5c09046ce515097823c58a0005a2cbfe7796617d4a883f3d8832140a';
begin
  -- Bewust in een ANDERE volgorde aangeleverd dan de canonieke: de hash hoort
  -- ongevoelig te zijn voor de rangorde waarin de retrieval de chunks teruggaf.
  select public.reflectie_bronset_hash('{
    "chunks":[{"id":"c-bbb","document_id":"doc-2","rang":2},
              {"id":"c-aaa","document_id":"doc-1","rang":1},
              {"id":"c-ccc","document_id":"doc-1","rang":3}],
    "scope":{"document_ids":["doc-2","doc-1"]}}'::jsonb) into v_hash;

  if v_hash is distinct from v_verwacht then
    raise exception
      E'STRUCTUUR 7 FAALT: de SQL-bronsethash wijkt af van de TypeScript-spiegel.\n'
      '  SQL:      %\n  verwacht: %\n'
      'Controleer core/lib/bronset.ts en de collate "C"-sortering in '
      'reflectie_bronset_hash().', coalesce(v_hash,'<null>'), v_verwacht;
  end if;

  -- Geen bruikbare chunks ⇒ NULL, niet een hash over de lege string (AC-21).
  if public.reflectie_bronset_hash('{"chunks":[]}'::jsonb) is not null then
    raise exception 'STRUCTUUR 7 FAALT: lege bronset levert een hash in plaats van NULL.';
  end if;
  if public.reflectie_bronset_hash('{}'::jsonb) is not null then
    raise exception 'STRUCTUUR 7 FAALT: ontbrekende chunks leveren een hash in plaats van NULL.';
  end if;

  raise notice 'OK 7: bronsethash identiek aan de TypeScript-spiegel; lege bronset geeft NULL.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  DEEL 2 — GEDRAG (seed als eigenaar, impersonatie, rollback)
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- Fonds A = 11111111  ·  Fonds B = 22222222
--   user A (aaaa…) — eigenaar van het gesprek, fonds A
--   user C (cccc…) — collega in hetzelfde fonds, fonds A
--   user B (bbbb…) — ander fonds
-- `slug` is `text unique not null` zonder default; de oudere suites (t3 t/m t17)
-- laten hem weg en werken daardoor niet meer tegen dit schema. Dit volgt de
-- nieuwe conventie (r1_tenantgrenzen, p5_monitoring, a_rollen_capabilities).
insert into public.fondsen (id, naam, slug)
values ('11111111-1111-1111-1111-111111111111', 'B-check Fonds A', 'b-check-fonds-a'),
       ('22222222-2222-2222-2222-222222222222', 'B-check Fonds B', 'b-check-fonds-b');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','b-eigenaar@test.local',
   '{"naam":"Eigenaar A","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated','authenticated','b-collega@test.local',
   '{"naam":"Collega C","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','b-ander@test.local',
   '{"naam":"Ander B","fonds_id":"22222222-2222-2222-2222-222222222222"}', now(), now());

do $$
begin
  if (select count(*) from public.profielen
       where id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                    'cccccccc-cccc-cccc-cccc-cccccccccccc')
         and fonds_id = '11111111-1111-1111-1111-111111111111') <> 2 then
    raise exception 'SEED FAALT: de fonds-A-profielen zijn niet aangemaakt (trigger maak_profiel).';
  end if;
end $$;

-- Twee gesprekken van A, en één van de collega C. De logregel bij het EERSTE
-- gesprek draagt de bronset waarop gereflecteerd mag worden; die bij het tweede
-- is de "vreemde" bronset uit AC-18.
insert into public.gesprekken (id, gebruiker_id, fonds_id, titel, berichten)
values ('a0000000-0000-0000-0000-00000000000a',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111', 'Gesprek 1 van A', '[]'::jsonb),
       ('a0000000-0000-0000-0000-00000000000b',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111', 'Gesprek 2 van A', '[]'::jsonb),
       ('c0000000-0000-0000-0000-00000000000c',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '11111111-1111-1111-1111-111111111111', 'Gesprek van C', '[]'::jsonb);

insert into public.governance_log
  (id, gebruiker_id, gebruiker_naam, fonds_id, modus, model, gesprek_audit_id, retrieval_meta)
values
  -- Hoort bij gesprek 1 van A → geldige bronset.
  ('10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Eigenaar A',
   '11111111-1111-1111-1111-111111111111','documenten','claude-sonnet-4-5',
   'a0000000-0000-0000-0000-00000000000a',
   jsonb_build_object(
     'methode','hybride_rrf','geselecteerd',2,
     'chunks', jsonb_build_array(
       jsonb_build_object('id','c-aaa','document_id','doc-1','rang',1),
       jsonb_build_object('id','c-bbb','document_id','doc-2','rang',2)),
     'scope', jsonb_build_object('document_ids', jsonb_build_array('doc-1')))),
  -- Hoort bij gesprek 2 van A → een bronset uit een ANDER gesprek.
  ('10000000-0000-0000-0000-000000000002',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Eigenaar A',
   '11111111-1111-1111-1111-111111111111','documenten','claude-sonnet-4-5',
   'a0000000-0000-0000-0000-00000000000b',
   '{"methode":"geen","geselecteerd":0}'::jsonb),
  -- Hoort bij het gesprek van C → een bronset van een ANDERE gebruiker.
  ('10000000-0000-0000-0000-000000000003',
   'cccccccc-cccc-cccc-cccc-cccccccccccc','Collega C',
   '11111111-1111-1111-1111-111111111111','documenten','claude-sonnet-4-5',
   'c0000000-0000-0000-0000-00000000000c',
   '{"methode":"geen","geselecteerd":0}'::jsonb);

-- ── Vanaf hier: A is aan het woord ────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

-- ── AC-18a — de client kan NIET rechtstreeks schrijven ────────────────────
-- Geen insert-, update- of delete-policy: alle drie moeten falen. Dit is de test
-- die verklaart waarom de status een eigen tabel is en geen kolom op
-- `gesprekken` — dáár heeft de gebruiker wél UPDATE-recht op de eigen rij, en
-- RLS kan geen kolommen afschermen.
do $$
begin
  begin
    insert into public.gesprek_reflectie_state
      (gesprek_id, gebruiker_id, fonds_id, status, beurt)
    values ('a0000000-0000-0000-0000-00000000000a',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '11111111-1111-1111-1111-111111111111', 'afgerond', 3);
    raise exception 'LEK: directe INSERT op gesprek_reflectie_state slaagde.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;
  raise notice 'OK 18a: directe INSERT geweigerd.';
end $$;

-- ── AC-18b — direct op `afgerond` zetten via de RPC faalt ─────────────────
-- Poging 1 van de vijf. De client kan geen einddstatus opgeven; hij kan alleen
-- een ACTIE aanvragen, en `afronden` vereist status `conceptweergave`.
do $$
begin
  begin
    perform public.reflectie_transitie(
      'a0000000-0000-0000-0000-00000000000a', 'afronden', null, null);
    raise exception 'LEK: afronden vanuit niet_actief slaagde.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;
  raise notice 'OK 18b: afronden zonder conceptweergave geweigerd.';
end $$;

-- ── AC-18c — een WILLEKEURIGE bronset kiezen faalt ────────────────────────
-- Poging 2 en 3: een logregel uit een ander gesprek van dezelfde gebruiker, en
-- een logregel van een andere gebruiker. Beide moeten weigeren — anders kan een
-- gebruiker de assistent op bronnen laten reflecteren die niet bij dit antwoord
-- horen, of erger, de bronset van een collega aanwijzen.
do $$
begin
  begin
    perform public.reflectie_transitie(
      'a0000000-0000-0000-0000-00000000000a', 'start', 'twijfel',
      '10000000-0000-0000-0000-000000000002');   -- ander gesprek van A
    raise exception 'LEK: bronset uit een ander gesprek werd geaccepteerd.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;

  begin
    perform public.reflectie_transitie(
      'a0000000-0000-0000-0000-00000000000a', 'start', 'twijfel',
      '10000000-0000-0000-0000-000000000003');   -- logregel van collega C
    raise exception 'LEK: bronset van een andere gebruiker werd geaccepteerd.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;

  raise notice 'OK 18c: een vreemde bronset wordt geweigerd (eigen gesprek én eigen gebruiker vereist).';
end $$;

-- ── AC-18d — andermans status wijzigen faalt ──────────────────────────────
-- Poging 4. Het gesprek van C bestaat, maar A is niet de eigenaar.
do $$
begin
  begin
    perform public.reflectie_transitie(
      'c0000000-0000-0000-0000-00000000000c', 'start', 'twijfel', null);
    raise exception 'LEK: A kon de reflectiestatus van C wijzigen.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;
  raise notice 'OK 18d: transitie op andermans gesprek geweigerd.';
end $$;

-- ── Een geldige flow, zodat de volgende pogingen iets te breken hebben ────
do $$
declare r public.gesprek_reflectie_state;
begin
  r := public.reflectie_transitie(
         'a0000000-0000-0000-0000-00000000000a', 'start', 'twijfel',
         '10000000-0000-0000-0000-000000000001');
  if r.status <> 'ingang_gekozen' then
    raise exception 'START FAALT: status is % in plaats van ingang_gekozen.', r.status;
  end if;
  if r.beurt <> 0 then
    raise exception 'START FAALT: beurt is % in plaats van 0.', r.beurt;
  end if;
  if r.reflectie_bronset_versie is null then
    raise exception 'START FAALT: de bronset is niet bevroren terwijl de logregel chunks heeft.';
  end if;
  if r.ingang <> 'twijfel' then
    raise exception 'START FAALT: ingang is % in plaats van twijfel.', r.ingang;
  end if;
  raise notice 'OK start: ingang_gekozen, beurt 0, bronset bevroren (%).',
               left(r.reflectie_bronset_versie, 12) || '…';
end $$;

-- ── AC-18e — een ONGELDIGE transitie faalt ────────────────────────────────
-- Poging 5. Vanuit `ingang_gekozen` is alleen `antwoord` of `afbreken` geldig.
do $$
begin
  begin
    perform public.reflectie_transitie(
      'a0000000-0000-0000-0000-00000000000a', 'afronden', null, null);
    raise exception 'LEK: afronden vanuit ingang_gekozen slaagde.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;

  begin
    perform public.reflectie_transitie(
      'a0000000-0000-0000-0000-00000000000a', 'concept', null, null);
    raise exception 'LEK: concept vanuit ingang_gekozen slaagde.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;

  -- Opnieuw starten terwijl de flow loopt zou de bevroren bronset vervangen.
  begin
    perform public.reflectie_transitie(
      'a0000000-0000-0000-0000-00000000000a', 'start', 'twijfel', null);
    raise exception 'LEK: opnieuw starten tijdens een lopende flow slaagde.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;

  -- Een actie die niet bestaat.
  begin
    perform public.reflectie_transitie(
      'a0000000-0000-0000-0000-00000000000a', 'verwijderen', null, null);
    raise exception 'LEK: een onbekende actie werd geaccepteerd.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;

  raise notice 'OK 18e: ongeldige transities en onbekende acties geweigerd.';
end $$;

-- ── AC-18f — de beurtteller kan alleen omhoog ─────────────────────────────
-- De client levert de beurt niet aan; de functie berekent hem. Deze test loopt
-- de flow uit tot het plafond en toont dat een vierde antwoord onmogelijk is.
do $$
declare r public.gesprek_reflectie_state; n int;
begin
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','antwoord',null,null);
  if r.status <> 'verdieping_1' or r.beurt <> 1 then
    raise exception 'BEURT FAALT: verwacht verdieping_1/1, kreeg %/%.', r.status, r.beurt;
  end if;

  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','antwoord',null,null);
  if r.status <> 'verdieping_2' or r.beurt <> 2 then
    raise exception 'BEURT FAALT: verwacht verdieping_2/2, kreeg %/%.', r.status, r.beurt;
  end if;

  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','antwoord',null,null);
  if r.status <> 'verdieping_3' or r.beurt <> 3 then
    raise exception 'BEURT FAALT: verwacht verdieping_3/3, kreeg %/%.', r.status, r.beurt;
  end if;

  -- Het plafond: een vierde verdiepingsantwoord bestaat niet (v1.0 §9.6 —
  -- "maximaal twee of drie verdiepingsvragen").
  begin
    perform public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','antwoord',null,null);
    raise exception 'LEK: een vierde verdiepingsantwoord werd geaccepteerd.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;

  -- De bronset is gedurende de hele flow onveranderd gebleven.
  select count(*) into n from public.gesprek_reflectie_state
   where gesprek_id = 'a0000000-0000-0000-0000-00000000000a'
     and bronset_log_id = '10000000-0000-0000-0000-000000000001'
     and ingang = 'twijfel';
  if n <> 1 then
    raise exception 'BEVRIEZING FAALT: de bronset of de ingang is tijdens de flow gewijzigd.';
  end if;

  -- En via de RPC kan de beurt niet omlaag: er is geen actie die dat doet.
  -- Afbreken zet hem op 0 én de status op niet_actief — dat is geen "teruggaan
  -- in de flow" maar het einde ervan.
  raise notice 'OK 18f: beurt 1→2→3, vierde antwoord geweigerd, bronset onveranderd.';
end $$;

-- ── AC-18g — herformuleren (B-opt tranche 1a) ─────────────────────────────
-- De actie `herformuleren` blijft in conceptweergave, verhoogt de beurt NIET en
-- laat de bevroren bronset en de ingang ongemoeid. Vanuit elke andere status is
-- hij ongeldig — en dan met 'ongeldige_transitie', NIET 'ongeldige_actie': de
-- actie bestaat, alleen de overgang niet.
do $$
declare r public.gesprek_reflectie_state;
begin
  -- Herformuleren vanuit een verdiepingsstatus (nu: verdieping_3) moet falen op
  -- de TRANSITIE, niet op de actie-allowlist. Zou de allowlist hem afwijzen, dan
  -- was de nieuwe actie nooit geïnstalleerd.
  begin
    perform public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','herformuleren',null,null);
    raise exception 'LEK: herformuleren werd vanuit verdieping_3 geaccepteerd.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
    if sqlerrm like '%ongeldige_actie%' then
      raise exception 'HERFORMULEREN FAALT: actie niet geïnstalleerd (kreeg ongeldige_actie i.p.v. ongeldige_transitie).';
    end if;
  end;

  -- Naar de conceptweergave.
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','concept',null,null);
  if r.status <> 'conceptweergave' then
    raise exception 'CONCEPT FAALT: status is %.', r.status;
  end if;

  -- Herformuleren: blijft conceptweergave, beurt onveranderd (3), en ingang +
  -- bevroren bronset onaangeroerd.
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','herformuleren',null,null);
  if r.status <> 'conceptweergave' or r.beurt <> 3 then
    raise exception 'HERFORMULEREN FAALT: verwacht conceptweergave/3, kreeg %/%.', r.status, r.beurt;
  end if;
  if r.ingang <> 'twijfel'
     or r.bronset_log_id <> '10000000-0000-0000-0000-000000000001' then
    raise exception 'HERFORMULEREN FAALT: ingang of bronset gewijzigd (%, %).', r.ingang, r.bronset_log_id;
  end if;

  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','afronden',null,null);
  if r.status <> 'afgerond' then
    raise exception 'AFRONDEN FAALT: status is %.', r.status;
  end if;

  -- "Terug naar het gesprek" (of een gewone chatbeurt) wist de flow volledig.
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','afbreken',null,null);
  if r.status <> 'niet_actief' or r.beurt <> 0 then
    raise exception 'AFBREKEN FAALT: %/%.', r.status, r.beurt;
  end if;
  if r.ingang is not null or r.bronset_log_id is not null
     or r.reflectie_bronset_versie is not null then
    raise exception 'AFBREKEN FAALT: ingang of bronset bleef staan na het beëindigen.';
  end if;

  -- Herformuleren vanuit niet_actief is ongeldig (geen conceptweergave).
  begin
    perform public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','herformuleren',null,null);
    raise exception 'LEK: herformuleren werd vanuit niet_actief geaccepteerd.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;

  raise notice 'OK 18g/flow: herformuleren blijft conceptweergave (beurt/bronset onveranderd); concept → afgerond → niet_actief.';
end $$;

-- ── AC-18h — verdiepen (B-opt tranche 2d) ─────────────────────────────────
-- "Nog een stap verdiepen": vanuit conceptweergave terug naar verdieping_{beurt},
-- zodat het volgende antwoord doortelt. Verdiepen zelf verhoogt de beurt niet;
-- server-side geweigerd bij beurt >= 3 (het beurtplafond blijft een vangnet).
do $$
declare r public.gesprek_reflectie_state;
begin
  -- Verse flow op gesprek a (staat op niet_actief na 18g). Nieuwe ingangwaarde.
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','start','twijfel',null);
  if r.status <> 'ingang_gekozen' then
    raise exception 'VERDIEPEN-SETUP FAALT: status is %.', r.status;
  end if;

  -- verdiepen mag NIET vanuit ingang_gekozen (alleen vanuit conceptweergave).
  begin
    perform public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','verdiepen',null,null);
    raise exception 'LEK: verdiepen werd vanuit ingang_gekozen geaccepteerd.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;

  -- antwoord 1 → verdieping_1/1 → concept → conceptweergave/1.
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','antwoord',null,null);
  if r.status <> 'verdieping_1' or r.beurt <> 1 then raise exception 'VERDIEPEN FAALT (a): %/%.', r.status, r.beurt; end if;
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','concept',null,null);
  if r.status <> 'conceptweergave' or r.beurt <> 1 then raise exception 'VERDIEPEN FAALT (b): %/%.', r.status, r.beurt; end if;

  -- verdiepen bij beurt 1 → verdieping_1, beurt onveranderd.
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','verdiepen',null,null);
  if r.status <> 'verdieping_1' or r.beurt <> 1 then
    raise exception 'VERDIEPEN FAALT (c): verwacht verdieping_1/1, kreeg %/%.', r.status, r.beurt;
  end if;

  -- Het volgende antwoord telt door naar verdieping_2/2.
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','antwoord',null,null);
  if r.status <> 'verdieping_2' or r.beurt <> 2 then raise exception 'VERDIEPEN FAALT (d): %/%.', r.status, r.beurt; end if;
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','concept',null,null);
  if r.status <> 'conceptweergave' or r.beurt <> 2 then raise exception 'VERDIEPEN FAALT (e): %/%.', r.status, r.beurt; end if;

  -- verdiepen bij beurt 2 → verdieping_2.
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','verdiepen',null,null);
  if r.status <> 'verdieping_2' or r.beurt <> 2 then raise exception 'VERDIEPEN FAALT (f): %/%.', r.status, r.beurt; end if;

  -- antwoord → verdieping_3/3 → concept → conceptweergave/3.
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','antwoord',null,null);
  if r.status <> 'verdieping_3' or r.beurt <> 3 then raise exception 'VERDIEPEN FAALT (g): %/%.', r.status, r.beurt; end if;
  r := public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','concept',null,null);
  if r.status <> 'conceptweergave' or r.beurt <> 3 then raise exception 'VERDIEPEN FAALT (h): %/%.', r.status, r.beurt; end if;

  -- verdiepen bij beurt 3 → geweigerd (beurtplafond blijft hard).
  begin
    perform public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','verdiepen',null,null);
    raise exception 'LEK: verdiepen bij beurt 3 werd geaccepteerd.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;

  -- Opruimen zodat de rest van de suite met een schone gesprek-a start.
  perform public.reflectie_transitie('a0000000-0000-0000-0000-00000000000a','afbreken',null,null);
  raise notice 'OK 18h: verdiepen ↔ verdieping_{beurt}, doortelling tot het plafond, verdiepen bij beurt 3 geweigerd.';
end $$;

-- ── Een gewone chatbeurt maakt GEEN statusrij aan ─────────────────────────
-- De chatroute roept bij elke normale beurt `afbreken` aan. Zou dat een rij
-- aanmaken, dan zou elk gesprek waarin nooit is gereflecteerd tóch een rij in
-- deze tabel krijgen — een registratie zonder inhoud, maar wél een registratie.
do $$
declare n int;
begin
  perform public.reflectie_transitie('a0000000-0000-0000-0000-00000000000b','afbreken',null,null);
  select count(*) into n from public.gesprek_reflectie_state
   where gesprek_id = 'a0000000-0000-0000-0000-00000000000b';
  if n <> 0 then
    raise exception
      'REGISTRATIE: een gewone chatbeurt in gesprek 2 maakte een statusrij aan. '
      'Besluit 0112 sluit registratie zonder noodzaak uit.';
  end if;
  raise notice 'OK: afbreken zonder lopende reflectie maakt geen rij aan.';
end $$;

-- ── FR-55/AC-21 — starten ZONDER bronset mag, en levert versie NULL ───────
do $$
declare r public.gesprek_reflectie_state;
begin
  r := public.reflectie_transitie(
         'a0000000-0000-0000-0000-00000000000b', 'start', 'twijfel', null);
  if r.status <> 'ingang_gekozen' then
    raise exception 'START-ZONDER-BRONSET FAALT: status is %.', r.status;
  end if;
  if r.reflectie_bronset_versie is not null then
    raise exception 'START-ZONDER-BRONSET FAALT: er is een versie gezet zonder bronset.';
  end if;
  raise notice 'OK AC-21: reflectie zonder bronset is toegestaan; versie blijft NULL.';
end $$;

-- ── Een ongeldige ingang wordt geweigerd ──────────────────────────────────
do $$
begin
  begin
    perform public.reflectie_transitie(
      'c0000000-0000-0000-0000-00000000000c', 'start', 'geen_aanvullende_reflectie', null);
    raise exception 'LEK: een ingang buiten de vaste set werd geaccepteerd.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;
  raise notice 'OK: een ingang buiten de vaste set wordt geweigerd.';
end $$;

-- ── FR-16 — een collega ziet NUL rijen ────────────────────────────────────
-- De reflectiestatus is auteur-only. Een collega in hetzelfde fonds ziet niets:
-- niet dát er gereflecteerd wordt, niet waarover, en niet hoe ver.
set local request.jwt.claims to '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';
do $$
declare n int;
begin
  select count(*) into n from public.gesprek_reflectie_state;
  if n <> 0 then
    raise exception
      'LEK: collega C ziet % rij(en) in gesprek_reflectie_state. De flowstatus '
      'is auteur-only (FR-16, besluit 0112).', n;
  end if;
  raise notice 'OK FR-16: een collega in hetzelfde fonds ziet nul reflectierijen.';
end $$;

-- ── Tenantgrens — een gebruiker uit een ander fonds ziet óók niets ────────
set local request.jwt.claims to '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}';
do $$
declare n int;
begin
  select count(*) into n from public.gesprek_reflectie_state;
  if n <> 0 then
    raise exception 'LEK: gebruiker uit fonds B ziet % rij(en).', n;
  end if;

  begin
    perform public.reflectie_transitie(
      'a0000000-0000-0000-0000-00000000000a', 'afbreken', null, null);
    raise exception 'LEK: gebruiker uit fonds B kon een transitie op fonds A uitvoeren.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;
  raise notice 'OK tenantgrens: fonds B ziet niets en kan niets wijzigen in fonds A.';
end $$;

-- ── AC-24 — verwijderen van het gesprek ruimt de flowstatus mee op ────────
-- Het gedragsbewijs bij structurele check 3. Bewust via verwijder_gesprek(),
-- niet via een kale DELETE: dat is het enige pad dat de gebruiker heeft.
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
do $$
declare n int;
begin
  -- Gesprek 2 heeft sinds de AC-21-test een lopende reflectie.
  select count(*) into n from public.gesprek_reflectie_state
   where gesprek_id = 'a0000000-0000-0000-0000-00000000000b';
  if n <> 1 then
    raise exception 'VOORWAARDE AC-24 FAALT: er staat geen flowstatus klaar om te verwijderen.';
  end if;

  perform public.verwijder_gesprek(
    'a0000000-0000-0000-0000-00000000000b',
    'deadbeef-0000-0000-0000-00000000dead');

  select count(*) into n from public.gesprek_reflectie_state
   where gesprek_id = 'a0000000-0000-0000-0000-00000000000b';
  if n <> 0 then
    raise exception
      'AC-24 FAALT: na het verwijderen van het gesprek staat de flowstatus er nog. '
      'Er blijft dan een spoor van iemands twijfel achter dat de gebruiker niet '
      'meer kan opruimen.';
  end if;

  -- En het gesprek zelf is weg.
  select count(*) into n from public.gesprekken
   where id = 'a0000000-0000-0000-0000-00000000000b';
  if n <> 0 then
    raise exception 'AC-24 FAALT: het gesprek bestaat nog.';
  end if;

  raise notice 'OK AC-24: verwijderen van het gesprek ruimt de reflectiestatus mee op.';
end $$;

rollback;

-- ── Slot ────────────────────────────────────────────────────────────────────
do $$
begin
  raise notice 'Plateau B reflectieflow-suite doorlopen. Elke OK-regel hierboven is een geslaagde controle; bij een fout was de batch afgebroken.';
end $$;

-- ── Fail-safe (FR-57) — ALS LAATSTE ────────────────────────────────────────
-- Deze controle manipuleert `bijgewerkt_op` rechtstreeks, en dat kan alleen als
-- tabeleigenaar (RLS-vrij). In een omgeving waar de suite als gewone gebruiker
-- draait, faalt hij daarom om een oninteressante reden. Hij staat om die reden
-- ONDERAAN — dezelfde les als AC-2 in de A-suite: een check die een periode lang
-- rood kan staan, mag het echte werk niet afbreken.
begin;

insert into public.fondsen (id, naam, slug)
values ('33333333-3333-3333-3333-333333333333', 'B-check Fonds C', 'b-check-fonds-c');
insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values ('ffffffff-ffff-ffff-ffff-ffffffffffff','authenticated','authenticated','b-failsafe@test.local',
        '{"naam":"Failsafe F","fonds_id":"33333333-3333-3333-3333-333333333333"}', now(), now());
insert into public.gesprekken (id, gebruiker_id, fonds_id, titel, berichten)
values ('f0000000-0000-0000-0000-00000000000f','ffffffff-ffff-ffff-ffff-ffffffffffff',
        '33333333-3333-3333-3333-333333333333','Failsafe-gesprek','[]'::jsonb);

set local role authenticated;
set local request.jwt.claims to '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff"}';
select public.reflectie_transitie('f0000000-0000-0000-0000-00000000000f','start','twijfel',null);

reset role;
update public.gesprek_reflectie_state
   set bijgewerkt_op = now() - interval '25 hours'
 where gesprek_id = 'f0000000-0000-0000-0000-00000000000f';

set local role authenticated;
set local request.jwt.claims to '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff"}';
do $$
declare r public.gesprek_reflectie_state;
begin
  -- Na 25 uur telt de flow niet meer. `antwoord` zou vanuit `ingang_gekozen`
  -- geldig zijn, maar de fail-safe heeft de status al op niet_actief gezet — dus
  -- is de overgang ongeldig. Zo kan een chat niet een dag later onverwacht in
  -- reflectiemodus staan (FR-57, AC-23).
  begin
    perform public.reflectie_transitie('f0000000-0000-0000-0000-00000000000f','antwoord',null,null);
    raise exception 'LEK: een 25 uur oude flow accepteerde nog een antwoord.';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'LEK:%' then raise; end if;
  end;

  -- En opnieuw starten mág dan wél — de flow is immers vervallen.
  r := public.reflectie_transitie('f0000000-0000-0000-0000-00000000000f','start','twijfel',null);
  if r.status <> 'ingang_gekozen' or r.beurt <> 0 then
    raise exception 'FAIL-SAFE FAALT: opnieuw starten na verval gaf %/%.', r.status, r.beurt;
  end if;
  raise notice 'OK FR-57: een flow ouder dan 24 uur vervalt naar niet_actief en kan opnieuw starten.';
end $$;

rollback;
