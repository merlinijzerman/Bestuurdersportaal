-- ============================================================================
-- PR 0 zoekpad-herontwerp — LOKAAL MEETONDERZOEK (geen CI, geen migratie).
-- Productie-achtige fixture voor de drie-routes-meting (R0/R1/R2).
-- ----------------------------------------------------------------------------
-- Dit bestand is GEEN check en draait NIET in scripts/cross-tenant-ci.sh: het
-- bouwt bewust een grote fixture (≥ 25.400 chunks met vector(1024) + HNSW +
-- GIN) en COMMIT die, zodat tests/karakterisering/zoekpad-pr0-meting.mjs er
-- honderden meettransacties op kan draaien. Opruimen:
--   2026_10_03_pr0_zoekpad_fixture_opruimen.sql
-- Uitsluitend tegen een wegwerpbare lokale stack (de meting weigert andere
-- hosts).
--
-- Vorm (Productie 02-10-2026: ~25.400 chunks, 111 documenten):
--   generiek   30 documenten  14.771 chunks  (PW 968, MvT 2.738, 2× Besluit
--              313/312, 22 × 440 overig; plus 4 NIET-toelaatbare: concept,
--              review verlopen, bronstatus historisch, gearchiveerd)
--   fonds A    45 documenten   5.580 chunks  (reglement 300 met hoofdstuk 5 op
--              p. 22–29; 37 × 120; plus 7 randgevallen: concept, gearchiveerd,
--              actief=false, zonder scanbewijs, scanbewijs met verkeerde hash,
--              geldig_tot verlopen, bronstatus historisch)
--   fonds B    24 documenten   3.120 chunks
--   fonds C    12 documenten   1.560 chunks
--   totaal    111 documenten  25.031 + 440 = 25.471 chunks
-- Optioneel (apart bestand _b_match.sql): N extra chunks van fonds B die
-- álle vraagwoorden bevatten én qua embedding dicht bij de vectorvraag liggen
-- (de 0-vs-5.000-invariantiemeting en de HNSW-recallmeting).
--
-- Tekst: Nederlandstalige woordenschat (incl. de vraagwoorden van de
-- vragenset) zodat 'dutch' tsvectors realistisch zijn; embeddings zijn
-- genormaliseerde pseudo-random vectoren. Vectorvragen staan in
-- pr0_fixture.vragen (zelfde seed), zodat harnas en fixture dezelfde
-- querievector gebruiken.
--
-- Versiebewijs zoals op Productie: bestand_hash + scan_resultaat (clean,
-- hash-gebonden) op alle documenten behalve de twee scan-randgevallen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres (opbouw). Alle metingen gebeuren daarna in het harnas onder
--      de rollen authenticated/anon/service_role/portaal_beperkt.
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on
begin;

create schema if not exists pr0_fixture;

select setseed(0.1003);

insert into public.fondsen (id, naam, slug) values
  ('00000000-0000-4000-a000-00000000000a', 'PR0 fonds A', 'pr0-fonds-a'),
  ('00000000-0000-4000-a000-00000000000b', 'PR0 fonds B', 'pr0-fonds-b'),
  ('00000000-0000-4000-a000-00000000000c', 'PR0 fonds C', 'pr0-fonds-c')
on conflict do nothing;

insert into auth.users (id, aud, role, email, raw_app_meta_data, created_at, updated_at) values
  ('00000000-0000-4000-b000-00000000000a', 'authenticated', 'authenticated', 'pr0-a@test.local',
   '{"naam":"PR0 A","fonds_id":"00000000-0000-4000-a000-00000000000a"}', now(), now()),
  ('00000000-0000-4000-b000-00000000000b', 'authenticated', 'authenticated', 'pr0-b@test.local',
   '{"naam":"PR0 B","fonds_id":"00000000-0000-4000-a000-00000000000b"}', now(), now()),
  ('00000000-0000-4000-b000-00000000000c', 'authenticated', 'authenticated', 'pr0-c@test.local',
   '{"naam":"PR0 C","fonds_id":"00000000-0000-4000-a000-00000000000c"}', now(), now());

do $$
begin
  if (select fonds_id from public.profielen where id = '00000000-0000-4000-b000-00000000000a')
       is distinct from '00000000-0000-4000-a000-00000000000a'::uuid then
    raise exception 'SEED FAALT: profiel A niet aan fonds A gekoppeld (trigger maak_profiel).';
  end if;
end $$;

