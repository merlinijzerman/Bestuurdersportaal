-- ============================================================================
-- R1 (besluit 0218) — performance-eis van `zoek_chunks_begrensd` (CI-light).
-- ----------------------------------------------------------------------------
-- Naar het patroon van 2026_09_29_500_artikelspoor_performance.sql: een
-- productie-achtige fixture (Productie 29-09-2026: 87 documenten, 18.418
-- chunks; Pensioenwet 968, MvT 2.738, 2× Besluit 625; drie fondsen; tekst ≈
-- 490 tekens met context_prefix; GIN op zoek_vector) en een meting ONDER
-- ECHTE RLS als authenticated (fondsgebruiker A, die 60 fondsdocumenten +
-- de generieke bibliotheek ziet):
--   P1 — 25 uitvoeringen van de strikte pilotvraag via zoek_chunks_begrensd
--        (de eerste apart gerapporteerd): elke uitvoering < 1 s en p95 < 500 ms.
--        Dezelfde (rang, chunk_index)-reeks als zoek_chunks (en dezelfde
--        id-set zolang de limiet niet in een tie-groep valt).
--   P2 — buffers (CPU-onafhankelijk): één EXPLAIN (ANALYZE, BUFFERS) per
--        functie; nieuw ≤ 1/3 van oud. Daarnaast informatief: verslapt
--        (OR-keten), nul treffers en documentscope.
--   P3 — plan-assert op het LETTERLIJKE functielichaam (uit pg_get_functiondef
--        gehaald, variabelen → parameters, als prepared statement onder RLS als
--        authenticated), in beide plancache-standen (force_custom_plan en
--        force_generic_plan): nergens
--        een `Seq Scan` op `documenten` met Actual Loops > 1 (de R0-planvorm:
--        documenten per chunkrij opnieuw scannen) en de chunks komen via
--        idx_chunks_document (generiek) of één seq scan (custom); nooit een
--        nested loop over documenten per chunkrij.
--   Gerapporteerd: aantal runs, mediaan, p95 en max — zonder trimming.
-- De verslapt-gate (p95 < 1,5 s op 0,25 vCPU) en de invariantie b0→b5000
-- zijn lokale bouwgates (tests/karakterisering/zoekpad-pr0-meting.mjs, route
-- R1prod), niet deze CI-check.
--
-- Self-seeding in één transactie met ROLLBACK — laat geen data achter.
-- Uitvoeren:  psql "$DB" -v ON_ERROR_STOP=1 -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw en afbraak; authenticated (fondsgebruiker A) voor
--      P1–P3 — tijd, buffers én planvorm worden onder RLS gemeten, niet onder
--      BYPASSRLS, want de RLS-subplans zijn precies wat de planvorm van
--      zoek_chunks duur maakte (en zonder RLS zou de GIN meedoen).
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;
select setseed(0.218);

insert into public.fondsen (id, naam, slug) values
  ('02181000-1111-1111-1111-111111111111', 'R1 perf fonds A', 'r1-perf-a'),
  ('02181000-2222-2222-2222-222222222222', 'R1 perf fonds B', 'r1-perf-b'),
  ('02181000-3333-3333-3333-333333333333', 'R1 perf fonds C', 'r1-perf-c');

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('02181000-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','r1-perf-a@test.local',
   '{"naam":"R1 Perf A","fonds_id":"02181000-1111-1111-1111-111111111111"}', now(), now());

create temp table r1_woorden on commit drop as
select string_to_array(
  'pensioen fonds deelnemer uitkering premie vermogen dekkingsgraad transitie regeling aanspraak ' ||
  'rechten overgang sociale partners werkgever werknemer compensatie evenwicht generaties besluit ' ||
  'bestuur toezicht wettelijk kader beleid risico beleggingen solidariteit reserve toedeling ' ||
  'collectieve waardeoverdracht invaren bezwaar informatie verantwoording raad verantwoordingsorgaan ' ||
  'belanghebbenden financiële opzet contract uitvoerder vastgesteld termijn datum lid onderdeel ' ||
  'bepaling toelichting wet regels minister nadere uitwerking evenwichtig transparant zorgvuldig ' ||
  'afweging keuze procedure plan implementatie jaar maand percentage rendement leeftijd cohort',
  ' ') as a;

insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief,
   documenttype, wetsgeschiedenis_subtype, dossiernummer, normgewicht, wettelijk_regime)
values
  ('02181000-0000-0000-0000-00000000a001', null, 'generiek', 'Extern', 'Pensioenwet',
   'van_kracht', 'actief', true, 'wetgeving', null, null, 'bindend', 'pw'),
  ('02181000-0000-0000-0000-00000000a002', null, 'generiek', 'Extern',
   'Memorie van toelichting — Kamerstukken II 2021/22, 36 067, nr. 3',
   'van_kracht', 'actief', true, 'wetsgeschiedenis', 'memorie_van_toelichting', '36067', 'informatief', 'beide'),
  ('02181000-0000-0000-0000-00000000a003', null, 'generiek', 'Extern', 'Besluit uitvoering Pensioenwet (deel 1)',
   'van_kracht', 'actief', true, null, null, null, 'bindend', 'pw'),
  ('02181000-0000-0000-0000-00000000a004', null, 'generiek', 'Extern', 'Besluit uitvoering Pensioenwet (deel 2)',
   'van_kracht', 'actief', true, null, null, null, 'bindend', 'pw');

-- 83 fondsdocumenten: 60 fonds A, 12 fonds B, 11 fonds C.
insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief)
select ('02181000-0000-0000-0000-' || lpad(to_hex(4096 + g), 12, '0'))::uuid,
       case when g <= 60 then '02181000-1111-1111-1111-111111111111'::uuid
            when g <= 72 then '02181000-2222-2222-2222-222222222222'::uuid
            else '02181000-3333-3333-3333-333333333333'::uuid end,
       'fonds', 'Intern', 'Fondsstuk ' || g, 'vastgesteld', 'actief', true
  from generate_series(1, 83) g;

create temp table r1_plan (document_id uuid, n int, soort text) on commit drop;
insert into r1_plan values
  ('02181000-0000-0000-0000-00000000a001', 968, 'pw'),
  ('02181000-0000-0000-0000-00000000a002', 2738, 'mvt'),
  ('02181000-0000-0000-0000-00000000a003', 313, 'besluit'),
  ('02181000-0000-0000-0000-00000000a004', 312, 'besluit');
insert into r1_plan
select ('02181000-0000-0000-0000-' || lpad(to_hex(4096 + g), 12, '0'))::uuid,
       case when g <= 60 then 170 else 169 end, 'fonds'
  from generate_series(1, 83) g;
-- 4 + 60×170 + 23×169 + 968 + 2738 + 625 = 18.418 chunks.

insert into public.document_chunks (document_id, chunk_index, pagina, tekst, structuur_type, structuur_label, context_prefix, embedding_model)
select p.document_id, i, i / 6 + 1,
       case
         when p.soort = 'mvt' and i = 2396 then E'Artikel 150d Pensioenwet en artikel 145c Wvb (Transitieplan)\n'
         when p.soort = 'pw' and i = 641 then E'Artikel 150d. Transitieplan\n'
         else ''
       end ||
       (select string_agg(w.a[1 + floor(random() * cardinality(w.a))::int], ' ')
          from generate_series(1, 62) k, r1_woorden w where i >= 0),
       'artikel',
       case when p.soort = 'pw' then 'Artikel ' || (i / 4 + 1)
            when p.soort = 'mvt' and i >= 2000 then 'Artikelsgewijze toelichting — Artikel ' || ((i - 2000) / 3 + 100)
            when p.soort = 'mvt' then '§' || (i / 40 + 1) || ' Algemeen deel'
            else 'Artikel ' || (i % 30 + 1) end,
       left('Artikel ' || i || ' — ' || (select titel from public.documenten d where d.id = p.document_id), 119),
       'r1-perf'
  from r1_plan p, generate_series(0, p.n - 1) i;

analyze public.documenten;
analyze public.document_chunks;
analyze public.profielen;

