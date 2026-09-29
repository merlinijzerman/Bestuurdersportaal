-- ============================================================================
-- #500 hotfix productietime-out — performance-eis van het artikelspoor.
-- ----------------------------------------------------------------------------
-- Op Productie eindigde de toelating van het artikelspoor via
-- `zoek_chunks(p_limit => 200, p_document_ids => …)` in 57014 (8 s
-- statement_timeout). In het CONCRETE plan werd het GIN-pad niet gekozen: de
-- combinatie van de RLS-policy (auth.uid() per rij, plus de tweede permissive
-- ALL-policy via OR), de functievorm (`cross join websearch_to_tsquery`) en
-- het niet-leakproof `@@`-predicaat gaf een seq scan over alle chunks, met
-- een nested loop die `documenten` per chunkrij opnieuw scande.
--
-- De app (core/lib/rag.ts, `vulAanMetArtikelkandidaten`) doet nu:
--   Q1  documenten: juridische typen, actief (klein);
--   Q2  opzoeking: document_chunks binnen die document_id's (idx_chunks_document)
--       met de exacte woordgrenspatronen, limit 50;
--   Q3  toelating: document_chunks?id=in.(…) met het zoek_chunks-filterblok
--       (core/lib/retrieval/artikeltoelating.ts), limit 50.
-- De queries hieronder zijn letterlijk de SQL die PostgREST ervoor genereert.
--
-- Deze check bouwt een PRODUCTIE-ACHTIGE fixture (Productie 29-09-2026: 87
-- documenten, 18.418 chunks; Pensioenwet 968 chunks, MvT 36 067 nr. 3 2.738
-- chunks, 2× "Besluit uitvoering…" 625 chunks zonder documenttype; tekst ≈ 490
-- tekens, context_prefix ≈ 120; embeddings vector(1024) met HNSW, GIN op
-- zoek_vector; drie fondsen) en meet ONDER ECHTE RLS als authenticated:
--   P1 — 25 uitvoeringen van Q1+Q2+Q3 (de eerste apart gerapporteerd):
--        elke uitvoering < 1 s en p95 < 500 ms. De exacte passages (MvT
--        p.395 en Pensioenwet artikel 150d) worden gevonden en toegelaten.
--   P2 — negatieve controle: de OUDE toelating via zoek_chunks op dezelfde
--        fixture is aantoonbaar zwaarder: ≥ 3× de buffers van het hele nieuwe
--        spoor en een ≥ 3× hogere mediaan dan de nieuwe toelating (Q3).
--   Gerapporteerd: aantal runs, mediaan, p95 en max — zonder trimming.
--
-- Self-seeding in één transactie met ROLLBACK — laat geen data achter.
-- Uitvoeren:  psql "$DB" -f dit-bestand
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw en afbraak; authenticated (fondsgebruiker A) voor
--      P1–P2 — de tijd wordt onder RLS gemeten, niet onder BYPASSRLS, want
--      juist de RLS-evaluatie maakte het oude pad traag.
--      (verplicht en machineleesbaar — zie ROL-1 in
--       tests/cross-tenant/checksuite-rolverklaring.test.ts voor het waarom)
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on
-- Alleen voor de lokale eind-tot-eindketen (tests/karakterisering/
-- artikelspoor-500-keten.mjs): `-v art500_fonds_a=<fonds>` hangt de 60
-- fondsdocumenten aan een bestaand fonds, `-v art500_behoud=1` sluit af met
-- COMMIT in plaats van ROLLBACK. CI zet geen van beide.
\if :{?art500_fonds_a}
\else
\set art500_fonds_a '05002000-1111-1111-1111-111111111111'
\endif

begin;
select set_config('art500.fonds_a', :'art500_fonds_a', true);

select setseed(0.500);

insert into public.fondsen (id, naam, slug) values
  (:'art500_fonds_a', 'Perf fonds A', 'art500-perf-a'),
  ('05002000-2222-2222-2222-222222222222', 'Perf fonds B', 'art500-perf-b'),
  ('05002000-3333-3333-3333-333333333333', 'Perf fonds C', 'art500-perf-c')
on conflict do nothing;

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values
  ('05002000-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','art500-perf-a@test.local',
   json_build_object('naam', 'Perf A', 'fonds_id', :'art500_fonds_a')::jsonb, now(), now());

