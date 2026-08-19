-- ============================================================================
-- ROLLBACK 2026-06-20g — Increment G retrieval-modusfamilie (schema-deel).
-- ----------------------------------------------------------------------------
-- Draai dit ALLEEN als G volledig wordt teruggedraaid. Herstelt:
--   1. zoek_chunks / zoek_chunks_hybride naar de signatuur+return van
--      2026_06_10_document_scope.sql (documentscope, zonder G-filters).
--   2. droppt gesprekken.actieve_antwoordmodus.
--
-- LET OP — code-volgorde: deploy EERST de vorige code-versie (die de oude
-- RPC-signaturen aanroept), draai DAN deze rollback. Anders roept de live code
-- een functie aan met een signatuur die niet meer bestaat.
-- Idempotent: drop function if exists op de G-signaturen.
-- ============================================================================

-- ── 1. Drop de G-signaturen ─────────────────────────────────────────────────
drop function if exists public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[]);
drop function if exists public.zoek_chunks_hybride(text, vector, int, int, int, uuid[], text[], text[], uuid[], text, date, text[]);

-- ── 2. Herstel zoek_chunks (documentscope-versie, 2026_06_10) ───────────────
create or replace function public.zoek_chunks(
  p_query        text,
  p_limit        int default 20,
  p_document_ids uuid[] default null
)
returns table (
  id          uuid,
  document_id uuid,
  tekst       text,
  pagina      int,
  paragraaf   text,
  chunk_index int,
  titel       text,
  bron        text,
  bibliotheek text,
  opslag_pad  text,
  rang        real
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.document_id,
    c.tekst,
    c.pagina,
    c.paragraaf,
    c.chunk_index,
    d.titel,
    d.bron,
    d.bibliotheek,
    d.opslag_pad,
    ts_rank_cd(c.zoek_vector, q.query) as rang
  from public.document_chunks c
  join public.documenten d on d.id = c.document_id
  cross join websearch_to_tsquery('dutch', p_query) as q(query)
  where d.actief = true
    and c.zoek_vector @@ q.query
    and (p_document_ids is null or c.document_id = any(p_document_ids))
  order by rang desc, c.chunk_index asc
  limit greatest(p_limit, 1);
$$;

comment on function public.zoek_chunks(text, int, uuid[]) is
  'RAG-retrieval met relevantie-sortering (ts_rank_cd) en optionele documentscope (p_document_ids; null = hele bibliotheek, vóór ranking). SECURITY INVOKER: RLS dwingt tenant-isolatie af.';

-- ── 3. Herstel zoek_chunks_hybride (documentscope-versie, 2026_06_10) ───────
create or replace function public.zoek_chunks_hybride(
  p_query        text,
  p_embedding    vector(1024),
  p_limit        int default 10,
  p_kandidaten   int default 40,
  p_k            int default 60,
  p_document_ids uuid[] default null
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
      and (p_document_ids is null or dc.document_id = any(p_document_ids))
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
      and (p_document_ids is null or dc.document_id = any(p_document_ids))
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

comment on function public.zoek_chunks_hybride(text, vector, int, int, int, uuid[]) is
  'Hybride RAG-retrieval (FTS+vector via RRF) met optionele documentscope (p_document_ids; null = hele bibliotheek, vóór fusion in beide armen). SECURITY INVOKER: RLS dwingt tenant-isolatie af.';

-- ── 4. Drop de gespreksmodus-kolom ──────────────────────────────────────────
alter table public.gesprekken
  drop column if exists actieve_antwoordmodus;