do $$
begin
  if (select count(*) from public.document_chunks where embedding_model = 'r1-perf') <> 18418 then
    raise exception 'SEED FAALT: de fixture heeft niet 18.418 chunks.';
  end if;
end $$;

-- ── Onder RLS, als fondsgebruiker A ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"02181000-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
set local statement_timeout = '8s';  -- de productiegrens van authenticator/authenticated

-- ── P3: plan-assert op het letterlijke functielichaam, ONDER RLS (als
--       authenticated: prepared statement met de RLS-subplans erbij, in beide
--       plancache-standen) ──────────────────────────────────────────────────
do $$
declare
  v_def  text;
  v_body text;
  v_stand text;
  v_plan jsonb;
  v_tekst text;
  v_seq_doc_loops int;
  v_nested_doc int;
  v_docs uuid[];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'zoek_chunks_begrensd';
  -- Het `return query`-blok tot en met de limit, variabelen → parameters.
  v_body := substring(v_def from 'return query\s+(with docs as materialized[\s\S]*?limit greatest\(p_limit, 1\));');
  if v_body is null then
    raise exception 'FAAL P3: het return-query-blok is niet uit de functiedefinitie te halen (vorm gewijzigd?).';
  end if;
  v_body := replace(v_body, 'v_tsq', '$1::tsquery');
  v_body := replace(v_body, 'v_doc_ids', '$2::uuid[]');
  v_body := replace(v_body, 'p_document_ids', '$3::uuid[]');
  v_body := replace(v_body, 'p_modus', '$4::text');
  v_body := replace(v_body, 'p_peildatum', '$5::date');
  v_body := replace(v_body, 'p_bronstatus', '$6::text[]');
  v_body := replace(v_body, 'p_documentstatus', '$7::text[]');
  v_body := replace(v_body, 'p_procesinstantie_ids', '$8::uuid[]');
  v_body := replace(v_body, 'p_bronsoort', '$9::text[]');
  v_body := replace(v_body, 'p_fonds_id', '$10::uuid');
  v_body := replace(v_body, 'p_limit', '$11::int');
  execute 'prepare r1_lichaam(tsquery, uuid[], uuid[], text, date, text[], text[], uuid[], text[], uuid, int) as ' || v_body;

  -- Stap 1 van de functie, onder RLS: wat fondsgebruiker A ziet en actief is.
  select array_agg(id) into v_docs from public.documenten
   where id::text like '02181000-0000-0000-0000-%' and actief;
  foreach v_stand in array array['force_custom_plan', 'force_generic_plan'] loop
    execute format('set local plan_cache_mode = %s', v_stand);
    execute format($q$explain (analyze, buffers, format json) execute r1_lichaam(
      websearch_to_tsquery('dutch', 'Wat was de bedoeling van de wetgever bij artikel 150d Pensioenwet?'),
      %L::uuid[], null, 'actueel', date '2026-10-03', null, null, null, array['fonds','generiek'],
      '02181000-1111-1111-1111-111111111111', 30)$q$, v_docs) into v_plan;
    v_tekst := v_plan::text;
    -- Seq scans op documenten met meer dan één loop = de R0-vorm.
    select count(*) into v_seq_doc_loops
      from jsonb_path_query(v_plan, 'strict $.**  ? (@."Node Type" == "Seq Scan" && @."Relation Name" == "documenten" && @."Actual Loops" > 1)');
    select count(*) into v_nested_doc
      from jsonb_path_query(v_plan, 'strict $.** ? (@."Node Type" == "Index Scan" && @."Relation Name" == "documenten" && @."Actual Loops" > 1)');
    if v_seq_doc_loops > 0 then
      raise exception 'FAAL P3 [%]: seq scan op documenten met > 1 loops (documenten per chunkrij).', v_stand;
    end if;
    if v_nested_doc > 0 then
      raise exception 'FAAL P3 [%]: index scan op documenten per chunkrij (nested loop over documenten).', v_stand;
    end if;
    if v_tekst not like '%idx_chunks_document%' and v_tekst not like '%"Relation Name": "document_chunks"%' then
      raise exception 'FAAL P3 [%]: geen scan op document_chunks gevonden?', v_stand;
    end if;
    raise notice 'OK P3 [%]: chunks via % — geen seq scan/nested loop op documenten per chunkrij; buffers %.',
      v_stand,
      case when v_tekst like '%idx_chunks_document%' then 'idx_chunks_document' else 'één seq scan + id-filter' end,
      (v_plan->0->'Plan'->>'Shared Hit Blocks')::bigint + (v_plan->0->'Plan'->>'Shared Read Blocks')::bigint;
  end loop;
  execute 'deallocate r1_lichaam';
  execute 'set local plan_cache_mode = auto';
