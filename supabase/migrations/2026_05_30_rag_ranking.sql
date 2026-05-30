-- ============================================================
--  Migratie 2026-05-30 — RAG-verbetering Fase 1a: relevantie-ranking + logging
--
--  Twee wijzigingen (zie RAG-VERBETERING-ONTWERP.md):
--   1. Functie public.zoek_chunks(p_query, p_limit): full-text search op
--      document_chunks mét relevantie-sortering (ts_rank_cd). Nodig omdat
--      supabase-js .textSearch() niet kan ORDER BY ts_rank_cd(...) — de
--      order-parameter kan de tsquery niet aanroepen. De ranking moet dus
--      in de database gebeuren.
--   2. Kolom governance_log.retrieval_meta (jsonb): legt per AI-vraag vast
--      welke chunks zijn opgehaald en welke in de prompt zijn gebruikt.
--
--  SECURITY INVOKER (Postgres-default, hier expliciet): de functie draait als
--  de aanroepende gebruiker, zodat de RLS-policies "fonds chunks" en
--  "fonds documenten" onverkort gelden. Tenant-isolatie wordt NIET omzeild.
--  De functie filtert daarom zelf niet op fonds_id — dat doet RLS, net als de
--  bestaande code in lib/rag.ts (die fondsId ook niet in de query gebruikte).
--
--  Idempotent (create or replace / add column if not exists).
--  Eerst hier in de Supabase SQL Editor draaien, dán code-deploy.
-- ============================================================

-- ── 1. Ranked full-text search functie ───────────────────────────
create or replace function public.zoek_chunks(
  p_query text,
  p_limit int default 20
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
  order by rang desc, c.chunk_index asc
  limit greatest(p_limit, 1);
$$;

comment on function public.zoek_chunks(text, int) is
  'RAG-retrieval met relevantie-sortering (ts_rank_cd). SECURITY INVOKER: RLS op document_chunks/documenten dwingt tenant-isolatie af.';

-- ── 2. Retrieval-logging op governance_log ───────────────────────
alter table public.governance_log
  add column if not exists retrieval_meta jsonb;

comment on column public.governance_log.retrieval_meta is
  'RAG-diagnostiek per vraag: {methode, opgehaald, geselecteerd, chunks:[{id,document_id,rang}]}. Insert-only, append-only-discipline blijft.';

-- ============================================================
--  Verificatie (handmatig in SQL Editor):
--    select id, document_id, rang
--      from public.zoek_chunks('financieringsgraad', 5);
--    -- moet aflopend op rang gesorteerd zijn
--
--    select column_name from information_schema.columns
--     where table_name = 'governance_log' and column_name = 'retrieval_meta';
--    -- moet één rij geven
-- ============================================================
