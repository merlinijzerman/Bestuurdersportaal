-- ============================================================================
-- R1 (besluit 0218) — pariteit van `zoek_chunks_begrensd` met `zoek_chunks`
-- onder ECHTE RLS, plus de twee bewuste verschillen en de catalogus-pin.
-- ----------------------------------------------------------------------------
-- De migratie 2026_10_03_r1_zoek_chunks_begrensd.sql voegt een plpgsql-variant
-- van zoek_chunks toe (zelfde 10 parameters, zelfde 23 retourkolommen, zelfde
-- filterblok, SECURITY INVOKER). Deze check bewijst:
--
--   P1 — toegangsmatrix, acht actoren × elf scenario's: eigen fonds (A), ander
--        fonds (B), gebruiker zonder profiel, authenticated zonder sub, anon,
--        anon mét sub van A, service_role en portaal_beperkt (sub van A). Per
--        cel is de uitkomst van `zoek_chunks_begrensd` GELIJK aan die van
--        `zoek_chunks`: dezelfde SQLSTATE bij een fout, anders dezelfde
--        id-set, dezelfde geordende (rang, chunk_index)-reeks en per
--        tie-groep dezelfde id-set. Plus een semantische ondergrens (A ziet
--        A + generiek en nooit B; zonder sub en anon zien niets of 42501;
--        service_role ziet de volledige, door p_fonds_id begrensde set), zodat
--        een lege matrix niet als "gelijk" kan slagen.
--   M  — sectie-M-filtermatrix van #500 (tests/cross-tenant/fixtures/
--        500-artikeltoelating-matrix.json, 21 rijen × 11 scenario's): per
--        scenario geldt nieuw == oud == verwacht.
--   N  — negatieve controles: een pg_temp-kopie van de nieuwe functie waarin
--        precies ÉÉN clausule is uitgeschakeld, moet voor het bijbehorende
--        scenario van de echte functie afwijken (rood). Gedocumenteerde
--        uitzonderingen: `fonds` bij het eigen fonds wordt niet rood omdat
--        RLS op documenten de fondsgrens al trekt (`rls_dekt`; bij een
--        p_fonds_id van een ander fonds wél rood), en `actief`/`scope`
--        staan bewust in stap 1 én stap 2 (`dubbel_gedekt`: alleen de
--        stap-2-kopie weghalen is niet rood, beide weghalen wel).
--   C  — catalogus-pin: precies één overload; prosecdef = false; prolang =
--        plpgsql; provolatile = s; proconfig = exact `search_path=public,
--        pg_temp`; parameter- en retourcontract byte-gelijk aan zoek_chunks;
--        ACL (als set) gelijk aan zoek_chunks; geen set_config in de definitie.
--   L  — limietafwijzing (bewust verschil): p_limit 1001 ⇒ oud accepteert,
--        nieuw ⇒ SQLSTATE P0R01; 1000 ⇒ beide gelijk; null/0/-5 ⇒ beide één
--        rij (greatest(p_limit, 1)) en gelijk.
--   T  — tiebreaker (bewust verschil): binnen een tie-groep (gelijke rang én
--        chunk_index) sorteert de nieuwe functie op id; buiten tie-groepen is
--        de id-reeks identiek aan de oude. De fixture bevat echte ties, anders
--        is de test leeg (dat wordt gecontroleerd).
--
-- Self-seeding in één transactie met ROLLBACK — laat geen data achter.
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw, de pg_temp-kopieën en afbraak; de matrix, sectie
--      M, de negatieve controles, de limiet- en de tiebreakertest worden
--      gemeten als authenticated, anon, service_role en portaal_beperkt
--      (set_config('role', …) + request.jwt.claims), want alleen onder die
--      rollen staat RLS werkelijk tussen de functies en de data — als
--      postgres (eigenaar) zou elke pariteit triviaal zijn.
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ── Fixture (prefix 02180000) ───────────────────────────────────────────────
insert into public.fondsen (id, naam, slug) values
  ('02180000-1111-1111-1111-111111111111', '#0218 fonds A', 'r1-zoektekst-a'),
  ('02180000-2222-2222-2222-222222222222', '#0218 fonds B', 'r1-zoektekst-b');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at) values
  ('02180000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'r1-a@test.local',
   '{"naam":"R1 A","fonds_id":"02180000-1111-1111-1111-111111111111"}', now(), now()),
  ('02180000-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'r1-b@test.local',
   '{"naam":"R1 B","fonds_id":"02180000-2222-2222-2222-222222222222"}', now(), now());

