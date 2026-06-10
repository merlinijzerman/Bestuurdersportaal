-- ============================================================================
-- Migratie: document-scope in de AI-assistent — increment 1
-- ----------------------------------------------------------------------------
-- Voegt een optionele documentscope toe aan de retrieval-RPC's, zodat een
-- AI-vraag kan worden beperkt tot één (of een set) specifiek(e) document(en).
-- Zie ontwerp "AI-vragen over een specifiek document v0.2" §5/§8/§14.
--
-- Scope VÓÓR ranking/fusion (niet client-side nafilteren):
--   - zoek_chunks (FTS): filter in de WHERE, vóór order/limit.
--   - zoek_chunks_hybride (RRF): filter in ZOWEL de fts- als de vec-CTE, zodat
--     de scope vóór de fusion geldt.
-- NULL = hele bibliotheek (bestaande aanroepers blijven ongemoeid via default).
--
-- Signatuurwijziging: een extra parameter wijzigt de functiesignatuur, dus
-- `create or replace` alleen zou een tweede OVERLOAD aanmaken (PostgREST-
-- ambiguïteit + de oude, scope-loze functie blijft bestaan). Daarom eerst
-- `drop function if exists` op de oude signatuur, dan `create` met de nieuwe
-- parameter (default null). Idempotent en zonder afhankelijke objecten.
--
-- `security invoker` + RLS (fonds chunks / fonds documenten) blijven leidend;
-- de scope is ADDITIEF op RLS en verzwakt tenant-isolatie niet.
--
-- Eerst hier in de Supabase SQL Editor draaien, DAARNA de code deployen.
-- ============================================================================

-- ── 1. FTS-route: zoek_chunks met documentscope ─────────────────────────────
drop function if exists public.zoek_chunks(text, int);

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
    and (p_document_ids is null or c.document_id = any(p_document_ids))  -- scope vóór rank
  order by rang desc, c.chunk_index asc
  limit greatest(p_limit, 1);
$$;

comment on function public.zoek_chunks(text, int, uuid[]) is
  'RAG-retrieval met relevantie-sortering (ts_rank_cd) en optionele documentscope (p_document_ids; null = hele bibliotheek, vóór ranking). SECURITY INVOKER: RLS dwingt tenant-isolatie af.';

-- ── 2. Hybride route: zoek_chunks_hybride met documentscope ─────────────────
drop function if exists public.zoek_chunks_hybride(text, vector, int, int, int);

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
      and (p_document_ids is null or dc.document_id = any(p_document_ids))  -- scope vóór RRF
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
      and (p_document_ids is null or dc.document_id = any(p_document_ids))  -- scope vóór RRF
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

-- ── 3. Persistente gespreksscope ────────────────────────────────────────────
-- {type:'single', document_ids:[], titels:[], gezet_op} — zodat een hervat
-- gesprek de scope toont. Raakt het append-only auditspoor (governance_log) niet.
alter table public.gesprekken
  add column if not exists document_scope jsonb;

comment on column public.gesprekken.document_scope is
  'Actieve documentscope van het gesprek: {type, document_ids[], titels[], gezet_op}. NULL = hele bibliotheek.';

-- ============================================================================
-- Verificatie (SQL Editor):
--   -- scope filtert: alle rijen horen bij het meegegeven document
--   select distinct document_id
--     from public.zoek_chunks('beleid', 50, array['<doc-uuid>']::uuid[]);
--   -- zonder scope (null) = hele bibliotheek, ongewijzigd gedrag:
--   select count(*) from public.zoek_chunks('beleid', 20);
--   -- nieuwe kolom bestaat:
--   select column_name from information_schema.columns
--    where table_name = 'gesprekken' and column_name = 'document_scope';
-- ============================================================================