-- Woordenschat: domein + de inhoudswoorden van de vragenset.
create temp table pr0_woorden on commit drop as
select string_to_array(
  'pensioen fonds deelnemer uitkering premie vermogen dekkingsgraad transitie regeling aanspraak ' ||
  'rechten overgang sociale partners werkgever werknemer compensatie evenwicht generaties besluit ' ||
  'bestuur toezicht wettelijk kader beleid risico beleggingen solidariteit reserve toedeling ' ||
  'collectieve waardeoverdracht invaren bezwaar informatie verantwoording raad verantwoordingsorgaan ' ||
  'belanghebbenden financiële opzet contract uitvoerder vastgesteld termijn datum lid onderdeel ' ||
  'bepaling toelichting wet regels minister nadere uitwerking evenwichtig transparant zorgvuldig ' ||
  'afweging keuze procedure plan implementatie jaar maand percentage rendement leeftijd cohort ' ||
  'pensioneren pensionering deeltijdpensioen uitstellen partnerpensioen ouderdomspensioen hoger lager ' ||
  'reglement hoofdstukken hoofdstuk beleggingsbeleid kosten vergadering samengesteld communicatieplan ' ||
  'solidariteitsreserve toezichtkader dnb uitdiensttreding stoppen werken omzetten eerder ' ||
  'bedoeling wetgever artikel pensioenwet transitieplan memorie documenten gebeurt verdeeld ' ||
  'risicohouding herstelplan premiebeleid indexatie kortingen governance sleutelfunctie actuaris ' ||
  'accountant jaarverslag jaarrekening begroting kwartaal rapportage dashboard klachten geschillen',
  ' ') as a;

-- ── Documenten ──────────────────────────────────────────────────────────────
-- id-vorm: 00000000-0000-4000-d000-0000000<klasse><nr>, klasse e(generiek)/a/b/c.
create temp table pr0_docs (id uuid, fonds text, bib text, titel text, status text, bronstatus text,
                            actief boolean, n int, soort text, documenttype text, review date,
                            geldig_tot date, scan text, pensioenreglement boolean) on commit drop;

insert into pr0_docs values
  ('00000000-0000-4000-d000-00000000e001', null, 'generiek', 'Pensioenwet', 'van_kracht', 'actief', true, 968, 'pw', 'wetgeving', null, null, 'clean', false),
  ('00000000-0000-4000-d000-00000000e002', null, 'generiek', 'Memorie van toelichting — Kamerstukken II 2021/22, 36 067, nr. 3', 'van_kracht', 'actief', true, 2738, 'mvt', 'wetsgeschiedenis', null, null, 'clean', false),
  ('00000000-0000-4000-d000-00000000e003', null, 'generiek', 'Besluit uitvoering Pensioenwet (deel 1)', 'van_kracht', 'actief', true, 313, 'besluit', null, null, null, 'clean', false),
  ('00000000-0000-4000-d000-00000000e004', null, 'generiek', 'Besluit uitvoering Pensioenwet (deel 2)', 'van_kracht', 'actief', true, 312, 'besluit', null, null, null, 'clean', false);
insert into pr0_docs
select ('00000000-0000-4000-d000-00000000e' || lpad(g::text, 3, '0'))::uuid, null, 'generiek',
       'Generiek stuk ' || g, 'van_kracht', 'actief', true, 440, 'generiek', null, null, null, 'clean', false
  from generate_series(5, 26) g;
insert into pr0_docs values
  ('00000000-0000-4000-d000-00000000e027', null, 'generiek', 'Generiek concept', 'concept', 'actief', true, 300, 'generiek', null, null, null, 'clean', false),
  ('00000000-0000-4000-d000-00000000e028', null, 'generiek', 'Generiek review verlopen', 'van_kracht', 'actief', true, 300, 'generiek', null, date '2026-01-01', null, 'clean', false),
  ('00000000-0000-4000-d000-00000000e029', null, 'generiek', 'Generiek historisch', 'van_kracht', 'historisch', true, 300, 'generiek', null, null, null, 'clean', false),
  ('00000000-0000-4000-d000-00000000e030', null, 'generiek', 'Generiek gearchiveerd', 'gearchiveerd', 'actief', true, 300, 'generiek', null, null, null, 'clean', false);

insert into pr0_docs values
  ('00000000-0000-4000-d000-00000000a001', 'a', 'fonds', 'Pensioenreglement 2026', 'vastgesteld', 'actief', true, 300, 'fonds', null, null, null, 'clean', true);
insert into pr0_docs
select ('00000000-0000-4000-d000-00000000a' || lpad(g::text, 3, '0'))::uuid, 'a', 'fonds',
       'Fondsstuk A ' || g, 'vastgesteld', 'actief', true, 120, 'fonds', null, null, null, 'clean', false
  from generate_series(2, 38) g;