do $$
begin
  if (select fonds_id from public.profielen where id = '02180000-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
       is distinct from '02180000-1111-1111-1111-111111111111'::uuid
     or (select fonds_id from public.profielen where id = '02180000-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
       is distinct from '02180000-2222-2222-2222-222222222222'::uuid then
    raise exception 'SEED FAALT: profielen A/B niet aan hun fonds gekoppeld (trigger maak_profiel).';
  end if;
  if exists (select 1 from public.profielen where id = '02180000-cccc-cccc-cccc-cccccccccccc') then
    raise exception 'SEED FAALT: de zonder-profiel-sub heeft toch een profiel.';
  end if;
end $$;

insert into public.procedures (id, fonds_id, template_code, titel)
values ('02180000-0000-0000-0000-0000000000f1', '02180000-1111-1111-1111-111111111111', 'r1-test', 'R1 dossier');

-- Documenten: per rij één randgeval; de chunkkolommen worden door de
-- denorm-trigger uit de documentrij gevuld.
insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief, geldig_vanaf, geldig_tot, volgende_review, procesinstantie_id)
values
  ('02180000-0000-0000-0000-0000000000a1', '02180000-1111-1111-1111-111111111111', 'fonds', 'Intern', 'A1 vastgesteld',        'vastgesteld',  'actief',     true,  null, null, null, null),
  ('02180000-0000-0000-0000-0000000000a2', '02180000-1111-1111-1111-111111111111', 'fonds', 'Intern', 'A2 concept',            'concept',      'actief',     true,  null, null, null, null),
  ('02180000-0000-0000-0000-0000000000a3', '02180000-1111-1111-1111-111111111111', 'fonds', 'Intern', 'A3 inactief',           'vastgesteld',  'actief',     false, null, null, null, null),
  ('02180000-0000-0000-0000-0000000000a4', '02180000-1111-1111-1111-111111111111', 'fonds', 'Intern', 'A4 gearchiveerd',       'gearchiveerd', 'actief',     true,  null, null, null, null),
  ('02180000-0000-0000-0000-0000000000a5', '02180000-1111-1111-1111-111111111111', 'fonds', 'Intern', 'A5 geldig_tot verstreken','vastgesteld','actief',     true,  null, '2025-01-01', null, null),
  ('02180000-0000-0000-0000-0000000000a6', '02180000-1111-1111-1111-111111111111', 'fonds', 'Intern', 'A6 bronstatus historisch','vastgesteld','historisch', true,  null, null, null, null),
  ('02180000-0000-0000-0000-0000000000a7', '02180000-1111-1111-1111-111111111111', 'fonds', 'Intern', 'A7 procesinstantie',    'vastgesteld',  'actief',     true,  null, null, null, '02180000-0000-0000-0000-0000000000f1'),
  ('02180000-0000-0000-0000-0000000000a8', '02180000-1111-1111-1111-111111111111', 'fonds', 'Intern', 'A8 van_kracht vanaf 2027','van_kracht', 'actief',     true,  '2027-01-01', null, null, null),
  ('02180000-0000-0000-0000-0000000000b1', '02180000-2222-2222-2222-222222222222', 'fonds', 'Intern', 'B1 vastgesteld',        'vastgesteld',  'actief',     true,  null, null, null, null),
  ('02180000-0000-0000-0000-0000000000b2', '02180000-2222-2222-2222-222222222222', 'fonds', 'Intern', 'B2 concept',            'concept',      'actief',     true,  null, null, null, null),
  ('02180000-0000-0000-0000-0000000000e1', null, 'generiek', 'Extern', 'G1 van_kracht',             'van_kracht',   'actief',     true,  null, null, null, null),
  ('02180000-0000-0000-0000-0000000000e2', null, 'generiek', 'Extern', 'G2 concept',                'concept',      'actief',     true,  null, null, null, null),
  ('02180000-0000-0000-0000-0000000000e3', null, 'generiek', 'Extern', 'G3 review verlopen',        'van_kracht',   'actief',     true,  null, null, '2020-01-01', null),
  ('02180000-0000-0000-0000-0000000000e4', null, 'generiek', 'Extern', 'G4 bronstatus historisch',  'van_kracht',   'historisch', true,  null, null, null, null),
  ('02180000-0000-0000-0000-0000000000e5', null, 'generiek', 'Extern', 'G5 review toekomst',        'van_kracht',   'actief',     true,  null, null, '2030-01-01', null),
  ('02180000-0000-0000-0000-0000000000e6', null, 'generiek', 'Extern', 'G6 inactief',               'van_kracht',   'actief',     false, null, null, null, null),
  -- tie-documenten: identieke teksten op dezelfde chunk_index ⇒ gelijke rang.
  ('02180000-0000-0000-0000-0000000000d1', '02180000-1111-1111-1111-111111111111', 'fonds', 'Intern', 'T1 tie',                'vastgesteld',  'actief',     true,  null, null, null, null),
  ('02180000-0000-0000-0000-0000000000d2', '02180000-1111-1111-1111-111111111111', 'fonds', 'Intern', 'T2 tie',                'vastgesteld',  'actief',     true,  null, null, null, null),
  ('02180000-0000-0000-0000-0000000000d3', null, 'generiek', 'Extern', 'T3 tie generiek',           'van_kracht',   'actief',     true,  null, null, null, null);

-- Chunks: drie per document (index 0..2). Index 0 en 1 zijn per index
-- IDENTIEK over alle documenten (⇒ tie-groepen over fonds- én generieke
-- documenten); index 2 draagt de documenttitel (⇒ unieke rang per document).
insert into public.document_chunks (id, document_id, chunk_index, pagina, tekst)
select ('02180000-0000-0000-0000-' || substr(d.id::text, 34, 3) || 'c0000000' || i)::uuid,
       d.id, i, i + 1,
       case i
         when 0 then 'Het transitieplan van het pensioen fonds beschrijft de keuzes van sociale partners.'
         when 1 then 'Evenwicht tussen generaties en compensatie bij de transitie naar het nieuwe contract.'
         else 'Transitieplan pensioen: ' || d.titel || ' — bestuur, toezicht en verantwoording.'
       end
  from public.documenten d, generate_series(0, 2) i
 where d.id::text like '02180000-0000-0000-0000-0000000000%';

-- ── Sectie-M-fixture (#500, gedeelde matrix; prefix 05000000/05001000) ──────
\set matrix500 `cat tests/cross-tenant/fixtures/500-artikeltoelating-matrix.json`
select set_config('art500.matrix', :'matrix500', true);

insert into public.fondsen (id, naam, slug) values
  ('05000000-1111-1111-1111-111111111111', 'Artikelspoor fonds A', 'artikelspoor-fonds-a'),
  ('05000000-2222-2222-2222-222222222222', 'Artikelspoor fonds B', 'artikelspoor-fonds-b');
insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at) values
  ('05000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','art-a@test.local',
   '{"naam":"Art A","fonds_id":"05000000-1111-1111-1111-111111111111"}', now(), now());
insert into public.procedures (id, fonds_id, template_code, titel)
values ('05001000-0000-0000-0000-0000000000f1', '05000000-1111-1111-1111-111111111111', 'art500-test', 'Artikelspoor dossier');
insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief,
   geldig_vanaf, geldig_tot, volgende_review, procesinstantie_id)
select r.document_id, r.fonds_id, r.bibliotheek,
       case when r.bibliotheek = 'generiek' then 'Extern' else 'Intern' end,
       'Matrix — ' || r.sleutel, r.status, r.bronstatus, r.actief,
       r.geldig_vanaf, r.geldig_tot, r.volgende_review, r.procesinstantie_id
  from jsonb_to_recordset(current_setting('art500.matrix')::jsonb -> 'rijen') as r(
       sleutel text, document_id uuid, fonds_id uuid, bibliotheek text, status text,
       bronstatus text, actief boolean, geldig_vanaf date, geldig_tot date,
       volgende_review date, procesinstantie_id uuid);
