-- ============================================================================
-- LOKAAL-ALLEEN, FAIL-CLOSED: het guardblok hieronder weigert buiten een
-- expliciet lokale testomgeving (tenant-host, serveradres, GUC pr0.lokaal_ok,
-- PostgREST-sessie) vóór de eerste wijzigende opdracht. Aanroepen met
--   psql "$DB" -v ON_ERROR_STOP=1 -v pr0_lokaal_ok=ja -f dit-bestand
-- PR 0 zoekpad-herontwerp — LOKAAL MEETONDERZOEK (geen CI, geen migratie).
-- Prototypes R1 (SECURITY INVOKER) en R2 (SECURITY DEFINER) in het tijdelijke
-- schema pr0_proto. GEEN migratie: dit schema bestaat alleen op de lokale
-- wegwerpstack en wordt door 2026_10_03_pr0_zoekpad_fixture_opruimen.sql
-- verwijderd. Niets hiervan is een keuze; de opdrachtgever beslist op basis
-- van het rapport (ZOEKPAD-HERONTWERP-PR0-RAPPORT.md).
-- ----------------------------------------------------------------------------
-- Contractvorm (beide routes): fase 1 levert UITSLUITEND id + document_id +
-- score(s); fase 2 (buiten dit bestand) is de id-begrensde RLS-select zoals
-- het artikelspoor (#506) die al doet. De eis uit de opdracht: fase 1 geeft
-- NOOIT een id terug van een ander fonds of van een niet-toegelaten document.
--
-- Filters (identiek aan zoek_chunks, 2026_08_12_t4_regime_borging.sql §7a),
-- plus het WP3-scanbewijs (hash-gebonden clean) als p_scan = true — dat doet
-- zoek_chunks vandaag NIET (de app filtert ná de RPC, core/lib/rag.ts
-- filterOpScanbewijs); hier staat het in fase 1 omdat de opdracht het eist.
--
-- p_lek: UITSLUITEND voor de negatieve controles van de lekmatrix. Elke waarde
-- schakelt precies één voorwaarde uit; de matrix moet dan rood worden.
--   fonds | scope | scan | review | actief | gearchiveerd | actueel |
--   generiek_published | bronstatus | bronsoort
--
-- Varianten:
--   r1_fts        INVOKER, SQL      — docs eerst (RLS op documenten), chunks via
--                                     document_id = any(array(...)) (bitmap op
--                                     idx_chunks_document), @@ als filter.
--   r1_fts_plpgsql INVOKER, plpgsql — zelfde query via plan cache (H5).
--   r1_vec        INVOKER, plpgsql  — vectorarm; p_iteratief zet
--                                     hnsw.iterative_scan transactie-lokaal.
--   r1_hybride    INVOKER, SQL      — RRF over r1_fts + r1_vec.
--   r2_fts        DEFINER, SQL      — fonds uit auth.uid() via profielen;
--                                     p_arm = 'gedeeld' (één GIN over alles) of
--                                     'tenantzuiver' (partiële GIN generiek +
--                                     eigen-fonds-arm via idx_chunks_document).
--   r2_vec        DEFINER, plpgsql  — zelfde als r1_vec zonder RLS.
--   r2_hybride    DEFINER, SQL      — RRF over r2_fts + r2_vec.
-- Rechten: r2_* EXECUTE alleen voor authenticated (revoke public, anon).
-- ============================================================================

\set ON_ERROR_STOP on
-- ── LOKAAL-ALLEEN GUARD (fail-closed; byte-identiek in de vier pr0-bestanden) ─
-- Weigert vóór de eerste wijzigende opdracht (vóór begin/DDL/insert), tenzij
-- ALLE drie gelden:
--   1. geen tenant-host in public.tenant_domains (host like '%bestuurdersportaal.com',
--      dezelfde heuristiek als scripts/drift/genereer.sh) — én de rol kan die
--      tabel werkelijk volledig lezen (eigenaar of BYPASSRLS; RLS is deny-by-default);
--   2. inet_server_addr() is null (unix-socket) of loopback/docker/privé:
--      127.0.0.0/8, ::1, 172.16.0.0/12, 10.0.0.0/8, 192.168.0.0/16;
--   3. de GUC pr0.lokaal_ok is exact 'ja' — door de aanroeper te zetten:
--      psql -v pr0_lokaal_ok=ja (hieronder naar de GUC vertaald) of
--      `set pr0.lokaal_ok = 'ja'`; het meetharnas zet hem zelf.
-- En weigert altijd als request.jwt.claims gezet is (PostgREST-sessie).
-- Negatieve test: tests/karakterisering/zoekpad-pr0-guard.test.mjs.
\if :{?pr0_lokaal_ok}
select set_config('pr0.lokaal_ok', :'pr0_lokaal_ok', false) as pr0_lokaal_ok;
\endif
do $pr0_guard$
declare
  v_addr inet := inet_server_addr();
  v_jwt  text := nullif(current_setting('request.jwt.claims', true), '');
  v_rol  oid  := (select oid from pg_catalog.pg_roles where rolname = current_user);
begin
  if not coalesce((select rolbypassrls from pg_catalog.pg_roles where oid = v_rol), false)
     and (select relowner from pg_catalog.pg_class where oid = 'public.tenant_domains'::regclass) <> v_rol then
    raise exception 'PR0-GUARD: rol % kan public.tenant_domains niet volledig lezen (geen eigenaar/BYPASSRLS); geweigerd vóór enige wijziging.', current_user;
  end if;
  if exists (select 1 from public.tenant_domains where host like '%bestuurdersportaal.com') then
    raise exception 'PR0-GUARD: tenant-host (%%bestuurdersportaal.com) in public.tenant_domains — geen lokale testomgeving; geweigerd vóór enige wijziging.';
  end if;
  if v_addr is not null
     and not (v_addr <<= inet '127.0.0.0/8' or v_addr = inet '::1' or v_addr <<= inet '172.16.0.0/12'
              or v_addr <<= inet '10.0.0.0/8' or v_addr <<= inet '192.168.0.0/16') then
    raise exception 'PR0-GUARD: serveradres % is geen loopback-/docker-adres; geweigerd vóór enige wijziging.', v_addr;
  end if;
  if current_setting('pr0.lokaal_ok', true) is distinct from 'ja' then
    raise exception 'PR0-GUARD: GUC pr0.lokaal_ok is niet ''ja'' (zet: psql -v pr0_lokaal_ok=ja); geweigerd vóór enige wijziging.';
  end if;
  if v_jwt is not null then
    raise exception 'PR0-GUARD: request.jwt.claims is gezet (PostgREST-sessie?); geweigerd vóór enige wijziging.';
  end if;
end $pr0_guard$;
-- ── einde guard ──────────────────────────────────────────────────────────────

begin;

drop schema if exists pr0_proto cascade;
create schema pr0_proto;
grant usage on schema pr0_proto to authenticated, anon, service_role, portaal_beperkt;

-- Partiële GIN voor de tenantzuivere generiek-arm (alleen lokaal, prototype).
create index if not exists idx_pr0_zoek_generiek
  on public.document_chunks using gin (zoek_vector) where bibliotheek = 'generiek';
analyze public.document_chunks;

-- ── Gedeelde documentfilter (één definitie, in beide routes ingelijnd) ───────
-- Levert de toelaatbare document-id's volgens de zoek_chunks-filters + scan.
-- v_fonds: het fonds van de aanroeper (R2) of p_fonds_id (R1). Onder RLS (R1)
-- beperkt de policy "documenten select" dit al tot eigen fonds + generiek.
create function pr0_proto.toelaatbare_documenten(
  p_document_ids uuid[], p_modus text, p_peildatum date, p_bronsoort text[],
  p_fonds_id uuid, p_scan boolean, p_lek text)
returns setof uuid
-- ROWS 100: zonder deze hint schat de planner een set-returning function op
-- 1.000 rijen en kiest hij in de SQL-variant (generiek plan) een hash join
-- met een seq scan over alle chunks (gemeten: 110 ms i.p.v. 14 ms).
rows 100
language sql stable security invoker set search_path = public, pg_temp as $$
  select d.id
    from public.documenten d
   where (p_lek = 'actief' or d.actief = true)
     and (p_lek = 'gearchiveerd' or d.status is distinct from 'gearchiveerd')
     and (p_lek = 'scope' or p_document_ids is null or d.id = any(p_document_ids))
     and (p_lek = 'fonds' or p_fonds_id is null or d.fonds_id = p_fonds_id or d.bibliotheek = 'generiek')
     and (p_lek = 'bronsoort' or p_bronsoort is null or d.bibliotheek = any(p_bronsoort))
     and (p_lek = 'generiek_published' or d.bibliotheek is distinct from 'generiek'
          or (d.status = 'van_kracht' and coalesce(d.bronstatus, 'actief') = 'actief'
              and (p_lek = 'review' or d.volgende_review is null or d.volgende_review >= p_peildatum)))
     and (p_lek = 'actueel' or p_modus is distinct from 'actueel'
          or (d.status in ('vastgesteld', 'van_kracht')
              and (p_lek = 'bronstatus' or coalesce(d.bronstatus, 'actief') = 'actief')
              and (d.geldig_vanaf is null or d.geldig_vanaf <= p_peildatum)
              and (d.geldig_tot is null or d.geldig_tot >= p_peildatum)))
     and (p_lek = 'scan' or not p_scan
          or (d.bestand_hash ~ '^[a-f0-9]{64}$'
              and d.scan_resultaat ->> 'verdict' = 'clean'
              and d.scan_resultaat ->> 'sha256' = d.bestand_hash))
$$;

-- ── R1: SECURITY INVOKER ─────────────────────────────────────────────────────
create function pr0_proto.r1_fts(
  p_query text, p_limit int default 30, p_document_ids uuid[] default null,
  p_modus text default 'alles', p_peildatum date default current_date,
  p_bronsoort text[] default null, p_fonds_id uuid default null,
  p_scan boolean default true, p_lek text default null)
returns table (id uuid, document_id uuid, rang real)
language sql stable security invoker set search_path = public, pg_temp as $$
  -- Vorm: id-begrensd via `document_id = any(array(...))` ⇒ bitmap-indexscan
  -- op idx_chunks_document (O(zichtbare chunks)); de join-vorm (docs join
  -- chunks) kreeg een seq scan over álle chunks met `@@` als filter. `@@` is
  -- niet leakproof en kan onder RLS nooit via de GIN lopen; hij blijft filter.
  -- `cross join websearch_to_tsquery(...)`: in het generieke plan van een
  -- SQL-functie wordt een inline `websearch_to_tsquery('dutch', $1)` anders per
  -- rij opnieuw geparset (gemeten: 70 ms i.p.v. 9 ms bij gelijke buffers).
  select c.id, c.document_id,
         ts_rank_cd(c.zoek_vector, q.tsq) as rang
    from public.document_chunks c
   cross join websearch_to_tsquery('dutch', p_query) as q(tsq)
   where c.document_id = any (array(select pr0_proto.toelaatbare_documenten(p_document_ids, p_modus, p_peildatum, p_bronsoort, p_fonds_id, p_scan, p_lek)))
     and c.zoek_vector @@ q.tsq
     and (p_lek = 'gearchiveerd' or c.documentstatus is distinct from 'gearchiveerd')
   order by rang desc, c.chunk_index asc, c.id
   limit greatest(p_limit, 1)
$$;

create function pr0_proto.r1_fts_plpgsql(
  p_query text, p_limit int default 30, p_document_ids uuid[] default null,
  p_modus text default 'alles', p_peildatum date default current_date,
  p_bronsoort text[] default null, p_fonds_id uuid default null,
  p_scan boolean default true, p_lek text default null)
returns table (id uuid, document_id uuid, rang real)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  return query
  -- Vorm: id-begrensd via `document_id = any(array(...))` ⇒ bitmap-indexscan
  -- op idx_chunks_document (O(zichtbare chunks)); de join-vorm (docs join
  -- chunks) kreeg een seq scan over álle chunks met `@@` als filter. `@@` is
  -- niet leakproof en kan onder RLS nooit via de GIN lopen; hij blijft filter.
  -- `cross join websearch_to_tsquery(...)`: in het generieke plan van een
  -- SQL-functie wordt een inline `websearch_to_tsquery('dutch', $1)` anders per
  -- rij opnieuw geparset (gemeten: 70 ms i.p.v. 9 ms bij gelijke buffers).
  select c.id, c.document_id,
         ts_rank_cd(c.zoek_vector, q.tsq) as rang
    from public.document_chunks c
   cross join websearch_to_tsquery('dutch', p_query) as q(tsq)
   where c.document_id = any (array(select pr0_proto.toelaatbare_documenten(p_document_ids, p_modus, p_peildatum, p_bronsoort, p_fonds_id, p_scan, p_lek)))
     and c.zoek_vector @@ q.tsq
     and (p_lek = 'gearchiveerd' or c.documentstatus is distinct from 'gearchiveerd')
   order by rang desc, c.chunk_index asc, c.id
   limit greatest(p_limit, 1);
end $$;

-- Vectorarm. p_iteratief: hnsw.iterative_scan transactie-lokaal (pgvector ≥ 0.8).
-- p_strategie: zie het commentaar in de functie (planner | hnsw | exact).
create function pr0_proto.r1_vec(
  p_embedding public.vector(1024), p_kandidaten int default 40,
  p_document_ids uuid[] default null, p_modus text default 'alles',
  p_peildatum date default current_date, p_bronsoort text[] default null,
  p_fonds_id uuid default null, p_scan boolean default true, p_lek text default null,
  p_iteratief boolean default false, p_strategie text default 'planner', p_ef int default null)
returns table (id uuid, document_id uuid, afstand real)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_docs uuid[];
begin
  if p_iteratief then
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
    perform set_config('hnsw.max_scan_tuples', '40000', true);
  else
    perform set_config('hnsw.iterative_scan', 'off', true);
  end if;
  perform set_config('hnsw.ef_search', coalesce(p_ef, 40)::text, true);
  -- p_strategie: 'planner' (vrije keuze), 'hnsw' (dwingt de HNSW-geordende
  -- indexscan af via planner-knoppen: filteren NÁ de indexscan), 'exact'
  -- (geen indexscan: exacte KNN via idx_chunks_document + sort, de referentie
  -- voor recall@k). Alle knoppen zijn transactie-lokaal.
  -- (elke knop expliciet, want set_config(..., true) blijft tot het einde
  -- van de transactie staan en het harnas roept meerdere varianten per
  -- transactie aan)
  perform set_config('enable_seqscan',    case when p_strategie = 'hnsw' then 'off' else 'on' end, true);
  perform set_config('enable_bitmapscan', case when p_strategie = 'hnsw' then 'off' else 'on' end, true);
  perform set_config('enable_sort',       case when p_strategie = 'hnsw' then 'off' else 'on' end, true);
  perform set_config('enable_indexscan',  case when p_strategie = 'exact' then 'off' else 'on' end, true);
  -- Dynamische SQL: een gewone `return query` krijgt in plpgsql een gecachet
  -- (na vijf keer generiek) plan dat de planner-knoppen van DEZE aanroep
  -- negeert; `execute` plant per aanroep (gemeten: zonder execute bleef de
  -- eerste planvorm van de sessie hangen voor alle latere varianten).
  v_docs := array(
    select pr0_proto.toelaatbare_documenten(p_document_ids, p_modus, p_peildatum, p_bronsoort, p_fonds_id, p_scan, p_lek) as id
  );
  return query execute $q$
    select c.id, c.document_id, (c.embedding <=> $1)::real as afstand
      from public.document_chunks c
     where c.document_id = any ($2)
       and c.embedding is not null
       and ($3 or c.documentstatus is distinct from 'gearchiveerd')
     order by c.embedding <=> $1, c.id
     limit greatest($4, 1)
  $q$ using p_embedding, v_docs, (p_lek = 'gearchiveerd'), p_kandidaten;
end $$;

create function pr0_proto.r1_hybride(
  p_query text, p_embedding public.vector(1024), p_limit int default 30,
  p_kandidaten int default 40, p_k int default 60,
  p_document_ids uuid[] default null, p_modus text default 'alles',
  p_peildatum date default current_date, p_bronsoort text[] default null,
  p_fonds_id uuid default null, p_scan boolean default true, p_lek text default null,
  p_iteratief boolean default false, p_strategie text default 'planner')
returns table (id uuid, document_id uuid, rang real, fts_rang int, vec_rang int)
language sql stable security invoker set search_path = public, pg_temp as $$
  with fts as (
    select f.id, f.document_id, row_number() over (order by f.rang desc, f.id) as r
      from pr0_proto.r1_fts(p_query, p_kandidaten, p_document_ids, p_modus, p_peildatum, p_bronsoort, p_fonds_id, p_scan, p_lek) f
  ),
  vec as (
    select v.id, v.document_id, row_number() over (order by v.afstand, v.id) as r
      from pr0_proto.r1_vec(p_embedding, p_kandidaten, p_document_ids, p_modus, p_peildatum, p_bronsoort, p_fonds_id, p_scan, p_lek, p_iteratief, p_strategie) v
  )
  select coalesce(fts.id, vec.id), coalesce(fts.document_id, vec.document_id),
         (coalesce(1.0 / (p_k + fts.r), 0) + coalesce(1.0 / (p_k + vec.r), 0))::real as rang,
         fts.r::int, vec.r::int
    from fts full outer join vec on fts.id = vec.id
   order by 3 desc, 1
   limit p_limit
$$;

-- ── R2: SECURITY DEFINER (prototype) ─────────────────────────────────────────
-- Fonds UITSLUITEND uit auth.uid() → profielen. Geen sub of geen profiel ⇒
-- v_fonds null ⇒ alleen generiek (zoals de RLS-policy voor een sub zonder
-- profiel) — maar zonder sub helemaal niets (policy: auth.uid() is not null).
create function pr0_proto.r2_fonds() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select p.fonds_id from public.profielen p where p.id = auth.uid()
$$;
revoke all on function pr0_proto.r2_fonds() from public, anon;

create function pr0_proto.r2_fts(
  p_query text, p_limit int default 30, p_document_ids uuid[] default null,
  p_modus text default 'alles', p_peildatum date default current_date,
  p_bronsoort text[] default null, p_scan boolean default true, p_lek text default null,
  p_arm text default 'tenantzuiver')
returns table (id uuid, document_id uuid, rang real)
-- plpgsql: de tsquery staat één keer in een variabele (Param) en het plan is
-- een custom plan op de parameterwaarden, zodat de GIN-index (`@@`) bruikbaar
-- is. (In een SQL-functie wordt `websearch_to_tsquery('dutch', $1)` in het
-- generieke plan per rij geëvalueerd, en met een `cross join` wordt `@@` een
-- join-clausule waarvoor de planner hier geen GIN-pad koos.)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  v_fonds uuid := pr0_proto.r2_fonds();
  v_tsq   tsquery := websearch_to_tsquery('dutch', p_query);
begin
  if v_uid is null then return; end if;
  return query
  with docs as materialized (
    select d.id, d.bibliotheek
      from public.documenten d
     where (d.fonds_id = v_fonds or d.bibliotheek = 'generiek' or p_lek = 'fonds')
       and d.id in (select pr0_proto.toelaatbare_documenten(p_document_ids, p_modus, p_peildatum, p_bronsoort, null, p_scan, p_lek))
  ),
  gedeeld as (
    select c.id, c.document_id, c.chunk_index, ts_rank_cd(c.zoek_vector, v_tsq) as rang
      from public.document_chunks c
     where p_arm = 'gedeeld'
       and c.zoek_vector @@ v_tsq
       and c.document_id in (select docs.id from docs)
       and (p_lek = 'gearchiveerd' or c.documentstatus is distinct from 'gearchiveerd')
  ),
  generiek as (
    select c.id, c.document_id, c.chunk_index, ts_rank_cd(c.zoek_vector, v_tsq) as rang
      from public.document_chunks c
     where p_arm = 'tenantzuiver'
       and c.bibliotheek = 'generiek'
       and c.zoek_vector @@ v_tsq
       and c.document_id in (select docs.id from docs where docs.bibliotheek = 'generiek')
       and (p_lek = 'gearchiveerd' or c.documentstatus is distinct from 'gearchiveerd')
  ),
  eigen as (
    select c.id, c.document_id, c.chunk_index, ts_rank_cd(c.zoek_vector, v_tsq) as rang
      from public.document_chunks c
     where p_arm = 'tenantzuiver'
       and c.document_id = any (array(select docs.id from docs where docs.bibliotheek <> 'generiek'))
       and c.zoek_vector @@ v_tsq
       and (p_lek = 'gearchiveerd' or c.documentstatus is distinct from 'gearchiveerd')
  ),
  alles as (
    select * from gedeeld union all select * from generiek union all select * from eigen
  )
  select a.id, a.document_id, a.rang
    from alles a
   order by a.rang desc, a.chunk_index asc, a.id
   limit greatest(p_limit, 1);
end $$;
revoke all on function pr0_proto.r2_fts(text, int, uuid[], text, date, text[], boolean, text, text) from public, anon;
grant execute on function pr0_proto.r2_fts(text, int, uuid[], text, date, text[], boolean, text, text) to authenticated;

create function pr0_proto.r2_vec(
  p_embedding public.vector(1024), p_kandidaten int default 40,
  p_document_ids uuid[] default null, p_modus text default 'alles',
  p_peildatum date default current_date, p_bronsoort text[] default null,
  p_scan boolean default true, p_lek text default null,
  p_iteratief boolean default false, p_strategie text default 'planner', p_ef int default null)
returns table (id uuid, document_id uuid, afstand real)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_fonds uuid := pr0_proto.r2_fonds();
  v_docs uuid[];
begin
  if v_uid is null then return; end if;
  if p_iteratief then
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
    perform set_config('hnsw.max_scan_tuples', '40000', true);
  else
    perform set_config('hnsw.iterative_scan', 'off', true);
  end if;
  perform set_config('hnsw.ef_search', coalesce(p_ef, 40)::text, true);
  perform set_config('enable_seqscan',    case when p_strategie = 'hnsw' then 'off' else 'on' end, true);
  perform set_config('enable_bitmapscan', case when p_strategie = 'hnsw' then 'off' else 'on' end, true);
  perform set_config('enable_sort',       case when p_strategie = 'hnsw' then 'off' else 'on' end, true);
  perform set_config('enable_indexscan',  case when p_strategie = 'exact' then 'off' else 'on' end, true);
  -- Dynamische SQL: zie r1_vec.
  v_docs := array(
    select d.id
      from public.documenten d
     where (d.fonds_id = v_fonds or d.bibliotheek = 'generiek' or p_lek = 'fonds')
       and d.id in (select pr0_proto.toelaatbare_documenten(p_document_ids, p_modus, p_peildatum, p_bronsoort, null, p_scan, p_lek))
  );
  return query execute $q$
    select c.id, c.document_id, (c.embedding <=> $1)::real as afstand
      from public.document_chunks c
     where c.document_id = any ($2)
       and c.embedding is not null
       and ($3 or c.documentstatus is distinct from 'gearchiveerd')
     order by c.embedding <=> $1, c.id
     limit greatest($4, 1)
  $q$ using p_embedding, v_docs, (p_lek = 'gearchiveerd'), p_kandidaten;
end $$;
revoke all on function pr0_proto.r2_vec(public.vector, int, uuid[], text, date, text[], boolean, text, boolean, text, int) from public, anon;
grant execute on function pr0_proto.r2_vec(public.vector, int, uuid[], text, date, text[], boolean, text, boolean, text, int) to authenticated;

create function pr0_proto.r2_hybride(
  p_query text, p_embedding public.vector(1024), p_limit int default 30,
  p_kandidaten int default 40, p_k int default 60,
  p_document_ids uuid[] default null, p_modus text default 'alles',
  p_peildatum date default current_date, p_bronsoort text[] default null,
  p_scan boolean default true, p_lek text default null,
  p_iteratief boolean default false, p_arm text default 'tenantzuiver', p_strategie text default 'planner')
returns table (id uuid, document_id uuid, rang real, fts_rang int, vec_rang int)
language sql stable security definer set search_path = public, pg_temp as $$
  with fts as (
    select f.id, f.document_id, row_number() over (order by f.rang desc, f.id) as r
      from pr0_proto.r2_fts(p_query, p_kandidaten, p_document_ids, p_modus, p_peildatum, p_bronsoort, p_scan, p_lek, p_arm) f
  ),
  vec as (
    select v.id, v.document_id, row_number() over (order by v.afstand, v.id) as r
      from pr0_proto.r2_vec(p_embedding, p_kandidaten, p_document_ids, p_modus, p_peildatum, p_bronsoort, p_scan, p_lek, p_iteratief, p_strategie) v
  )
  select coalesce(fts.id, vec.id), coalesce(fts.document_id, vec.document_id),
         (coalesce(1.0 / (p_k + fts.r), 0) + coalesce(1.0 / (p_k + vec.r), 0))::real as rang,
         fts.r::int, vec.r::int
    from fts full outer join vec on fts.id = vec.id
   order by 3 desc, 1
   limit p_limit
$$;
revoke all on function pr0_proto.r2_hybride(text, public.vector, int, int, int, uuid[], text, date, text[], boolean, text, boolean, text, text) from public, anon;
grant execute on function pr0_proto.r2_hybride(text, public.vector, int, int, int, uuid[], text, date, text[], boolean, text, boolean, text, text) to authenticated;

-- R1-functies: zelfde ACL-vorm als zoek_chunks (authenticated + service_role).
revoke all on all functions in schema pr0_proto from public, anon;
grant execute on function pr0_proto.toelaatbare_documenten(uuid[], text, date, text[], uuid, boolean, text) to authenticated, service_role, portaal_beperkt;
grant execute on function pr0_proto.r1_fts(text, int, uuid[], text, date, text[], uuid, boolean, text) to authenticated, service_role, portaal_beperkt;
grant execute on function pr0_proto.r1_fts_plpgsql(text, int, uuid[], text, date, text[], uuid, boolean, text) to authenticated, service_role, portaal_beperkt;
grant execute on function pr0_proto.r1_vec(public.vector, int, uuid[], text, date, text[], uuid, boolean, text, boolean, text, int) to authenticated, service_role, portaal_beperkt;
grant execute on function pr0_proto.r1_hybride(text, public.vector, int, int, int, uuid[], text, date, text[], uuid, boolean, text, boolean, text) to authenticated, service_role, portaal_beperkt;
-- portaal_beperkt heeft in dit prototype óók EXECUTE op r2_* zodat de lekmatrix
-- de rol kan meten (de echte grantbeslissing is een open beslissing in 0217).
grant execute on function pr0_proto.r2_fts(text, int, uuid[], text, date, text[], boolean, text, text) to portaal_beperkt, service_role;
grant execute on function pr0_proto.r2_vec(public.vector, int, uuid[], text, date, text[], boolean, text, boolean, text, int) to portaal_beperkt, service_role;
grant execute on function pr0_proto.r2_hybride(text, public.vector, int, int, int, uuid[], text, date, text[], boolean, text, boolean, text, text) to portaal_beperkt, service_role;
grant execute on function pr0_proto.r2_fonds() to authenticated, portaal_beperkt, service_role;
grant select on pr0_fixture.vragen to authenticated, service_role, portaal_beperkt;
grant usage on schema pr0_fixture to authenticated, service_role, portaal_beperkt;

commit;