insert into pr0_docs values
  ('00000000-0000-4000-d000-00000000a039', 'a', 'fonds', 'Fondsstuk A concept', 'concept', 'actief', true, 120, 'fonds', null, null, null, 'clean', false),
  ('00000000-0000-4000-d000-00000000a040', 'a', 'fonds', 'Fondsstuk A gearchiveerd', 'gearchiveerd', 'actief', true, 120, 'fonds', null, null, null, 'clean', false),
  ('00000000-0000-4000-d000-00000000a041', 'a', 'fonds', 'Fondsstuk A inactief', 'vastgesteld', 'actief', false, 120, 'fonds', null, null, null, 'clean', false),
  ('00000000-0000-4000-d000-00000000a042', 'a', 'fonds', 'Fondsstuk A zonder scanbewijs', 'vastgesteld', 'actief', true, 120, 'fonds', null, null, null, 'geen', false),
  ('00000000-0000-4000-d000-00000000a043', 'a', 'fonds', 'Fondsstuk A scanbewijs verkeerde hash', 'vastgesteld', 'actief', true, 120, 'fonds', null, null, null, 'mismatch', false),
  ('00000000-0000-4000-d000-00000000a044', 'a', 'fonds', 'Fondsstuk A geldigheid verlopen', 'vastgesteld', 'actief', true, 120, 'fonds', null, null, date '2026-01-01', 'clean', false),
  ('00000000-0000-4000-d000-00000000a045', 'a', 'fonds', 'Fondsstuk A historisch', 'vastgesteld', 'historisch', true, 120, 'fonds', null, null, null, 'clean', false);

insert into pr0_docs
select ('00000000-0000-4000-d000-00000000b' || lpad(g::text, 3, '0'))::uuid, 'b', 'fonds',
       'Fondsstuk B ' || g, 'vastgesteld', 'actief', true, 130, 'fonds', null, null, null, 'clean', false
  from generate_series(1, 24) g;
insert into pr0_docs
select ('00000000-0000-4000-d000-00000000c' || lpad(g::text, 3, '0'))::uuid, 'c', 'fonds',
       'Fondsstuk C ' || g, 'vastgesteld', 'actief', true, 130, 'fonds', null, null, null, 'clean', false
  from generate_series(1, 12) g;

insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief, documenttype,
   volgende_review, geldig_tot, bestand_hash, scan_resultaat, normgewicht, wettelijk_regime, geindexeerd,
   wetsgeschiedenis_subtype, dossiernummer)
select d.id,
       case d.fonds when 'a' then '00000000-0000-4000-a000-00000000000a'::uuid
                    when 'b' then '00000000-0000-4000-a000-00000000000b'::uuid
                    when 'c' then '00000000-0000-4000-a000-00000000000c'::uuid end,
       d.bib, case when d.bib = 'generiek' then 'Extern' else 'Intern' end, d.titel, d.status, d.bronstatus, d.actief,
       d.documenttype, d.review, d.geldig_tot,
       case when d.scan = 'geen' then null else encode(sha256(convert_to(d.id::text, 'UTF8')), 'hex') end,
       case d.scan
         when 'clean' then jsonb_build_object('verdict', 'clean', 'sha256', encode(sha256(convert_to(d.id::text, 'UTF8')), 'hex'))
         when 'mismatch' then jsonb_build_object('verdict', 'clean', 'sha256', repeat('b', 64))
         else null end,
       case when d.soort = 'mvt' then 'informatief' when d.bib = 'generiek' then 'bindend' else null end,
       case when d.soort in ('pw', 'besluit') then 'pw' when d.soort = 'mvt' then 'beide' else null end,
       true,
       case when d.soort = 'mvt' then 'memorie_van_toelichting' end,
       case when d.soort = 'mvt' then '36067' end
  from pr0_docs d;

-- ── Chunks ──────────────────────────────────────────────────────────────────
create temp table pr0_chunks on commit drop as
select d.id as document_id, i as chunk_index, d.soort, d.pensioenreglement,
       case
         when d.soort = 'pw' and i in (641, 642, 673, 674) then 'Artikel 150d'
         when d.soort = 'pw' then 'Artikel ' || (i / 4 + 1)
         when d.soort = 'mvt' and i between 2396 and 2400 then 'Artikelsgewijze toelichting — Artikel 150d'
         when d.soort = 'mvt' and i >= 2000 then 'Artikelsgewijze toelichting — Artikel ' || ((i - 2000) / 3 + 100)
         when d.soort = 'mvt' then '§' || (i / 40 + 1) || ' Algemeen deel'
         when d.soort = 'besluit' then 'Artikel ' || (i / 5 + 1)
         else 'Artikel ' || (i % 30 + 1)
       end as label,
       case when d.pensioenreglement then i / 5 + 1 else i / 6 + 1 end as pagina
  from pr0_docs d, generate_series(0, d.n - 1) i;