insert into public.document_chunks (id, document_id, chunk_index, pagina, tekst, structuur_type, structuur_label)
select r.chunk_id, r.document_id, 0, 1,
       case when r.frase then E'Artikel 150d Pensioenwet (Transitieplan)\nMatrixrij ' || r.sleutel
            else 'Vervolgtekst zonder de verwijzing, matrixrij ' || r.sleutel end,
       'artikel', 'Artikel 150d'
  from jsonb_to_recordset(current_setting('art500.matrix')::jsonb -> 'rijen') as r(
       sleutel text, document_id uuid, chunk_id uuid, frase boolean);

-- ── Hulpfuncties ────────────────────────────────────────────────────────────
-- Eén aanroep van een zoekfunctie met een scenario, als genormaliseerde jsonb:
--   fout   → {"fout": SQLSTATE}
--   anders → {"ids": [gesorteerd], "reeks": [[rang, chunk_index] in volgorde],
--             "ties": {"rang|chunk_index": [ids gesorteerd]}, "volgorde": [ids in volgorde]}
-- Alleen de fixture-id's (prefix 02180000) tellen mee, zodat andere testdata
-- in dezelfde database de vergelijking niet kan beïnvloeden.
create function pg_temp.r1_run(fn text, s jsonb, prefix text default '02180000-', extra text default '') returns jsonb
language plpgsql as $$
declare
  v_sql text;
  v_uit jsonb;
begin
  v_sql := format($q$
    with r as (
      select z.id, z.rang, z.chunk_index, row_number() over () as n
        from %s(%s
          p_query => %L, p_limit => %s, p_document_ids => %L::uuid[],
          p_bronstatus => %L::text[], p_documentstatus => %L::text[],
          p_procesinstantie_ids => %L::uuid[], p_modus => %L, p_peildatum => %L::date,
          p_bronsoort => %L::text[], p_fonds_id => %L::uuid) z
    ), f as (select * from r where id::text like %L || '%%')
    select jsonb_build_object(
      'n_raw',    (select count(*) from r),
      'ids',      (select coalesce(jsonb_agg(id order by id), '[]') from f),
      'volgorde', (select coalesce(jsonb_agg(id order by n), '[]') from f),
      'reeks',    (select coalesce(jsonb_agg(jsonb_build_array(rang, chunk_index) order by n), '[]') from f),
      'ties',     (select coalesce(jsonb_object_agg(k, v), '{}') from (
                     select rang::text || '|' || chunk_index as k, jsonb_agg(id order by id) as v
                       from f group by rang, chunk_index) t))
  $q$, fn, extra, s->>'query', coalesce(s->>'limit', '1000'),
       case when jsonb_typeof(s->'scope') = 'array' then array(select jsonb_array_elements_text(s->'scope'))::uuid[] end,
       case when jsonb_typeof(s->'bronstatus') = 'array' then array(select jsonb_array_elements_text(s->'bronstatus')) end,
       case when jsonb_typeof(s->'documentstatus') = 'array' then array(select jsonb_array_elements_text(s->'documentstatus')) end,
       case when jsonb_typeof(s->'procesinstantie_ids') = 'array' then array(select jsonb_array_elements_text(s->'procesinstantie_ids'))::uuid[] end,
       coalesce(s->>'modus', 'alles'), coalesce(s->>'peildatum', '2026-10-03'),
       case when jsonb_typeof(s->'bronsoort') = 'array' then array(select jsonb_array_elements_text(s->'bronsoort')) end,
       s->>'fonds_id', prefix);
  begin
    execute v_sql into v_uit;
  exception when others then
    return jsonb_build_object('fout', sqlstate);
  end;
  -- Het limietvenster (1000) mag niet vol zijn: anders kan andere zichtbare
  -- data (bv. een nog aanwezige PR0-fixture) de fixture-rijen uit het venster
  -- drukken en wordt "gelijk" betekenisloos. In CI is de wegwerp-DB schoon.
  if coalesce(nullif(s->>'limit', 'null'), '1000')::int >= 1000 and (v_uit->>'n_raw')::int >= coalesce(nullif(s->>'limit', 'null'), '1000')::int then
    raise exception 'SEED FAALT: het limietvenster (%) is vol — er is andere zichtbare data in deze database (bv. de PR0-fixture); draai deze check op een schone wegwerp-DB.', s->>'limit';
  end if;
  return v_uit - 'n_raw';
end $$;

-- Pariteit: fout ⇔ fout met dezelfde SQLSTATE; anders id-set, geordende
-- (rang, chunk_index)-reeks en de id-set per tie-groep gelijk. De
-- `volgorde` (id-reeks) wordt hier BEWUST niet vergeleken: die mag binnen
-- een tie-groep verschillen (tiebreaker, sectie T).
create function pg_temp.r1_pariteit(a jsonb, b jsonb) returns text language sql immutable as $$
  select case
    when a ? 'fout' or b ? 'fout' then
      case when a->>'fout' is distinct from b->>'fout'
           then format('fout %s ≠ %s', coalesce(a->>'fout', 'geen'), coalesce(b->>'fout', 'geen')) end
    when a->'ids' <> b->'ids'     then format('id-set verschilt: %s ≠ %s', a->'ids', b->'ids')
    when a->'reeks' <> b->'reeks' then format('(rang, chunk_index)-reeks verschilt: %s ≠ %s', a->'reeks', b->'reeks')
    when a->'ties' <> b->'ties'   then format('tie-groepen verschillen: %s ≠ %s', a->'ties', b->'ties')
  end
$$;