-- Woordenschat voor de tekst (Nederlandstalig, zodat de 'dutch'-tsvector realistisch is).
create temp table art500_woorden on commit drop as
select string_to_array(
  'pensioen fonds deelnemer uitkering premie vermogen dekkingsgraad transitie regeling aanspraak ' ||
  'rechten overgang sociale partners werkgever werknemer compensatie evenwicht generaties besluit ' ||
  'bestuur toezicht wettelijk kader beleid risico beleggingen solidariteit reserve toedeling ' ||
  'collectieve waardeoverdracht invaren bezwaar informatie verantwoording raad verantwoordingsorgaan ' ||
  'belanghebbenden financiële opzet contract uitvoerder vastgesteld termijn datum lid onderdeel ' ||
  'bepaling toelichting wet regels minister nadere uitwerking evenwichtig transparant zorgvuldig ' ||
  'afweging keuze procedure plan implementatie jaar maand percentage rendement leeftijd cohort',
  ' ') as a;

-- ── Documenten ──────────────────────────────────────────────────────────────
insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief,
   documenttype, wetsgeschiedenis_subtype, dossiernummer, normgewicht, wettelijk_regime)
values
  ('05002000-0000-0000-0000-00000000a001', null, 'generiek', 'Extern', 'Pensioenwet',
   'van_kracht', 'actief', true, 'wetgeving', null, null, 'bindend', 'pw'),
  ('05002000-0000-0000-0000-00000000a002', null, 'generiek', 'Extern',
   'Memorie van toelichting — Kamerstukken II 2021/22, 36 067, nr. 3',
   'van_kracht', 'actief', true, 'wetsgeschiedenis', 'memorie_van_toelichting', '36067', 'informatief', 'beide'),
  ('05002000-0000-0000-0000-00000000a003', null, 'generiek', 'Extern', 'Besluit uitvoering Pensioenwet (deel 1)',
   'van_kracht', 'actief', true, null, null, null, 'bindend', 'pw'),
  ('05002000-0000-0000-0000-00000000a004', null, 'generiek', 'Extern', 'Besluit uitvoering Pensioenwet (deel 2)',
   'van_kracht', 'actief', true, null, null, null, 'bindend', 'pw');

-- 83 fondsdocumenten: 60 fonds A, 12 fonds B, 11 fonds C.
insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief)
select ('05002000-0000-0000-0000-' || lpad(to_hex(4096 + g), 12, '0'))::uuid,
       case when g <= 60 then :'art500_fonds_a'::uuid
            when g <= 72 then '05002000-2222-2222-2222-222222222222'::uuid
            else '05002000-3333-3333-3333-333333333333'::uuid end,
       'fonds', 'Intern', 'Fondsstuk ' || g, 'vastgesteld', 'actief', true
  from generate_series(1, 83) g;

-- ── Chunks ──────────────────────────────────────────────────────────────────
-- Plan: (document, aantal, labelfunctie). Pensioenwet: "Artikel N" (4 chunks per
-- artikel, 150d op 641/642 en 673/674 zoals Productie); MvT: 2.000 chunks
-- algemeen deel, daarna "Artikelsgewijze toelichting — Artikel N" (150d op
-- 2396–2400 met de kopregel op 2396, p. 395); fondsstukken ≈ 170 chunks,
-- waaronder reglementsartikelen ("Artikel 5") die nooit juridisch zijn.
create temp table art500_plan (document_id uuid, n int, soort text) on commit drop;
insert into art500_plan values
  ('05002000-0000-0000-0000-00000000a001', 968, 'pw'),
  ('05002000-0000-0000-0000-00000000a002', 2738, 'mvt'),
  ('05002000-0000-0000-0000-00000000a003', 313, 'besluit'),
  ('05002000-0000-0000-0000-00000000a004', 312, 'besluit');
insert into art500_plan
select ('05002000-0000-0000-0000-' || lpad(to_hex(4096 + g), 12, '0'))::uuid,
       case when g <= 60 then 170 else 169 end, 'fonds'
  from generate_series(1, 83) g;
-- 4 + 60×170 + 23×169 + 968 + 2738 + 625 = 18.418 chunks.

create temp table art500_chunks on commit drop as
select p.document_id, i as chunk_index, p.soort,
       case
         when p.soort = 'pw' and i in (641, 642, 673, 674) then 'Artikel 150d'
         when p.soort = 'pw' then 'Artikel ' || (i / 4 + 1)
         when p.soort = 'mvt' and i between 2396 and 2400 then 'Artikelsgewijze toelichting — Artikel 150d'
         when p.soort = 'mvt' and i >= 2000 then 'Artikelsgewijze toelichting — Artikel ' || ((i - 2000) / 3 + 100)
         when p.soort = 'mvt' then '§' || (i / 40 + 1) || ' Algemeen deel'
         when p.soort = 'besluit' then 'Artikel ' || (i / 5 + 1)
         else 'Artikel ' || (i % 30 + 1)
       end as label
  from art500_plan p, generate_series(0, p.n - 1) i;