-- Embeddings met STRUCTUUR (geen uniform-random ruis: daarop is HNSW-recall
-- per definitie slecht en zegt een recallmeting niets). 40 onderwerpcentroïden;
-- document d krijgt onderwerp (documentnummer mod 40: e001/a001/b001/c001 → 1); chunk = normalize(0,8·onderwerp +
-- 0,6·ruis) ⇒ cosinus met het onderwerp ≈ 0,8. Zo delen fonds A, B, C en
-- generiek dezelfde onderwerpen — precies de "gedeelde HNSW"-situatie.
create temp table pr0_onderwerpen on commit drop as
select k, public.l2_normalize((select array_agg(random() - 0.5) from generate_series(1, 1024) g where k >= 0)::public.vector(1024)) as v
  from generate_series(0, 39) k;
-- pgvector kent geen scalaire vermenigvuldiging: mengen via real[].
create function pg_temp.pr0_mix(a public.vector, wa real, b public.vector, wb real) returns public.vector
language sql immutable as $$
  select public.l2_normalize((select array_agg(x.a * wa + y.b * wb order by x.i)
                                from unnest(a::real[]) with ordinality x(a, i)
                                join unnest(b::real[]) with ordinality y(b, j) on x.i = y.j)::public.vector(1024))
$$;
create function pg_temp.pr0_emb(onderwerp int, gewicht real default 0.8) returns public.vector language sql volatile as $$
  select pg_temp.pr0_mix((select v from pr0_onderwerpen where k = onderwerp), gewicht,
                         public.l2_normalize((select array_agg(random() - 0.5) from generate_series(1, 1024) g)::public.vector(1024)), 0.6)
$$;

-- Querievectoren (vast): vq1 = onderwerp 1 (reglement A, PW, B001, C001 …),
-- vq2 = onderwerp 2, vq3 = onderwerp 3. Dezelfde ruisverhouding als een chunk.
create table if not exists pr0_fixture.vragen (naam text primary key, embedding public.vector(1024));
delete from pr0_fixture.vragen;
insert into pr0_fixture.vragen select 'vq' || k, pg_temp.pr0_emb(k) from generate_series(1, 3) k;

insert into public.document_chunks
  (document_id, chunk_index, pagina, tekst, structuur_type, structuur_label, context_prefix,
   embedding, embedding_model, indexering_versie)
select c.document_id, c.chunk_index, c.pagina,
       case
         when c.soort = 'mvt' and c.chunk_index = 2396
           then E'Artikel 150d Pensioenwet en artikel 145c Wvb (Transitieplan)\n'
         when c.soort = 'pw' and c.chunk_index % 4 = 0 then c.label || E'. Opschrift\n'
         when c.soort = 'pw' and c.chunk_index = 641 then E'Artikel 150d. Transitieplan\n'
         when c.pensioenreglement and c.pagina between 22 and 29
           then 'Hoofdstuk 5 Pensioneren: deeltijdpensioen, eerder of later met pensioen gaan, uitstellen, ' ||
                'partnerpensioen omzetten in ouderdomspensioen, eerst hoger en daarna lager pensioen. '
         when c.pensioenreglement and c.pagina = 2
           then 'Inhoudsopgave: hoofdstukken van het pensioenreglement. '
         else ''
       end ||
       (select string_agg(w.a[1 + floor(random() * cardinality(w.a))::int], ' ')
          from generate_series(1, 62) k, pr0_woorden w
         where c.chunk_index >= 0),
       'artikel', c.label,
       left(c.label || ' — ' || (select titel from public.documenten d where d.id = c.document_id), 119),
       pg_temp.pr0_emb((('x' || right(c.document_id::text, 3))::bit(12)::int % 40) + 0 * c.chunk_index),
       'pr0-zoekpad', 'pr0-zoekpad-v1'
  from pr0_chunks c;

analyze public.documenten;
analyze public.document_chunks;
analyze public.profielen;

do $$
declare n bigint; nd bigint;
begin
  select count(*) into n from public.document_chunks where embedding_model = 'pr0-zoekpad';
  select count(*) into nd from public.documenten where id::text like '00000000-0000-4000-d000-%';
  if n < 25400 or nd <> 111 then
    raise exception 'SEED FAALT PR0: % chunks / % documenten (verwacht ≥ 25.400 / 111).', n, nd;
  end if;
  raise notice 'PR0-fixture: % documenten, % chunks (GIN idx_chunks_zoek + HNSW idx_chunks_embedding bestaan: %/%).',
    nd, n,
    exists (select 1 from pg_indexes where indexname = 'idx_chunks_zoek'),
    exists (select 1 from pg_indexes where indexname = 'idx_chunks_embedding');
end $$;

commit;