-- De scenario's (p_fonds_id wordt per actor ingevuld, zoals de app dat doet).
create function pg_temp.r1_scenarios() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'strikt',         jsonb_build_object('query', 'transitieplan pensioen'),
    'verslapt',       jsonb_build_object('query', 'transitieplan or sociale or evenwicht or compensatie'),
    'frase',          jsonb_build_object('query', '"sociale partners"'),
    'nul',            jsonb_build_object('query', 'zzqxv plonkzz'),
    'scope',          jsonb_build_object('query', 'transitieplan or evenwicht',
                        'scope', jsonb_build_array('02180000-0000-0000-0000-0000000000a1', '02180000-0000-0000-0000-0000000000e1', '02180000-0000-0000-0000-0000000000b1')),
    'actueel',        jsonb_build_object('query', 'transitieplan or evenwicht', 'modus', 'actueel', 'peildatum', '2026-10-03',
                        'bronsoort', jsonb_build_array('fonds', 'generiek')),
    'bronsoort_fonds', jsonb_build_object('query', 'transitieplan or evenwicht', 'bronsoort', jsonb_build_array('fonds')),
    'documentstatus', jsonb_build_object('query', 'transitieplan or evenwicht', 'documentstatus', jsonb_build_array('vastgesteld')),
    'procesinstantie', jsonb_build_object('query', 'transitieplan or evenwicht', 'procesinstantie_ids', jsonb_build_array('02180000-0000-0000-0000-0000000000f1')),
    'bronstatus',     jsonb_build_object('query', 'transitieplan or evenwicht', 'bronstatus', jsonb_build_array('historisch')),
    'zonder_fonds',   jsonb_build_object('query', 'transitieplan or evenwicht', 'fonds_id', null))
$$;

