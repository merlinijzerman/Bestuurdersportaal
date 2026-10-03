-- ============================================================================
-- PR 0 zoekpad-herontwerp — LOKAAL MEETONDERZOEK (geen CI, geen migratie).
-- Toevoeging op 2026_10_03_pr0_zoekpad_fixture.sql: 5.000 chunks van fonds B
-- (10 documenten × 500) die
--   (a) ÁLLE inhoudswoorden van de vragenset bevatten (elke strikte en
--       verslapte FTS-vraag matcht ze), en
--   (b) qua embedding dichter bij vectorvraag vq1 liggen dan welke chunk van
--       fonds A of generiek ook (normalize(0,95·vq1 + 0,3·ruis)).
-- Doel: de invariantiemeting "fonds A mag niets merken van rijen van fonds B"
-- (buffers, timing, scores) en de HNSW-recallmeting bij een gedeelde index.
-- Het harnas meet eerst ZONDER (0) en daarna MET (5.000) deze rijen.
-- Opruimen: 2026_10_03_pr0_zoekpad_fixture_opruimen.sql.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

select setseed(0.2003);

create function pg_temp.pr0_mix(a public.vector, wa real, b public.vector, wb real) returns public.vector
language sql immutable as $$
  select public.l2_normalize((select array_agg(x.a * wa + y.b * wb order by x.i)
                                from unnest(a::real[]) with ordinality x(a, i)
                                join unnest(b::real[]) with ordinality y(b, j) on x.i = y.j)::public.vector(1024))
$$;

insert into public.documenten
  (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief, bestand_hash, scan_resultaat, geindexeerd)
select ('00000000-0000-4000-d000-00000000b' || lpad((100 + g)::text, 3, '0'))::uuid,
       '00000000-0000-4000-a000-00000000000b', 'fonds', 'Intern', 'Fondsstuk B match ' || g,
       'vastgesteld', 'actief', true,
       encode(sha256(convert_to(('00000000-0000-4000-d000-00000000b' || lpad((100 + g)::text, 3, '0')), 'UTF8')), 'hex'),
       jsonb_build_object('verdict', 'clean', 'sha256',
         encode(sha256(convert_to(('00000000-0000-4000-d000-00000000b' || lpad((100 + g)::text, 3, '0')), 'UTF8')), 'hex')),
       true
  from generate_series(1, 10) g;

insert into public.document_chunks
  (document_id, chunk_index, pagina, tekst, structuur_type, structuur_label, context_prefix,
   embedding, embedding_model, indexering_versie)
select d.id, i, i / 5 + 1,
       'bedoeling wetgever artikel 150d pensioenwet transitieplan memorie toelichting reglement ' ||
       'pensioneren pensioen deeltijdpensioen uitstellen partnerpensioen ouderdomspensioen hoger lager ' ||
       'stoppen werken hoofdstukken pensioenreglement documenten beleggingsbeleid dekkingsgraad premie ' ||
       'risico bestuur samengesteld verantwoordingsorgaan vergadering waardeoverdracht kosten uitvoerder ' ||
       'rendement cohorten communicatieplan solidariteitsreserve besluiten toezichtkader dnb implementatie ' ||
       'contract informatie deelnemer uitdiensttreding eerder gebeurt pensionering omzetten verdeeld jaar ' ||
       'bmatch' || i,
       'artikel', 'Artikel ' || (i % 30 + 1), left('Artikel ' || (i % 30 + 1) || ' — ' || d.titel, 119),
       pg_temp.pr0_mix((select embedding from pr0_fixture.vragen where naam = 'vq1'), 0.95,
                       public.l2_normalize((select array_agg(random() - 0.5) from generate_series(1, 1024) g where i >= 0)::public.vector(1024)), 0.3),
       'pr0-zoekpad-bmatch', 'pr0-zoekpad-v1'
  from public.documenten d, generate_series(0, 499) i
 where d.id::text like '00000000-0000-4000-d000-00000000b1%';

analyze public.documenten;
analyze public.document_chunks;

do $$
declare n bigint;
begin
  select count(*) into n from public.document_chunks where embedding_model = 'pr0-zoekpad-bmatch';
  if n <> 5000 then raise exception 'SEED FAALT PR0 b_match: % chunks (verwacht 5.000).', n; end if;
  raise notice 'PR0 b_match: 5.000 chunks van fonds B toegevoegd.';
end $$;

commit;