end $$;

do $$
declare
  v_fonds constant uuid := '02181000-1111-1111-1111-111111111111';
  v_peil  constant date := date '2026-10-03';
  v_strikt constant text := 'Wat was de bedoeling van de wetgever bij artikel 150d Pensioenwet?';
  v_verslapt constant text := 'bedoeling or wetgever or artikel or 150d or pensioenwet';
  v_nul constant text := 'zzqxv plonkzz';
  -- Vergelijkingsvorm: id-set (alleen betekenisvol als de limiet niet is
  -- bereikt — anders kan de tiebreaker aan de grens andere id's kiezen, het
  -- bewuste verschil uit 0218) en de geordende (rang, chunk_index)-reeks.
  q_nieuw constant text := $q$select jsonb_build_object('ids', coalesce(jsonb_agg(z.id order by z.id), '[]'),
      'reeks', coalesce(jsonb_agg(jsonb_build_array(z.rang, z.chunk_index) order by z.rang desc, z.chunk_index), '[]')) from public.zoek_chunks_begrensd(
      p_query => $1, p_limit => 30, p_document_ids => $2, p_modus => 'actueel', p_peildatum => $3,
      p_bronsoort => array['fonds','generiek'], p_fonds_id => $4) z$q$;
  q_oud constant text := $q$select jsonb_build_object('ids', coalesce(jsonb_agg(z.id order by z.id), '[]'),
      'reeks', coalesce(jsonb_agg(jsonb_build_array(z.rang, z.chunk_index) order by z.rang desc, z.chunk_index), '[]')) from public.zoek_chunks(
      p_query => $1, p_limit => 30, p_document_ids => $2, p_modus => 'actueel', p_peildatum => $3,
      p_bronsoort => array['fonds','generiek'], p_fonds_id => $4) z$q$;
  v_ids_nieuw jsonb; v_ids_oud jsonb;
  t0 timestamptz;
  v_t numeric[] := '{}';
  v_plan json;
  v_buf_nieuw bigint; v_buf_oud bigint; v_buf bigint;
  r record;
  i int;
  v_var record;
  v_scope uuid[] := array['02181000-0000-0000-0000-00000000a001', '02181000-0000-0000-0000-00000000a002']::uuid[];