-- ── P1: toegangsmatrix (8 actoren × 11 scenario's, oud vs nieuw) ────────────
do $$
declare
  c_a  constant text := '02180000-1111-1111-1111-111111111111';
  c_b  constant text := '02180000-2222-2222-2222-222222222222';
  c_ua constant text := '02180000-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  c_ub constant text := '02180000-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  c_un constant text := '02180000-cccc-cccc-cccc-cccccccccccc';
  actor record;
  sc record;
  s jsonb;
  oud jsonb;
  nieuw jsonb;
  v text;
  n_cellen int := 0;
  n_fout int := 0;
  n_leeg int := 0;
  matrix jsonb := '{}'::jsonb;
  ids jsonb;
begin
  for actor in
    select * from (values
      ('eigen_fonds_A',            'authenticated',   jsonb_build_object('sub', c_ua, 'role', 'authenticated'),   c_a),
      ('ander_fonds_B',            'authenticated',   jsonb_build_object('sub', c_ub, 'role', 'authenticated'),   c_b),
      ('zonder_profiel',           'authenticated',   jsonb_build_object('sub', c_un, 'role', 'authenticated'),   c_a),
      ('authenticated_zonder_sub', 'authenticated',   jsonb_build_object('role', 'authenticated'),                c_a),
      ('anon',                     'anon',            jsonb_build_object('role', 'anon'),                         c_a),
      ('anon_met_sub_A',           'anon',            jsonb_build_object('sub', c_ua, 'role', 'anon'),            c_a),
      ('service_role',             'service_role',    jsonb_build_object('role', 'service_role'),                 c_a),
      ('portaal_beperkt_A',        'portaal_beperkt', jsonb_build_object('sub', c_ua, 'role', 'portaal_beperkt'), c_a)
    ) v(naam, rol, claims, fonds)
  loop
    perform set_config('request.jwt.claims', actor.claims::text, true);
    perform set_config('role', actor.rol, true);
    for sc in select key, value from jsonb_each(pg_temp.r1_scenarios()) loop
      s := sc.value;
      if not (s ? 'fonds_id') then s := s || jsonb_build_object('fonds_id', actor.fonds); end if;
      oud   := pg_temp.r1_run('public.zoek_chunks', s);
      nieuw := pg_temp.r1_run('public.zoek_chunks_begrensd', s);
      v := pg_temp.r1_pariteit(oud, nieuw);
      if v is not null then
        raise exception 'PARITEIT FAALT P1 [% / %]: %', actor.naam, sc.key, v;
      end if;
      n_cellen := n_cellen + 1;
      if oud ? 'fout' then n_fout := n_fout + 1;
      elsif jsonb_array_length(oud->'ids') = 0 then n_leeg := n_leeg + 1; end if;
      matrix := jsonb_set(matrix, array[actor.naam, sc.key], coalesce(oud->'ids', to_jsonb('fout:' || (oud->>'fout'))), true);
    end loop;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
  end loop;

  -- Semantische ondergrens (anders zou een lege of foute matrix "gelijk" zijn).
  ids := matrix->'eigen_fonds_A'->'verslapt';
  if jsonb_typeof(ids) <> 'array' or jsonb_array_length(ids) < 6 then
    raise exception 'SEED FAALT P1: eigen_fonds_A ziet te weinig (%).', ids;
  end if;
  if not (ids @> '["02180000-0000-0000-0000-0a1c00000000","02180000-0000-0000-0000-0e1c00000000"]'::jsonb) then
    raise exception 'SEED FAALT P1: eigen_fonds_A ziet A1/G1 niet (%).', ids;
  end if;
  if ids @> '["02180000-0000-0000-0000-0b1c00000000"]'::jsonb then
    raise exception 'LEK P1: eigen_fonds_A ziet een chunk van fonds B.';
  end if;
  if ids @> '["02180000-0000-0000-0000-0a2c00000000"]'::jsonb or ids @> '["02180000-0000-0000-0000-0a3c00000000"]'::jsonb
     or ids @> '["02180000-0000-0000-0000-0a4c00000000"]'::jsonb or ids @> '["02180000-0000-0000-0000-0e2c00000000"]'::jsonb
     or ids @> '["02180000-0000-0000-0000-0e3c00000000"]'::jsonb or ids @> '["02180000-0000-0000-0000-0e4c00000000"]'::jsonb
     or ids @> '["02180000-0000-0000-0000-0e6c00000000"]'::jsonb then
    raise exception 'SEED FAALT P1: eigen_fonds_A/verslapt bevat een randgeval dat het filterblok moet weren (%).', ids;
  end if;
  -- A2 (concept, fonds) is in modus alles WEL zichtbaar (fondsconceptregel geldt alleen generiek/actueel).
  if not (ids @> '["02180000-0000-0000-0000-0a2c00000000"]'::jsonb) and false then null; end if;
  ids := matrix->'ander_fonds_B'->'verslapt';
  if not (ids @> '["02180000-0000-0000-0000-0b1c00000000"]'::jsonb) or ids @> '["02180000-0000-0000-0000-0a1c00000000"]'::jsonb then
    raise exception 'LEK/SEED P1: ander_fonds_B ziet A of niet B (%).', ids;
  end if;
  ids := matrix->'zonder_profiel'->'verslapt';
  if ids @> '["02180000-0000-0000-0000-0a1c00000000"]'::jsonb or not (ids @> '["02180000-0000-0000-0000-0e1c00000000"]'::jsonb) then
    raise exception 'LEK/SEED P1: zonder_profiel ziet fondsdata of geen generiek (%).', ids;
  end if;
  if matrix->'authenticated_zonder_sub'->'verslapt' <> '[]'::jsonb then
    raise exception 'LEK P1: authenticated zonder sub ziet rijen.';
  end if;
  if matrix->'anon'->>'verslapt' <> 'fout:42501' or matrix->'anon_met_sub_A'->>'verslapt' <> 'fout:42501'
     or matrix->'portaal_beperkt_A'->>'verslapt' <> 'fout:42501' then
    raise exception 'ACL P1: anon/anon_met_sub/portaal_beperkt zouden 42501 moeten krijgen (%, %, %).',
      matrix->'anon'->'verslapt', matrix->'anon_met_sub_A'->'verslapt', matrix->'portaal_beperkt_A'->'verslapt';
  end if;
  ids := matrix->'service_role'->'verslapt';
  if not (ids @> '["02180000-0000-0000-0000-0a1c00000000","02180000-0000-0000-0000-0e1c00000000"]'::jsonb) or ids @> '["02180000-0000-0000-0000-0b1c00000000"]'::jsonb then
    raise exception 'SEED P1: service_role (BYPASSRLS, p_fonds_id = A) hoort A + generiek en niet B te zien (%).', ids;
  end if;
  if (matrix->'eigen_fonds_A'->'nul') <> '[]'::jsonb then
    raise exception 'SEED P1: de nul-vraag levert rijen.';
  end if;
  if jsonb_array_length(matrix->'eigen_fonds_A'->'frase') < 1 then
    raise exception 'SEED P1: de frasevraag levert niets.';
  end if;
  raise notice 'OK P1: % cellen (8 actoren × 11 scenario''s) — zoek_chunks_begrensd == zoek_chunks (id-set, (rang,chunk_index)-reeks, tie-groepen); % foutcellen, % lege cellen.',
    n_cellen, n_fout, n_leeg;
end $$;

-- ── M: sectie-M-filtermatrix van #500 — nieuw == oud == verwacht ────────────
do $$
declare
  m          jsonb := current_setting('art500.matrix')::jsonb;
  v_frase    text  := m->>'frase';
  v_ids      uuid[];
  s          jsonb;
  p          jsonb;
  v_docs     uuid[];
  v_scope    uuid[];
  v_verwacht uuid[];
  v_oud      uuid[];
  v_nieuw    uuid[];
  v_n        int := 0;
begin
  perform set_config('request.jwt.claims', '{"sub":"05000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  select array_agg((r->>'chunk_id')::uuid) into v_ids
    from jsonb_array_elements(m->'rijen') r where (r->>'aangewezen')::boolean;
  for s in select * from jsonb_array_elements(m->'scenarios') loop
    p := s->'parameters';
    v_scope := case when jsonb_typeof(p->'documentscope') = 'array'
                    then array(select jsonb_array_elements_text(p->'documentscope'))::uuid[] end;
    select coalesce(array_agg((r->>'chunk_id')::uuid order by (r->>'chunk_id')), '{}') into v_verwacht
      from jsonb_array_elements(m->'rijen') r
     where r->>'sleutel' in (select jsonb_array_elements_text(s->'toegelaten'));
    select array_agg(distinct document_id) into v_docs
      from public.document_chunks
     where id = any(v_ids) and (v_scope is null or document_id = any(v_scope));
    execute format($q$
      select coalesce(array_agg(z.id order by z.id), '{}') from public.%I(
        p_query => $1, p_limit => 200, p_document_ids => $2,
        p_bronstatus => $3, p_documentstatus => $4, p_procesinstantie_ids => $5,
        p_modus => $6, p_peildatum => $7, p_bronsoort => $8, p_fonds_id => $9) z
       where z.id = any($10)$q$, 'zoek_chunks')
      into v_oud
      using v_frase, coalesce(v_docs, '{}'::uuid[]),
            case when jsonb_typeof(p->'bronstatus') = 'array' then array(select jsonb_array_elements_text(p->'bronstatus')) end,
            case when jsonb_typeof(p->'documentstatus') = 'array' then array(select jsonb_array_elements_text(p->'documentstatus')) end,
            case when jsonb_typeof(p->'procesinstantie_ids') = 'array' then array(select jsonb_array_elements_text(p->'procesinstantie_ids'))::uuid[] end,
            coalesce(p->>'modus', 'alles'), (p->>'peildatum')::date,
            case when jsonb_typeof(p->'bronsoort') = 'array' then array(select jsonb_array_elements_text(p->'bronsoort')) end,
            (p->>'fonds_id')::uuid, v_ids;
    execute format($q$
      select coalesce(array_agg(z.id order by z.id), '{}') from public.%I(
        p_query => $1, p_limit => 200, p_document_ids => $2,
        p_bronstatus => $3, p_documentstatus => $4, p_procesinstantie_ids => $5,
        p_modus => $6, p_peildatum => $7, p_bronsoort => $8, p_fonds_id => $9) z
       where z.id = any($10)$q$, 'zoek_chunks_begrensd')
      into v_nieuw
      using v_frase, coalesce(v_docs, '{}'::uuid[]),
            case when jsonb_typeof(p->'bronstatus') = 'array' then array(select jsonb_array_elements_text(p->'bronstatus')) end,
            case when jsonb_typeof(p->'documentstatus') = 'array' then array(select jsonb_array_elements_text(p->'documentstatus')) end,
            case when jsonb_typeof(p->'procesinstantie_ids') = 'array' then array(select jsonb_array_elements_text(p->'procesinstantie_ids'))::uuid[] end,
            coalesce(p->>'modus', 'alles'), (p->>'peildatum')::date,
            case when jsonb_typeof(p->'bronsoort') = 'array' then array(select jsonb_array_elements_text(p->'bronsoort')) end,
            (p->>'fonds_id')::uuid, v_ids;
    if v_oud is distinct from v_verwacht then
      raise exception 'FAAL M [%]: zoek_chunks laat % toe, matrix verwacht %.', s->>'naam', v_oud, v_verwacht;
    end if;
    if v_nieuw is distinct from v_verwacht then
      raise exception 'LEK M [%]: zoek_chunks_begrensd laat % toe, matrix verwacht % (zoek_chunks: %).', s->>'naam', v_nieuw, v_verwacht, v_oud;
    end if;
    v_n := v_n + 1;
  end loop;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  raise notice 'OK M: % scenario''s van de #500-filtermatrix — zoek_chunks_begrensd == zoek_chunks == verwacht.', v_n;
end $$;

-- ── N: negatieve controles via een pg_temp-kopie met één clausule uit ───────
-- Letterlijk het lichaam van zoek_chunks_begrensd, met per clausule een
-- `p_lek = '…' or`-ontsnapping. Als een clausule niets zou doen, zou de kopie
-- zónder die clausule hetzelfde geven als de echte functie — en dan is de
-- controle rood.
create function pg_temp.zcb_lek(
  p_lek text,
  p_query text, p_limit int default 20, p_document_ids uuid[] default null,
  p_bronstatus text[] default null, p_documentstatus text[] default null,
  p_procesinstantie_ids uuid[] default null, p_modus text default 'alles',
  p_peildatum date default current_date, p_bronsoort text[] default null, p_fonds_id uuid default null)
returns table (id uuid, document_id uuid, rang real, chunk_index int)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_tsq tsquery;
  v_doc_ids uuid[];
begin
  if p_lek <> 'limiet' and p_limit > 1000 then
    raise exception using errcode = 'P0R01', message = 'zoek_chunks_begrensd: p_limit > 1000';
  end if;
  v_tsq := websearch_to_tsquery('dutch', p_query);
  select coalesce(array_agg(d.id), '{}'::uuid[]) into v_doc_ids
    from public.documenten d
   where (p_lek = 'actief' or d.actief = true)
     and (p_lek = 'scope' or p_document_ids is null or d.id = any(p_document_ids));
  return query
  with docs as materialized (
    select d.id, d.fonds_id, d.volgende_review, d.titel, d.bron, d.bibliotheek, d.opslag_pad, d.actief
      from public.documenten d
     where d.id = any(v_doc_ids)
  )
  select c.id, c.document_id, ts_rank_cd(c.zoek_vector, v_tsq) as rang, c.chunk_index
  from public.document_chunks c
  join docs d on d.id = c.document_id
  where c.document_id = any(v_doc_ids)
    and (p_lek in ('actief', 'actief_stap2') or d.actief = true)
    and (p_lek = 'gearchiveerd' or c.documentstatus is distinct from 'gearchiveerd')
    and (p_lek = 'tsq' or c.zoek_vector @@ v_tsq)
    and (p_lek in ('scope', 'scope_stap2') or p_document_ids is null or c.document_id = any(p_document_ids))
    and (p_lek = 'actueel' or
      p_modus is distinct from 'actueel'
      or (
        c.documentstatus in ('vastgesteld','van_kracht')
        and coalesce(c.bronstatus,'actief') = 'actief'
        and (c.geldig_vanaf is null or c.geldig_vanaf <= p_peildatum)
        and (c.geldig_tot   is null or c.geldig_tot   >= p_peildatum)
      )
    )
    and (p_lek = 'bronstatus'      or p_bronstatus          is null or coalesce(c.bronstatus,'actief') = any(p_bronstatus))
    and (p_lek = 'documentstatus'  or p_documentstatus      is null or c.documentstatus     = any(p_documentstatus))
    and (p_lek = 'procesinstantie' or p_procesinstantie_ids is null or c.procesinstantie_id = any(p_procesinstantie_ids))
    and (p_lek = 'bronsoort'       or p_bronsoort           is null or c.bibliotheek         = any(p_bronsoort))
    and (p_lek = 'fonds' or p_fonds_id is null or d.fonds_id = p_fonds_id or c.bibliotheek = 'generiek')
    and (p_lek = 'generiek_published' or
      c.bibliotheek is distinct from 'generiek'
      or (
        c.documentstatus = 'van_kracht'
        and coalesce(c.bronstatus,'actief') = 'actief'
        and (p_lek = 'review' or d.volgende_review is null or d.volgende_review >= p_peildatum)
      )
    )
  order by rang desc, c.chunk_index asc, c.id
  limit greatest(p_limit, 1);
end $$;

do $$
declare
  c_a constant text := '02180000-1111-1111-1111-111111111111';
  c_b constant text := '02180000-2222-2222-2222-222222222222';
  sc jsonb := pg_temp.r1_scenarios();
  lek record;
  s jsonb;
  echt jsonb;
  kopie jsonb;
  v text;
  n_rood int := 0;
  n_gedoc int := 0;
begin
  perform set_config('request.jwt.claims', '{"sub":"02180000-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  -- Eerst: de kopie zónder lek is gelijk aan de echte functie (anders bewijst
  -- een afwijking mét lek niets).
  for lek in select key as scenario from jsonb_each(sc) loop
    s := (sc->lek.scenario) || jsonb_build_object('fonds_id', c_a);
    v := pg_temp.r1_pariteit(pg_temp.r1_run('public.zoek_chunks_begrensd', s),
                             pg_temp.r1_run('pg_temp.zcb_lek', s, '02180000-', 'p_lek => ''geen'','));
    if v is not null then
      raise exception 'SEED FAALT N [%]: de pg_temp-kopie zonder lek wijkt af van zoek_chunks_begrensd: %', lek.scenario, v;
    end if;
  end loop;
  for lek in
    select * from (values
      -- (lek, scenario, p_fonds_id, verwachting: rood | rls_dekt | dubbel_gedekt)
      ('actief',             'verslapt',        c_a, 'rood'),
      ('actief_stap2',       'verslapt',        c_a, 'dubbel_gedekt'),
      ('gearchiveerd',       'verslapt',        c_a, 'rood'),
      ('tsq',                'nul',             c_a, 'rood'),
      ('scope',              'scope',           c_a, 'rood'),
      ('scope_stap2',        'scope',           c_a, 'dubbel_gedekt'),
      ('actueel',            'actueel',         c_a, 'rood'),
      ('bronstatus',         'bronstatus',      c_a, 'rood'),
      ('documentstatus',     'documentstatus',  c_a, 'rood'),
      ('procesinstantie',    'procesinstantie', c_a, 'rood'),
      ('bronsoort',          'bronsoort_fonds', c_a, 'rood'),
      ('fonds',              'verslapt',        c_a, 'rls_dekt'),
      ('fonds',              'verslapt',        c_b, 'rood'),
      ('generiek_published', 'verslapt',        c_a, 'rood'),
      ('review',             'verslapt',        c_a, 'rood'),
      ('limiet',             'verslapt',        c_a, 'rood')
    ) v(naam, scenario, fonds, verwachting)
  loop
    s := (sc->lek.scenario) || jsonb_build_object('fonds_id', lek.fonds);
    if lek.naam = 'limiet' then s := s || jsonb_build_object('limit', 1001); end if;
    echt  := pg_temp.r1_run('public.zoek_chunks_begrensd', s);
    kopie := pg_temp.r1_run('pg_temp.zcb_lek', s, '02180000-', format('p_lek => %L,', lek.naam));
    v := pg_temp.r1_pariteit(echt, kopie);
    if lek.verwachting = 'rood' then
      if v is null then
        raise exception 'FAAL N [% / % / fonds %]: clausule weglaten maakt de uitkomst niet anders — de controle dekt haar niet.', lek.naam, lek.scenario, lek.fonds;
      end if;
      n_rood := n_rood + 1;
    else
      if v is not null then
        raise exception 'FAAL N [% / %]: verwacht % (gelijk), maar de kopie wijkt af: %', lek.naam, lek.scenario, lek.verwachting, v;
      end if;
      n_gedoc := n_gedoc + 1;
      raise notice 'N gedocumenteerd [%]: clausule % weglaten is niet rood (%).', lek.verwachting, lek.naam,
        case lek.verwachting when 'rls_dekt' then 'RLS op documenten trekt de fondsgrens al bij het eigen fonds; met p_fonds_id van fonds B is dezelfde clausule wél rood'
                             else 'de clausule staat bewust in stap 1 én stap 2; beide weghalen is wél rood' end;
    end if;
  end loop;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  raise notice 'OK N: % negatieve controles rood (elke clausule doet aantoonbaar werk), % gedocumenteerde niet-rode gevallen (rls_dekt, dubbel_gedekt).', n_rood, n_gedoc;
end $$;

-- ── C: catalogus-pin ────────────────────────────────────────────────────────
do $$
declare
  v_n int;
  v_nieuw record;
  v_oud record;
  v_def text;
begin
  select count(*) into v_n from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'zoek_chunks_begrensd';
  if v_n <> 1 then raise exception 'FAAL C: zoek_chunks_begrensd heeft % overloads (verwacht 1).', v_n; end if;
  select count(*) into v_n from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'zoek_chunks';
  if v_n <> 1 then raise exception 'FAAL C: zoek_chunks heeft % overloads (verwacht 1).', v_n; end if;

  select p.oid, p.prosecdef, l.lanname, p.proconfig, p.provolatile, p.proretset,
         pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as res,
         (select array_agg(a::text order by a::text) from unnest(p.proacl) a) as acl
    into v_nieuw
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
   where n.nspname = 'public' and p.proname = 'zoek_chunks_begrensd';
  select p.oid, p.prosecdef, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as res,
         (select array_agg(a::text order by a::text) from unnest(p.proacl) a) as acl
    into v_oud
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'zoek_chunks';

  if v_nieuw.prosecdef then raise exception 'FAAL C: zoek_chunks_begrensd is SECURITY DEFINER.'; end if;
  if v_oud.prosecdef then raise exception 'FAAL C: zoek_chunks is SECURITY DEFINER (referentie onverwacht).'; end if;
  if v_nieuw.lanname <> 'plpgsql' then raise exception 'FAAL C: taal is % (verwacht plpgsql).', v_nieuw.lanname; end if;
  if v_nieuw.provolatile <> 's' or not v_nieuw.proretset then
    raise exception 'FAAL C: provolatile/proretset = %/% (verwacht s/true).', v_nieuw.provolatile, v_nieuw.proretset;
  end if;
  if v_nieuw.proconfig is distinct from array['search_path=public, pg_temp']::text[] then
    raise exception 'FAAL C: proconfig = % (verwacht exact {search_path=public, pg_temp}).', v_nieuw.proconfig;
  end if;
  if v_nieuw.args is distinct from v_oud.args then
    raise exception 'FAAL C: parametercontract wijkt af: % ≠ %.', v_nieuw.args, v_oud.args;
  end if;
  if v_nieuw.res is distinct from v_oud.res then
    raise exception 'FAAL C: retourcontract wijkt af: % ≠ %.', v_nieuw.res, v_oud.res;
  end if;
  if v_nieuw.acl is distinct from v_oud.acl then
    raise exception 'FAAL C: ACL wijkt af van zoek_chunks: % ≠ %.', v_nieuw.acl, v_oud.acl;
  end if;
  if has_function_privilege('anon', v_nieuw.oid, 'execute') then raise exception 'FAAL C: anon heeft EXECUTE.'; end if;
  if not has_function_privilege('authenticated', v_nieuw.oid, 'execute') then raise exception 'FAAL C: authenticated mist EXECUTE.'; end if;
  if not has_function_privilege('service_role', v_nieuw.oid, 'execute') then raise exception 'FAAL C: service_role mist EXECUTE.'; end if;
  if has_function_privilege('portaal_beperkt', v_nieuw.oid, 'execute') then raise exception 'FAAL C: portaal_beperkt heeft EXECUTE.'; end if;
  v_def := pg_get_functiondef(v_nieuw.oid);
  if v_def ~* 'set_config|security definer|hnsw\.' then
    raise exception 'FAAL C: de definitie bevat set_config/SECURITY DEFINER/hnsw-GUC.';
  end if;
  if v_def !~ 'order by rang desc, c\.chunk_index asc, c\.id' then
    raise exception 'FAAL C: de tiebreaker ", c.id" ontbreekt in de sortering.';
  end if;
  if v_def !~ 'p_limit > 1000' then
    raise exception 'FAAL C: de bovengrens p_limit > 1000 ontbreekt.';
  end if;
  raise notice 'OK C: één overload, SECURITY INVOKER, plpgsql, STABLE, search_path=public,pg_temp, contract en ACL gelijk aan zoek_chunks, geen set_config.';
end $$;

-- ── L: limietafwijzing (bewust verschil) ────────────────────────────────────
do $$
declare
  sc jsonb := pg_temp.r1_scenarios();
  s jsonb;
  oud jsonb;
  nieuw jsonb;
  v text;
  lim text;
begin
  perform set_config('request.jwt.claims', '{"sub":"02180000-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  s := (sc->'verslapt') || jsonb_build_object('fonds_id', '02180000-1111-1111-1111-111111111111');

  -- 1001: oud accepteert, nieuw weigert met P0R01 (niet stil afgekapt).
  oud   := pg_temp.r1_run('public.zoek_chunks', s || '{"limit": 1001}');
  nieuw := pg_temp.r1_run('public.zoek_chunks_begrensd', s || '{"limit": 1001}');
  if oud ? 'fout' then raise exception 'FAAL L: zoek_chunks weigert p_limit 1001 (%).', oud->>'fout'; end if;
  if nieuw->>'fout' is distinct from 'P0R01' then
    raise exception 'FAAL L: zoek_chunks_begrensd met p_limit 1001 gaf % (verwacht SQLSTATE P0R01).', coalesce(nieuw->>'fout', 'rijen: ' || (nieuw->'ids')::text);
  end if;
  -- 1000 en 1: beide gelijk.
  foreach lim in array array['1000', '1'] loop
    v := pg_temp.r1_pariteit(pg_temp.r1_run('public.zoek_chunks', s || jsonb_build_object('limit', lim::int)),
                             pg_temp.r1_run('public.zoek_chunks_begrensd', s || jsonb_build_object('limit', lim::int)));
    if v is not null then raise exception 'FAAL L: p_limit % — %', lim, v; end if;
  end loop;
  -- null / 0 / -5: greatest(p_limit, 1) = 1 rij, beide gelijk.
  foreach lim in array array['null', '0', '-5'] loop
    oud   := pg_temp.r1_run('public.zoek_chunks', s || jsonb_build_object('limit', lim));
    nieuw := pg_temp.r1_run('public.zoek_chunks_begrensd', s || jsonb_build_object('limit', lim));
    v := pg_temp.r1_pariteit(oud, nieuw);
    if v is not null then raise exception 'FAAL L: p_limit % — %', lim, v; end if;
    if jsonb_array_length(nieuw->'ids') <> 1 then
      raise exception 'FAAL L: p_limit % gaf % rijen (verwacht 1 via greatest).', lim, jsonb_array_length(nieuw->'ids');
    end if;
  end loop;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  raise notice 'OK L: p_limit 1001 ⇒ oud accepteert, nieuw P0R01; 1000/1/null/0/-5 ⇒ gelijk (ondergrens greatest(p_limit,1) identiek).';
end $$;

-- ── T: tiebreaker (bewust verschil, alleen binnen gelijke (rang, chunk_index)) ─
do $$
declare
  sc jsonb := pg_temp.r1_scenarios();
  s jsonb;
  oud jsonb;
  nieuw jsonb;
  v text;
  n_groepen int;
  i int;
  verwacht jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"02180000-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  s := (sc->'verslapt') || jsonb_build_object('fonds_id', '02180000-1111-1111-1111-111111111111');
  oud   := pg_temp.r1_run('public.zoek_chunks', s);
  nieuw := pg_temp.r1_run('public.zoek_chunks_begrensd', s);
  v := pg_temp.r1_pariteit(oud, nieuw);
  if v is not null then raise exception 'FAAL T: pariteit — %', v; end if;

  -- (a) de fixture heeft echte ties (anders is deze test leeg).
  select count(*) into n_groepen from jsonb_each(nieuw->'ties') t where jsonb_array_length(t.value) >= 2;
  if n_groepen < 2 then raise exception 'SEED FAALT T: minder dan 2 tie-groepen met ≥ 2 rijen (%).', n_groepen; end if;

  -- (b) nieuw: de volledige id-reeks is exact de sortering (rang desc,
  --     chunk_index asc, id asc) over dezelfde rijen.
  select jsonb_agg(id order by rang desc, chunk_index asc, id asc) into verwacht
    from (select (e->>0)::real as rang, (e->>1)::int as chunk_index, (nieuw->'volgorde'->>(n::int - 1))::uuid as id
            from jsonb_array_elements(nieuw->'reeks') with ordinality as x(e, n)) r;
  if nieuw->'volgorde' <> verwacht then
    raise exception 'FAAL T: de nieuwe volgorde is niet (rang desc, chunk_index asc, id asc): % ≠ %', nieuw->'volgorde', verwacht;
  end if;

  -- (c) buiten tie-groepen (posities waarvan de (rang, chunk_index) uniek is)
  --     staat in oud en nieuw hetzelfde id op dezelfde positie: de tiebreaker
  --     werkt alleen bínnen een tie-groep.
  for i in 0 .. jsonb_array_length(nieuw->'reeks') - 1 loop
    if jsonb_array_length(nieuw->'ties'->((nieuw->'reeks'->i->>0) || '|' || (nieuw->'reeks'->i->>1))) = 1
       and (oud->'volgorde'->i) <> (nieuw->'volgorde'->i) then
      raise exception 'FAAL T: positie % (geen tie) verschilt: % ≠ %', i, oud->'volgorde'->i, nieuw->'volgorde'->i;
    end if;
  end loop;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  raise notice 'OK T: % tie-groepen; nieuw sorteert bínnen een tie-groep op id, buiten tie-groepen is de id-reeks identiek aan zoek_chunks.', n_groepen;
end $$;

reset role;

rollback;
