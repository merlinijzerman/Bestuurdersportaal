-- ============================================================================
-- Migratie: hybride zoek-RPC (Fase C) — FTS + vector versmolten via RRF
-- ----------------------------------------------------------------------------
-- Nieuwe functie NAAST zoek_chunks; die FTS-route blijft bestaan als fundament
-- en fallback. `security invoker` zodat RLS (fonds chunks / fonds documenten)
-- onverkort geldt; `set search_path` tegen injection. Chunks zonder embedding
-- doen mee via de FTS-arm (graceful degradation).
--
-- RRF: per chunk 1/(k + rang) over de FTS- en de vector-ranglijst; k=60 is een
-- gangbare, ongevoelige standaard. De full outer join zorgt dat een chunk die
-- in slechts één lijst staat, alsnog meetelt.
--
-- Idempotent (create or replace). Eerst in Supabase draaien, dan code-deploy.
-- ============================================================================

create or replace function public.zoek_chunks_hybride(
  p_query      text,
  p_embedding  vector(1024),
  p_limit      int default 10,
  p_kandidaten int default 40,
  p_k          int default 60
)
returns table (
  id uuid,
  document_id uuid,
  tekst text,
  pagina int,
  paragraaf text,
  chunk_index int,
  titel text,
  bron text,
  bibliotheek text,
  opslag_pad text,
  rang real,
  fts_rang int,
  vec_rang int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with q as (
    select websearch_to_tsquery('dutch', p_query) as tsq
  ),
  fts as (
    select dc.id,
           row_number() over (order by ts_rank_cd(dc.zoek_vector, q.tsq) desc) as r
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
    cross join q
    where d.actief = true
      and dc.zoek_vector @@ q.tsq
    order by ts_rank_cd(dc.zoek_vector, q.tsq) desc
    limit p_kandidaten
  ),
  vec as (
    select dc.id,
           row_number() over (order by dc.embedding <=> p_embedding) as r
    from public.document_chunks dc
    join public.documenten d on d.id = dc.document_id
    where d.actief = true
      and dc.embedding is not null
    order by dc.embedding <=> p_embedding
    limit p_kandidaten
  ),
  samen as (
    select coalesce(fts.id, vec.id) as id,
           fts.r as fts_rang,
           vec.r as vec_rang,
           coalesce(1.0 / (p_k + fts.r), 0) + coalesce(1.0 / (p_k + vec.r), 0) as rrf
    from fts
    full outer join vec on fts.id = vec.id
  )
  select dc.id, dc.document_id, dc.tekst, dc.pagina, dc.paragraaf, dc.chunk_index,
         d.titel, d.bron, d.bibliotheek, d.opslag_pad,
         s.rrf::real as rang, s.fts_rang, s.vec_rang
  from samen s
  join public.document_chunks dc on dc.id = s.id
  join public.documenten d on d.id = dc.document_id
  where d.actief = true
  order by s.rrf desc
  limit p_limit;
$$;