insert into public.document_chunks
  (document_id, chunk_index, pagina, tekst, structuur_type, structuur_label, context_prefix, embedding, embedding_model)
select c.document_id, c.chunk_index,
       case when c.soort = 'mvt' and c.chunk_index = 2396 then 395 else c.chunk_index / 6 + 1 end,
       case
         when c.soort = 'mvt' and c.chunk_index = 2396
           then E'Artikel 150d Pensioenwet en artikel 145c Wvb (Transitieplan)\n'
         when c.soort = 'pw' and c.chunk_index % 4 = 0 then c.label || E'. Opschrift\n'
         when c.soort = 'pw' and c.chunk_index = 641 then E'Artikel 150d. Transitieplan\n'
         else ''
       end ||
       (select string_agg(w.a[1 + floor(random() * cardinality(w.a))::int], ' ')
          from generate_series(1, 62) k, art500_woorden w
         where c.chunk_index >= 0),
       'artikel', c.label,
       left(c.label || ' — ' || (select titel from public.documenten d where d.id = c.document_id), 119),
       (select array_agg(random()::real) from generate_series(1, 1024) g where c.chunk_index >= 0)::vector(1024),
       'art500-perf'
  from art500_chunks c;

-- Versiebewijs zoals op Productie (bestand_hash + indexering_versie), zodat de
-- centrale toelatingspoort de passages in de eind-tot-eindketen niet weigert.
update public.documenten set bestand_hash = encode(sha256(convert_to(id::text, 'UTF8')), 'hex')
 where id in (select document_id from art500_plan);
update public.document_chunks set indexering_versie = 'art500-perf-v1'
 where embedding_model = 'art500-perf';

analyze public.documenten;
analyze public.document_chunks;
analyze public.profielen;

do $$
begin
  if (select count(*) from public.document_chunks where embedding_model = 'art500-perf') <> 18418
     or (select count(distinct tekst) from public.document_chunks where embedding_model = 'art500-perf') < 18000 then
    raise exception 'SEED FAALT P: de fixture heeft niet 18.418 (verschillende) chunks.';
  end if;
end $$;

-- ── Onder RLS, als fondsgebruiker A ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"05002000-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
set local statement_timeout = '8s';  -- de productiegrens van authenticator/authenticated

