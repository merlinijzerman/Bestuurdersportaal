-- R1b: kandidaat voor hybride retrieval met RLS als primaire tenantgrens.
-- Deze migratie is alleen lokaal voorbereid; Preview/Productie vergen elk een
-- afzonderlijke releasepoort. De bestaande functie en HNSW-index blijven staan.
-- De nieuwe RPC wordt uitsluitend achter ZOEK_HYBRIDE_V2 + fondsvlag gebruikt.

-- Deze migratie (P2) BOUWT GEEN INDEX. De partiële HNSW-index wordt vooraf en
-- buiten elke transactie concurrent gebouwd (fase P1,
-- scripts/ops/r1b/p1-partiele-index-concurrent.psql; lokaal/CI doet
-- scripts/testdb-apply-migrations.sh dat expliciet vlak vóór deze migratie).
-- P2 accepteert fail-closed UITSLUITEND een geldige, gerede index met de
-- gepinde definitie; ontbreekt hij, is hij ongeldig of wijkt hij af ⇒ weigeren,
-- ongeacht de tabelgrootte. Zo kan een overgeslagen P1 nooit een blokkerende
-- HNSW-bouw binnen deze migratie veroorzaken.
set lock_timeout = '5s';

do $$
begin
  if to_regclass('public.idx_chunks_embedding_generiek_r1b') is null then
    raise exception 'R1b-migratie geweigerd: partiële index ontbreekt; voer eerst P1 uit (concurrente bouw, scripts/ops/r1b)';
  end if;
  if exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'idx_chunks_embedding_generiek_r1b'
      and not (i.indisvalid and i.indisready)
  ) then
    raise exception 'R1b-migratie geweigerd: idx_chunks_embedding_generiek_r1b bestaat maar is ongeldig (afgebroken concurrente bouw); eerst H4b en P1 opnieuw';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'idx_chunks_embedding_generiek_r1b'
      and i.indisvalid and i.indisready
      and pg_catalog.pg_get_indexdef(i.indexrelid) =
        'CREATE INDEX idx_chunks_embedding_generiek_r1b ON public.document_chunks USING hnsw (embedding vector_cosine_ops) WITH (m=''32'', ef_construction=''256'') WHERE (bibliotheek = ''generiek''::text)'
  ) then
    raise exception 'R1b-migratie geweigerd: partiële index heeft een afwijkende definitie';
  end if;
end $$;

create or replace function public.zoek_chunks_hybride_begrensd(
  p_query               text,
  p_embedding           vector(1024),
  p_limit               int    default 10,
  p_kandidaten          int    default 40,
  p_k                   int    default 60,
  p_document_ids        uuid[] default null,
  p_bronstatus          text[] default null,
  p_documentstatus      text[] default null,
  p_procesinstantie_ids uuid[] default null,
  p_modus               text   default 'alles',
  p_peildatum           date   default current_date,
  p_bronsoort           text[] default null,
  p_fonds_id            uuid   default null
)
returns table (
  id uuid, document_id uuid, tekst text, pagina int, paragraaf text,
  chunk_index int, titel text, bron text, bibliotheek text, opslag_pad text,
  rang real, fts_rang int, vec_rang int, documentstatus text, bronstatus text,
  documentdatum date, geldig_vanaf date, geldig_tot date,
  procesinstantie_id uuid, bronorganisatie text, normgewicht text,
  extern_url text, fonds_id uuid, volgende_review date, wettelijk_regime text
)
language plpgsql stable security invoker
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_docs uuid[];
  v_fonds_ok uuid[];
  v_review_ok uuid[];
  v_own_fonds_docs uuid[];
  v_tsq tsquery := websearch_to_tsquery('dutch', p_query);
  v_fts_ids uuid[] := '{}'::uuid[];
  v_vec_ids uuid[] := '{}'::uuid[];
  v_gen_ids uuid[] := '{}'::uuid[];
  v_gen_dist float8[] := '{}'::float8[];
  v_fund_ids uuid[] := '{}'::uuid[];
  v_fund_dist float8[] := '{}'::float8[];
  v_count int;
  v_n_exact int := 9000; -- onderzoekswaarde; vóór activering opnieuw besluiten
  v_ef int := 400;       -- onderzoekswaarde; vóór activering opnieuw besluiten
  v_prev_seqscan text;
  v_prev_bitmapscan text;
  v_prev_sort text;
  v_prev_ef text;
  v_prev_iterative text;
  v_filter constant text := $filter$
        c.document_id = any($1)
    and c.documentstatus is distinct from 'gearchiveerd'
    and ($4::uuid[] is null or c.document_id = any($4))
    and ($5::text is distinct from 'actueel' or (
      c.documentstatus in ('vastgesteld','van_kracht')
      and coalesce(c.bronstatus,'actief') = 'actief'
      and (c.geldig_vanaf is null or c.geldig_vanaf <= $6)
      and (c.geldig_tot is null or c.geldig_tot >= $6)
    ))
    and ($7::text[] is null or coalesce(c.bronstatus,'actief') = any($7))
    and ($8::text[] is null or c.documentstatus = any($8))
    and ($9::uuid[] is null or c.procesinstantie_id = any($9))
    and ($10::text[] is null or c.bibliotheek = any($10))
    and ($11::uuid is null or c.document_id = any($2) or c.bibliotheek = 'generiek')
    and (c.bibliotheek is distinct from 'generiek' or (
      c.documentstatus = 'van_kracht'
      and coalesce(c.bronstatus,'actief') = 'actief'
      and c.document_id = any($3)
    ))
  $filter$;
