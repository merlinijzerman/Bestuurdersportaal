-- ============================================================================
-- T4 — Negatieve retrieval-fondsdiscipline-testsuite (werkopdracht T4 #5)
-- ----------------------------------------------------------------------------
-- Doel: bewijzen dat de retrieval-RPC's (zoek_chunks / zoek_chunks_hybride) de
-- fonds-tenantgrens én de published-only-generiek-regel afdwingen, en dat een
-- geïntroduceerd lek een test laat FALEN. Draai met psql; elke overtreding doet
-- `raise exception` → psql exit-code <> 0 → CI faalt.
--
-- Getoetste scenario's (uit de werkopdracht):
--   T11 — Fonds-lek: fonds A krijgt NOOIT chunks van fonds B (RLS + p_fonds_id).
--   T12 — Manipulatie: een request-supplied p_fonds_id (=B) terwijl je A bent,
--         surfacet géén B-content (RLS) én onttrekt A's eigen fondschunks aan het
--         resultaat (de server-side filter is leidend, niet de meegegeven waarde).
--   T13 — Ingetrokken/gearchiveerd generiek is GEEN actuele bron (documentstatus).
--   T14 — Uitgesloten generieke bron (bronstatus) telt NIET als actuele bron.
--   +   — Regressie: eigen fonds + published generiek blijven wél zichtbaar.
--
-- Self-seeding (2 fondsen + 2 users via auth-trigger maak_profiel) + 5 documenten
-- met chunks. Alles in één transactie met ROLLBACK — laat geen data achter.
-- Assertions toetsen op de SEED-document-id's (niet op globale tellingen), zodat
-- echte productiedata in de DB de uitkomst niet beïnvloedt.
--
-- Uitvoeren:  psql "$DB" -f dit-bestand
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ── Seed als tabel-eigenaar (RLS omzeild). Vaste UUID's voor de test. ────────
--   Fonds A = 11111111-...  user A = aaaa...
--   Fonds B = 22222222-...  user B = bbbb...
insert into public.fondsen (id, naam, slug)
values ('11111111-1111-1111-1111-111111111111', 'T4 Testfonds A', 't4-testfonds-a'),
       ('22222222-2222-2222-2222-222222222222', 'T4 Testfonds B', 't4-testfonds-b');

insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated','authenticated','t4-a@test.local',
   '{"naam":"Test A","fonds_id":"11111111-1111-1111-1111-111111111111"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated','authenticated','t4-b@test.local',
   '{"naam":"Test B","fonds_id":"22222222-2222-2222-2222-222222222222"}', now(), now());