begin
  -- P1: 25 runs strikt via de nieuwe functie.
  for i in 1..25 loop
    t0 := clock_timestamp();
    execute q_nieuw into v_ids_nieuw using v_strikt, null::uuid[], v_peil, v_fonds;
    v_t := v_t || (extract(epoch from clock_timestamp() - t0) * 1000);
    if i = 1 then raise notice 'P1 eerste uitvoering: % ms', round(v_t[1], 2); end if;
    if v_t[i] >= 1000 then
      raise exception 'FAAL P1: uitvoering % duurde % ms (grens 1 s).', i, round(v_t[i]);
    end if;
  end loop;
  select percentile_disc(0.5) within group (order by t) as p50, percentile_disc(0.95) within group (order by t) as p95,
         max(t) as mx, count(*) as n into r from unnest(v_t) t;
  raise notice 'P1 zoek_chunks_begrensd strikt onder RLS, % runs: mediaan % ms, p95 % ms, max % ms.',
    r.n, round(r.p50, 2), round(r.p95, 2), round(r.mx, 2);
  if r.p95 >= 500 then
    raise exception 'FAAL P1: p95 % ms ≥ 500 ms.', round(r.p95);
  end if;
  -- Dezelfde rijen als zoek_chunks.
  execute q_oud into v_ids_oud using v_strikt, null::uuid[], v_peil, v_fonds;
  if v_ids_nieuw->'reeks' is distinct from v_ids_oud->'reeks'
     or (jsonb_array_length(coalesce(v_ids_nieuw->'ids', '[]')) < 30 and v_ids_nieuw->'ids' is distinct from v_ids_oud->'ids') then
    raise exception 'FAAL P1: uitkomst wijkt af van zoek_chunks (% ≠ %).', v_ids_nieuw, v_ids_oud;
  end if;

  -- P2: buffers (CPU-onafhankelijk), nieuw ≤ 1/3 oud.
  execute 'explain (analyze, buffers, format json) ' || q_nieuw into v_plan using v_strikt, null::uuid[], v_peil, v_fonds;
  v_buf_nieuw := (v_plan->0->'Plan'->>'Shared Hit Blocks')::bigint + (v_plan->0->'Plan'->>'Shared Read Blocks')::bigint;
  execute 'explain (analyze, buffers, format json) ' || q_oud into v_plan using v_strikt, null::uuid[], v_peil, v_fonds;
  v_buf_oud := (v_plan->0->'Plan'->>'Shared Hit Blocks')::bigint + (v_plan->0->'Plan'->>'Shared Read Blocks')::bigint;
  raise notice 'P2 buffers strikt: nieuw %, oud % (%×).', v_buf_nieuw, v_buf_oud, round(v_buf_oud::numeric / greatest(v_buf_nieuw, 1), 1);
  if v_buf_nieuw * 3 > v_buf_oud then
    raise exception 'FAAL P2: nieuw (% buffers) is niet ≤ 1/3 van oud (% buffers).', v_buf_nieuw, v_buf_oud;
  end if;

  -- Informatief: verslapt, nul treffers, documentscope (tijd p50/p95 over 5 runs + buffers).
  for v_var in select * from (values ('verslapt', v_verslapt, null::uuid[]), ('nul', v_nul, null::uuid[]), ('scope', v_strikt, v_scope)) v(naam, q, scope) loop
    v_t := '{}';
    for i in 1..5 loop
      t0 := clock_timestamp();
      execute q_nieuw into v_ids_nieuw using v_var.q, v_var.scope, v_peil, v_fonds;
      v_t := v_t || (extract(epoch from clock_timestamp() - t0) * 1000);
    end loop;
    execute q_oud into v_ids_oud using v_var.q, v_var.scope, v_peil, v_fonds;
    if v_ids_nieuw->'reeks' is distinct from v_ids_oud->'reeks'
       or (jsonb_array_length(coalesce(v_ids_nieuw->'ids', '[]')) < 30 and v_ids_nieuw->'ids' is distinct from v_ids_oud->'ids') then
      raise exception 'FAAL P2 [%]: uitkomst wijkt af van zoek_chunks (% ≠ %).', v_var.naam, v_ids_nieuw, v_ids_oud;
    end if;
    execute 'explain (analyze, buffers, format json) ' || q_nieuw into v_plan using v_var.q, v_var.scope, v_peil, v_fonds;
    v_buf := (v_plan->0->'Plan'->>'Shared Hit Blocks')::bigint + (v_plan->0->'Plan'->>'Shared Read Blocks')::bigint;
    select percentile_disc(0.5) within group (order by t) as p50, percentile_disc(0.95) within group (order by t) as p95,
           max(t) as mx into r from unnest(v_t) t;
    raise notice 'P2 informatief [%]: nieuw mediaan % ms, p95 % ms, max % ms, buffers %; (rang, chunk_index)-reeks == zoek_chunks.',
      v_var.naam, round(r.p50, 2), round(r.p95, 2), round(r.mx, 2), v_buf;
  end loop;
  raise notice 'OK P1/P2: strikt p95 < 500 ms onder RLS; buffers nieuw ≤ 1/3 oud; id-sets gelijk aan zoek_chunks.';
end $$;

reset role;

rollback;