do $$
declare
  -- De drie queries LETTERLIJK zoals PostgREST ze voor supabase-js genereert
  -- (vastgelegd met log_statement op de lokale stack, 29-09-2026), met dezelfde
  -- parametervolgorde. PostgREST voert ze uit als eenmalig prepared statement.
  -- Q1: documenten?select=id&documenttype=in.(…)&actief=eq.true&order=id&limit=200
  q1 constant text := $q$WITH pgrst_source AS ( SELECT "public"."documenten"."id" FROM "public"."documenten" WHERE  "public"."documenten"."documenttype" = ANY ($1)  AND  "public"."documenten"."actief" = $2  ORDER BY "public"."documenten"."id" ASC  LIMIT $3 OFFSET $4 )  SELECT null::bigint AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total, coalesce(json_agg(_postgrest_t), '[]') AS body, nullif(current_setting('response.headers', true), '') AS response_headers, nullif(current_setting('response.status', true), '') AS response_status, '' AS response_inserted FROM ( SELECT * FROM pgrst_source ) _postgrest_t$q$;
  -- Q2: document_chunks?select=id,document_id,tekst,structuur_label&document_id=in.(…)&or=(…imatch…)&order=document_id,chunk_index&limit=50
  q2 constant text := $q$WITH pgrst_source AS ( SELECT "public"."document_chunks"."id", "public"."document_chunks"."document_id", "public"."document_chunks"."tekst", "public"."document_chunks"."structuur_label" FROM "public"."document_chunks" WHERE  ( "public"."document_chunks"."structuur_label" ~* $1 OR  "public"."document_chunks"."tekst" ~* $2) AND  "public"."document_chunks"."document_id" = ANY ($3)   ORDER BY "public"."document_chunks"."document_id" ASC , "public"."document_chunks"."chunk_index" ASC  LIMIT $4 OFFSET $5 )  SELECT null::bigint AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total, coalesce(json_agg(_postgrest_t), '[]') AS body, nullif(current_setting('response.headers', true), '') AS response_headers, nullif(current_setting('response.status', true), '') AS response_status, '' AS response_inserted FROM ( SELECT * FROM pgrst_source ) _postgrest_t$q$;
  -- Q3: de toelating (TOELATING_SELECT + toelatingsfilters, productiefilterblok:
  --     modus actueel, peildatum, bronsoort fonds+generiek).
  q3 constant text := $q$WITH pgrst_source AS ( SELECT "public"."document_chunks"."id", "public"."document_chunks"."document_id", "public"."document_chunks"."tekst", "public"."document_chunks"."pagina", "public"."document_chunks"."paragraaf", "public"."document_chunks"."chunk_index", "public"."document_chunks"."documentstatus", "public"."document_chunks"."bronstatus", "public"."document_chunks"."documentdatum", "public"."document_chunks"."geldig_vanaf", "public"."document_chunks"."geldig_tot", "public"."document_chunks"."procesinstantie_id", "public"."document_chunks"."bronorganisatie", "public"."document_chunks"."normgewicht", "public"."document_chunks"."extern_url", "public"."document_chunks"."wettelijk_regime", "public"."document_chunks"."bibliotheek", row_to_json("document_chunks_documenten_1".*)::jsonb AS "documenten" FROM "public"."document_chunks" INNER JOIN LATERAL ( SELECT "documenten_1"."titel", "documenten_1"."bron", "documenten_1"."bibliotheek", "documenten_1"."opslag_pad", "documenten_1"."fonds_id", "documenten_1"."volgende_review", "documenten_1"."actief" FROM "public"."documenten" AS "documenten_1" WHERE  "documenten_1"."actief" = $1 AND "documenten_1"."id" = "public"."document_chunks"."document_id"   LIMIT $2 OFFSET $3 ) AS "document_chunks_documenten_1" ON TRUE WHERE  ( "public"."document_chunks"."documentstatus" IS NULL OR  "public"."document_chunks"."documentstatus" <> $4) AND  ( "public"."document_chunks"."bronstatus" IS NULL OR  "public"."document_chunks"."bronstatus" = $5) AND  ( "public"."document_chunks"."geldig_vanaf" IS NULL OR  "public"."document_chunks"."geldig_vanaf" <= $6) AND  ( "public"."document_chunks"."geldig_tot" IS NULL OR  "public"."document_chunks"."geldig_tot" >= $7) AND  ( "public"."document_chunks"."bibliotheek" IS NULL OR  "public"."document_chunks"."bibliotheek" <> $8 OR  ( "public"."document_chunks"."documentstatus" = $9 AND  ( "public"."document_chunks"."bronstatus" IS NULL OR  "public"."document_chunks"."bronstatus" = $10))) AND  "public"."document_chunks"."id" = ANY ($11)  AND  "public"."document_chunks"."zoek_vector" @@ websearch_to_tsquery($12, $13)  AND  "public"."document_chunks"."documentstatus" = ANY ($14)  AND  "public"."document_chunks"."bibliotheek" = ANY ($15)   ORDER BY "public"."document_chunks"."document_id" ASC , "public"."document_chunks"."chunk_index" ASC  LIMIT $16 OFFSET $17 )  SELECT null::bigint AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total, coalesce(json_agg(_postgrest_t), '[]') AS body, nullif(current_setting('response.headers', true), '') AS response_headers, nullif(current_setting('response.status', true), '') AS response_status, '' AS response_inserted FROM ( SELECT * FROM pgrst_source ) _postgrest_t$q$;
  -- id's uit de PostgREST-body
  ids constant text := 'select array(select (e->>''id'')::uuid from json_array_elements(x.body) e) from (%s) x';
  -- De oude toelating, precies zoals de app haar aanriep.
  q_oud constant text := $q$
    select z.id from public.zoek_chunks(
      p_query => $2, p_limit => 200,
      p_document_ids => array(select distinct c.document_id from public.document_chunks c where c.id = any($1)),
      p_modus => 'actueel', p_peildatum => $3, p_bronsoort => array['fonds','generiek'],
      p_fonds_id => current_setting('art500.fonds_a')::uuid) z $q$;
  v_frase  constant text := '"artikel 150d" OR "art 150d"';
  v_peil   constant date := date '2026-09-29';
  v_re_label constant text := '(^|[^a-z])artikel +150d([^0-9a-z]|$)';
  v_re_tekst constant text := '^(artikel|art[.]?) +150d([^0-9a-z]|$)';
  v_docs   uuid[];
  v_ids    uuid[];
  v_toe    uuid[];
  t0 timestamptz; t1 timestamptz; t2 timestamptz; t3 timestamptz;
  v_tot numeric[] := '{}'; v_q3 numeric[] := '{}'; v_oud numeric[] := '{}';
  v_plan json;
  v_buf_nieuw bigint := 0; v_buf_oud bigint;
  i int;
  -- mediaan / p95 / max over een reeks, zonder trimming
  r record;