begin
  -- Onder RLS eerst de toelaatbare documenten. Het app-filter op scanbewijs
  -- blijft een tweede, strengere poort en is niet in deze RPC nagemaakt.
  select coalesce(array_agg(d.id), '{}'::uuid[]),
         coalesce(array_agg(d.id) filter (
           where p_fonds_id is null or d.fonds_id = p_fonds_id), '{}'::uuid[]),
         coalesce(array_agg(d.id) filter (
           where d.volgende_review is null or d.volgende_review >= p_peildatum), '{}'::uuid[]),
         coalesce(array_agg(d.id) filter (
           where d.bibliotheek = 'fonds' and
                 (p_fonds_id is null or d.fonds_id = p_fonds_id)), '{}'::uuid[])
    into v_docs, v_fonds_ok, v_review_ok, v_own_fonds_docs
    from public.documenten d
   where d.actief = true
     and (p_document_ids is null or d.id = any(p_document_ids));

  -- R1-vorm voor FTS: de tsquery is een variabele en de dynamische SQL krijgt
  -- een custom plan. De resultaatvolgorde blijft (ts_rank_cd desc, id).
  execute 'select coalesce(array_agg(x.id order by x.score desc, x.id), ''{}''::uuid[])
             from (select c.id, ts_rank_cd(c.zoek_vector, $13) as score
                     from public.document_chunks c
                    where c.zoek_vector @@ $13 and ' || v_filter || '
                    order by ts_rank_cd(c.zoek_vector, $13) desc, c.id
                    limit $12) x'
    into v_fts_ids
    using v_docs, v_fonds_ok, v_review_ok, p_document_ids, p_modus,
          p_peildatum, p_bronstatus, p_documentstatus, p_procesinstantie_ids,
          p_bronsoort, p_fonds_id, p_kandidaten, v_tsq;

  -- Beslissing stopt na N_exact + 1 toelaatbare rijen en leest geen vector-TOAST.
  execute 'select count(*)::int from (
             select 1 from public.document_chunks c
              where c.embedding is not null and ' || v_filter || '
              limit $12) x'
    into v_count
    using v_docs, v_fonds_ok, v_review_ok, p_document_ids, p_modus,
          p_peildatum, p_bronstatus, p_documentstatus, p_procesinstantie_ids,
          p_bronsoort, p_fonds_id, v_n_exact + 1;

  if v_count <= v_n_exact then
    -- + 0 maakt de afstandssortering bewust niet indexeerbaar: dit is exact.
    execute 'select coalesce(array_agg(x.id order by x.dist, x.id), ''{}''::uuid[])
               from (select c.id, (c.embedding <=> $13)::float8 as dist
                       from public.document_chunks c
                      where c.embedding is not null and ' || v_filter || '
                      order by (c.embedding <=> $13) + 0, c.id
                      limit $12) x'
      into v_vec_ids
      using v_docs, v_fonds_ok, v_review_ok, p_document_ids, p_modus,
            p_peildatum, p_bronstatus, p_documentstatus, p_procesinstantie_ids,
            p_bronsoort, p_fonds_id, p_kandidaten, p_embedding;
  else
    -- Grote set: partiële HNSW alleen voor generiek; de fondsarm blijft exact.
    -- Sla de sessie-instellingen op en herstel ze vóór de exacte fondsarm.
    v_prev_seqscan := current_setting('enable_seqscan');
    v_prev_bitmapscan := current_setting('enable_bitmapscan');
    v_prev_sort := current_setting('enable_sort');
    v_prev_ef := current_setting('hnsw.ef_search');
    v_prev_iterative := current_setting('hnsw.iterative_scan');
    begin
      perform set_config('hnsw.ef_search', v_ef::text, true);
      perform set_config('hnsw.iterative_scan', 'off', true);
      perform set_config('enable_seqscan', 'off', true);
      perform set_config('enable_bitmapscan', 'off', true);
      perform set_config('enable_sort', 'off', true);
      execute 'select coalesce(array_agg(x.id order by x.dist, x.id), ''{}''::uuid[]),
                      coalesce(array_agg(x.dist order by x.dist, x.id), ''{}''::float8[])
                 from (select c.id, (c.embedding <=> $13)::float8 as dist
                         from public.document_chunks c
                        where c.bibliotheek = ''generiek''
                          and c.embedding is not null and ' || v_filter || '
                        order by c.embedding <=> $13, c.id
                        limit $12) x'
        into v_gen_ids, v_gen_dist
        using v_docs, v_fonds_ok, v_review_ok, p_document_ids, p_modus,
              p_peildatum, p_bronstatus, p_documentstatus, p_procesinstantie_ids,
              p_bronsoort, p_fonds_id, p_kandidaten, p_embedding;
    exception when others then
      -- Het subtransactionele blok draait de SET LOCAL-wijzigingen terug.
      -- Een databasefout wordt nooit als een lege kandidaatset behandeld.
      raise;
    end;
    perform set_config('enable_seqscan', v_prev_seqscan, true);
    perform set_config('enable_bitmapscan', v_prev_bitmapscan, true);
    perform set_config('enable_sort', v_prev_sort, true);
    perform set_config('hnsw.ef_search', v_prev_ef, true);
    perform set_config('hnsw.iterative_scan', v_prev_iterative, true);

    -- De exacte fondsarm loopt alleen via document-id's van de zichtbare eigen
    -- fondsdocumenten, nooit via de index van alle fondsen (B0.4-fix).
    if cardinality(v_own_fonds_docs) > 0 then
      execute 'select coalesce(array_agg(x.id order by x.dist, x.id), ''{}''::uuid[]),
                      coalesce(array_agg(x.dist order by x.dist, x.id), ''{}''::float8[])
                 from (select c.id, (c.embedding <=> $13)::float8 as dist
                         from public.document_chunks c
                        where c.bibliotheek = ''fonds''
                          and c.document_id = any($14)
                          and c.embedding is not null and ' || v_filter || '
                        order by (c.embedding <=> $13) + 0, c.id
                        limit $12) x'
        into v_fund_ids, v_fund_dist
        using v_docs, v_fonds_ok, v_review_ok, p_document_ids, p_modus,
              p_peildatum, p_bronstatus, p_documentstatus, p_procesinstantie_ids,
              p_bronsoort, p_fonds_id, p_kandidaten, p_embedding,
              v_own_fonds_docs;
    end if;

    -- Eén globale vectortop-k op afstand vóór de RRF-fusie.
    select coalesce(array_agg(top.id order by top.dist, top.id), '{}'::uuid[])
      into v_vec_ids
      from (select unioned.id, unioned.dist
              from (
                select g.id, g.dist from unnest(v_gen_ids, v_gen_dist) as g(id, dist)
                union all
                select f.id, f.dist from unnest(v_fund_ids, v_fund_dist) as f(id, dist)
              ) unioned
             order by unioned.dist, unioned.id
             limit p_kandidaten) top;
  end if;

  -- Fusie over maximaal 2 × p_kandidaten ids, daarna pas tekst/materialisatie.
  return query
  with f as (select u.cid, u.r from unnest(v_fts_ids) with ordinality as u(cid, r)),
       v as (select u.cid, u.r from unnest(v_vec_ids) with ordinality as u(cid, r)),
       samen as (
         select coalesce(f.cid, v.cid) as cid, f.r as fr, v.r as vr,
                coalesce(1.0 / (p_k + f.r), 0) + coalesce(1.0 / (p_k + v.r), 0) as rrf
           from f full outer join v on f.cid = v.cid
       )
  select c.id, c.document_id, c.tekst, c.pagina, c.paragraaf, c.chunk_index,
         d.titel, d.bron, d.bibliotheek, d.opslag_pad,
         s.rrf::real, s.fr::int, s.vr::int,
         c.documentstatus, c.bronstatus, c.documentdatum,
         c.geldig_vanaf, c.geldig_tot, c.procesinstantie_id,
         c.bronorganisatie, c.normgewicht, c.extern_url,
         d.fonds_id, d.volgende_review, c.wettelijk_regime
    from samen s
    join public.document_chunks c on c.id = s.cid
    join public.documenten d on d.id = c.document_id
   where d.actief = true
   order by s.rrf desc, c.id
   limit p_limit;
end
$fn$;

revoke all on function public.zoek_chunks_hybride_begrensd(
  text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid
) from public, anon;
grant execute on function public.zoek_chunks_hybride_begrensd(
  text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid
) to authenticated, service_role;

comment on function public.zoek_chunks_hybride_begrensd(
  text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[], uuid
) is 'R1b onderzoeksroute: RLS-invoker, exacte kleine scopes, generieke partiële HNSW en exacte fondsarm. Standaard niet aangeroepen; activering vergt eigen poorten.';