do $$
begin
  if (select fonds_id from public.profielen where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
       is distinct from '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'SEED FAALT: profiel A niet aan fonds A gekoppeld (trigger maak_profiel).';
  end if;
end $$;

-- ── 5 documenten (allemaal actief). Unieke zoekterm 'xqztrivium' isoleert de
--    treffers van eventuele echte data. Denorm-kolommen op de chunk zijn wat de
--    RPC filtert (c.bibliotheek/c.documentstatus/c.bronstatus). ────────────────
--   DOC_A  = fondsdocument A            (zichtbaar voor A, niet voor B-filter)
--   DOC_B  = fondsdocument B            (nooit zichtbaar voor A — RLS)
--   DOC_GP = generiek, published        (van_kracht + actief → zichtbaar)
--   DOC_GA = generiek, gearchiveerd     (T13 → onzichtbaar)
--   DOC_GU = generiek, bronstatus uitgesloten (T14 → onzichtbaar)
insert into public.documenten (id, fonds_id, bibliotheek, bron, titel, status, bronstatus, actief)
values
  ('0a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','fonds','Intern','T4 Fonds A-doc','van_kracht','actief', true),
  ('0b000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','fonds','Intern','T4 Fonds B-doc','van_kracht','actief', true),
  ('09000000-0000-0000-0000-000000000003', null,'generiek','DNB','T4 Generiek published','van_kracht','actief', true),
  ('09000000-0000-0000-0000-000000000004', null,'generiek','DNB','T4 Generiek gearchiveerd','gearchiveerd','actief', true),
  ('09000000-0000-0000-0000-000000000005', null,'generiek','DNB','T4 Generiek uitgesloten','van_kracht','uitgesloten', true);

-- Eén chunk per document; denorm-velden expliciet gezet (de AFTER UPDATE-denorm-
-- trigger vuurt niet bij insert). Zelfde zoekterm zodat alle vijf matchen.
insert into public.document_chunks
  (document_id, chunk_index, tekst, bibliotheek, documentstatus, bronstatus)
values
  ('0a000000-0000-0000-0000-000000000001',0,'Dit fragment bevat xqztrivium voor de T4-test.','fonds','van_kracht','actief'),
  ('0b000000-0000-0000-0000-000000000002',0,'Dit fragment bevat xqztrivium voor de T4-test.','fonds','van_kracht','actief'),
  ('09000000-0000-0000-0000-000000000003',0,'Dit fragment bevat xqztrivium voor de T4-test.','generiek','van_kracht','actief'),
  ('09000000-0000-0000-0000-000000000004',0,'Dit fragment bevat xqztrivium voor de T4-test.','generiek','gearchiveerd','actief'),
  ('09000000-0000-0000-0000-000000000005',0,'Dit fragment bevat xqztrivium voor de T4-test.','generiek','van_kracht','uitgesloten');

-- ── Impersoneer user A (fonds A) ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';

-- POSITIEF / regressie: A ziet met p_fonds_id => A zowel het EIGEN fondsdoc als
-- het published generieke document (filter niet over-restrictief).
do $$
declare n_eigen int; n_gen int;
begin
  select count(*) into n_eigen
    from public.zoek_chunks(p_query => 'xqztrivium',
                            p_fonds_id => '11111111-1111-1111-1111-111111111111')
   where document_id = '0a000000-0000-0000-0000-000000000001';
  select count(*) into n_gen
    from public.zoek_chunks(p_query => 'xqztrivium',
                            p_fonds_id => '11111111-1111-1111-1111-111111111111')
   where document_id = '09000000-0000-0000-0000-000000000003';
  if n_eigen = 0 then
    raise exception 'REGRESSIE: eigen fondsdoc (A) niet gevonden met p_fonds_id => A.';
  end if;
  if n_gen = 0 then
    raise exception 'REGRESSIE: published generiek document niet gevonden met p_fonds_id => A.';
  end if;
  raise notice 'OK regressie: eigen fonds + published generiek zichtbaar voor A.';
end $$;

-- NEGATIEF T11 (fonds-lek): A krijgt met p_fonds_id => A NOOIT een chunk van fonds B.
do $$
declare n int;
begin
  select count(*) into n
    from public.zoek_chunks(p_query => 'xqztrivium',
                            p_fonds_id => '11111111-1111-1111-1111-111111111111')
   where document_id = '0b000000-0000-0000-0000-000000000002';
  if n <> 0 then
    raise exception 'LEK T11: fonds A ziet chunk van fonds B via zoek_chunks (fonds-isolatie kapot).';
  end if;
  raise notice 'OK T11: fonds B onzichtbaar voor A (zoek_chunks).';
end $$;

-- NEGATIEF T11b: idem via de hybride RPC (FTS-arm; embeddings NULL → vec-arm leeg).
do $$
declare n int;
  nul_vec text := '[' || rtrim(repeat('0,',1024),',') || ']';
begin
  select count(*) into n
    from public.zoek_chunks_hybride(p_query => 'xqztrivium',
                                    p_embedding => nul_vec::vector,
                                    p_fonds_id => '11111111-1111-1111-1111-111111111111')
   where document_id = '0b000000-0000-0000-0000-000000000002';
  if n <> 0 then
    raise exception 'LEK T11b: fonds A ziet chunk van fonds B via zoek_chunks_hybride.';
  end if;
  raise notice 'OK T11b: fonds B onzichtbaar voor A (zoek_chunks_hybride).';
end $$;

-- NEGATIEF T12 (manipulatie): A stuurt p_fonds_id => B (spoof). Dit mag NOOIT
-- B-content surfacen (RLS blokkeert) én onttrekt A's eigen fondsdoc aan het
-- resultaat (server-side filter is leidend). Alleen generiek blijft over.
do $$
declare n_b int; n_a int; n_gen int;
begin
  select count(*) into n_b
    from public.zoek_chunks(p_query => 'xqztrivium',
                            p_fonds_id => '22222222-2222-2222-2222-222222222222')
   where document_id = '0b000000-0000-0000-0000-000000000002';
  select count(*) into n_a
    from public.zoek_chunks(p_query => 'xqztrivium',
                            p_fonds_id => '22222222-2222-2222-2222-222222222222')
   where document_id = '0a000000-0000-0000-0000-000000000001';
  select count(*) into n_gen
    from public.zoek_chunks(p_query => 'xqztrivium',
                            p_fonds_id => '22222222-2222-2222-2222-222222222222')
   where document_id = '09000000-0000-0000-0000-000000000003';
  if n_b <> 0 then
    raise exception 'LEK T12: spoofed p_fonds_id => B surfacet B-content voor A (RLS kapot).';
  end if;
  if n_a <> 0 then
    raise exception 'LEK T12: spoofed p_fonds_id => B toont A''s eigen fondsdoc — server-filter niet leidend.';
  end if;
  if n_gen = 0 then
    raise exception 'REGRESSIE T12: generiek published verdween ten onrechte bij p_fonds_id => B.';
  end if;
  raise notice 'OK T12: spoofed fonds levert alleen generiek — geen A- of B-fondscontent.';
end $$;

-- NEGATIEF T13 (ingetrokken/gearchiveerd generiek is geen actuele bron).
do $$
declare n int;
begin
  select count(*) into n
    from public.zoek_chunks(p_query => 'xqztrivium',
                            p_fonds_id => '11111111-1111-1111-1111-111111111111')
   where document_id = '09000000-0000-0000-0000-000000000004';
  if n <> 0 then
    raise exception 'LEK T13: gearchiveerd generiek document verschijnt als actuele bron.';
  end if;
  raise notice 'OK T13: gearchiveerd generiek onzichtbaar (published-only-gate).';
end $$;

-- NEGATIEF T14 (uitgesloten generieke bronstatus telt niet als actuele bron).
do $$
declare n int;
begin
  select count(*) into n
    from public.zoek_chunks(p_query => 'xqztrivium',
                            p_fonds_id => '11111111-1111-1111-1111-111111111111')
   where document_id = '09000000-0000-0000-0000-000000000005';
  if n <> 0 then
    raise exception 'LEK T14: generiek met bronstatus ''uitgesloten'' verschijnt als actuele bron.';
  end if;
  raise notice 'OK T14: uitgesloten generiek onzichtbaar (published-only-gate).';
end $$;

reset role;

rollback;

-- ============================================================================
-- Alles geslaagd als psql exit 0 gaf en je de "OK …"-notices zag (regressie,
-- T11, T11b, T12, T13, T14). Elke "LEK:"/"FAALT"/"REGRESSIE" doet raise
-- exception → non-zero exit → CI faalt.
-- ============================================================================