begin
  for i in 1..25 loop
    t0 := clock_timestamp();
    execute format(ids, q1) into v_docs using array['wetgeving','wetsgeschiedenis'], true, 200, 0;
    t1 := clock_timestamp();
    execute format(ids, q2) into v_ids using v_re_label, v_re_tekst, v_docs, 50, 0;
    t2 := clock_timestamp();
    execute format(ids, q3) into v_toe using true, 1000, 0, 'gearchiveerd', 'actief', v_peil, v_peil, 'generiek', 'van_kracht', 'actief', v_ids, 'dutch'::regconfig, v_frase, array['vastgesteld','van_kracht'], array['fonds','generiek'], 50, 0;
    t3 := clock_timestamp();
    v_tot := v_tot || (extract(epoch from t3 - t0) * 1000);
    v_q3  := v_q3  || (extract(epoch from t3 - t2) * 1000);
    if i = 1 then
      raise notice 'P1 eerste uitvoering: Q1 % ms, Q2 % ms, Q3 % ms, totaal % ms',
        round(extract(epoch from t1 - t0) * 1000, 2), round(extract(epoch from t2 - t1) * 1000, 2),
        round(extract(epoch from t3 - t2) * 1000, 2), round(extract(epoch from t3 - t0) * 1000, 2);
    end if;
    if extract(epoch from t3 - t0) >= 1 then
      raise exception 'FAAL P1: uitvoering % duurde % ms (grens 1 s).', i, round(extract(epoch from t3 - t0) * 1000);
    end if;
  end loop;

  -- Juistheid op de fixture: beide juridische fixturedocumenten, en alle 9
  -- exacte 150d-passages daarvan (4 Pensioenwet, 5 MvT) gevonden én toegelaten.
  if not (v_docs @> array['05002000-0000-0000-0000-00000000a001','05002000-0000-0000-0000-00000000a002']::uuid[])
     or v_docs && array['05002000-0000-0000-0000-00000000a003','05002000-0000-0000-0000-00000000a004']::uuid[] then
    raise exception 'FAAL P1: de juridische documentopzoeking klopt niet (%).', v_docs;
  end if;
  if (select count(*) from public.document_chunks c where c.id = any(v_ids) and c.embedding_model = 'art500-perf') <> 9
     or (select count(*) from public.document_chunks c where c.id = any(v_toe) and c.embedding_model = 'art500-perf') <> 9 then
    raise exception 'FAAL P1: niet 9/9 exacte fixturepassages gevonden en toegelaten.';
  end if;
  if not exists (select 1 from public.document_chunks c where c.id = any(v_toe) and c.pagina = 395
                  and c.document_id = '05002000-0000-0000-0000-00000000a002'
                  and c.structuur_label = 'Artikelsgewijze toelichting — Artikel 150d') then
    raise exception 'FAAL P1: MvT p.395 (artikel 150d) niet toegelaten.';
  end if;
  if (select count(*) from public.document_chunks c where c.id = any(v_toe)
       and c.document_id = '05002000-0000-0000-0000-00000000a001') <> 4 then
    raise exception 'FAAL P1: de vier Pensioenwet-chunks van artikel 150d zijn niet alle toegelaten.';
  end if;

  select percentile_disc(0.5) within group (order by t) as p50, percentile_disc(0.95) within group (order by t) as p95,
         max(t) as mx, count(*) as n into r from unnest(v_tot) t;
  raise notice 'P1 nieuw artikelspoor (Q1+Q2+Q3) onder RLS, % runs: mediaan % ms, p95 % ms, max % ms.',
    r.n, round(r.p50, 2), round(r.p95, 2), round(r.mx, 2);
  if r.p95 >= 500 then
    raise exception 'FAAL P1: p95 % ms ≥ 500 ms.', round(r.p95);
  end if;
  declare
    v_nieuw_p95 numeric := r.p95;
    v_q3_p50 numeric;
  begin
    select percentile_disc(0.5) within group (order by t) as p50, percentile_disc(0.95) within group (order by t) as p95,
           max(t) as mx, count(*) as n into r from unnest(v_q3) t;
    v_q3_p50 := r.p50;
    raise notice 'P1 nieuwe toelating (Q3) alleen, % runs: mediaan % ms, p95 % ms, max % ms.',
      r.n, round(r.p50, 2), round(r.p95, 2), round(r.mx, 2);

    -- P2: de oude toelating via zoek_chunks, zelfde parameters.
    for i in 1..5 loop
      t0 := clock_timestamp();
      execute format('select array_agg(id) from (%s) x', q_oud) using v_ids, v_frase, v_peil;
      v_oud := v_oud || (extract(epoch from clock_timestamp() - t0) * 1000);
    end loop;
    select percentile_disc(0.5) within group (order by t) as p50, percentile_disc(0.95) within group (order by t) as p95,
           max(t) as mx, count(*) as n into r from unnest(v_oud) t;
    raise notice 'P2 oude toelating via zoek_chunks, % runs: mediaan % ms, p95 % ms, max % ms.',
      r.n, round(r.p50, 2), round(r.p95, 2), round(r.mx, 2);

    -- Buffers (CPU-onafhankelijk): één EXPLAIN (ANALYZE, BUFFERS) per query.
    execute 'explain (analyze, buffers, format json) ' || q1 into v_plan using array['wetgeving','wetsgeschiedenis'], true, 200, 0;
    v_buf_nieuw := v_buf_nieuw + (v_plan->0->'Plan'->>'Shared Hit Blocks')::bigint + (v_plan->0->'Plan'->>'Shared Read Blocks')::bigint;
    execute 'explain (analyze, buffers, format json) ' || q2 into v_plan using v_re_label, v_re_tekst, v_docs, 50, 0;
    v_buf_nieuw := v_buf_nieuw + (v_plan->0->'Plan'->>'Shared Hit Blocks')::bigint + (v_plan->0->'Plan'->>'Shared Read Blocks')::bigint;
    execute 'explain (analyze, buffers, format json) ' || q3 into v_plan using true, 1000, 0, 'gearchiveerd', 'actief', v_peil, v_peil, 'generiek', 'van_kracht', 'actief', v_ids, 'dutch'::regconfig, v_frase, array['vastgesteld','van_kracht'], array['fonds','generiek'], 50, 0;
    v_buf_nieuw := v_buf_nieuw + (v_plan->0->'Plan'->>'Shared Hit Blocks')::bigint + (v_plan->0->'Plan'->>'Shared Read Blocks')::bigint;
    execute 'explain (analyze, buffers, format json) ' || q_oud into v_plan using v_ids, v_frase, v_peil;
    v_buf_oud := (v_plan->0->'Plan'->>'Shared Hit Blocks')::bigint + (v_plan->0->'Plan'->>'Shared Read Blocks')::bigint;
    raise notice 'P2 buffers: nieuw (Q1+Q2+Q3) %, oude toelating %.', v_buf_nieuw, v_buf_oud;

    -- Negatieve controle: de oude toelating is aantoonbaar zwaarder — in
    -- buffers (≥ 3× het hele nieuwe spoor) én in tijd (mediaan ≥ 3× die van
    -- de nieuwe toelating). Op Productie was dat 3,9 s tegen de 8 s-grens.
    if v_buf_oud < 3 * v_buf_nieuw then
      raise exception 'FAAL P2: oude toelating (% buffers) niet aantoonbaar zwaarder dan het nieuwe spoor (% buffers).', v_buf_oud, v_buf_nieuw;
    end if;
    if r.p50 < 3 * v_q3_p50 then
      raise exception 'FAAL P2: oude toelating (mediaan % ms) niet aantoonbaar trager dan de nieuwe (mediaan % ms).', round(r.p50, 2), round(v_q3_p50, 2);
    end if;
    raise notice 'OK P1/P2: p95 % ms < 500 ms; oude toelating %× zo veel buffers en %× zo traag als de nieuwe.',
      round(v_nieuw_p95, 2), round(v_buf_oud::numeric / greatest(v_buf_nieuw, 1), 1), round(r.p50 / greatest(v_q3_p50, 0.001), 1);
  end;
end $$;

reset role;

\if :{?art500_behoud}
commit;
\else
rollback;
\endif
