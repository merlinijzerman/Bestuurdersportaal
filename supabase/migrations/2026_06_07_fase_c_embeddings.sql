-- ============================================================================
-- Migratie: Fase C fundament — pgvector + embedding-kolom op document_chunks
-- ----------------------------------------------------------------------------
-- Voegt semantische vector-search-infrastructuur toe NAAST de bestaande FTS.
-- Puur additief: zolang er geen embeddings gevuld zijn en de hybride RPC/route
-- nog niet live is, verandert het zoekgedrag niet. De bestaande retrieval
-- (zoek_chunks / FTS) blijft volledig intact.
--
-- Embedding-bron: Mistral `mistral-embed` → 1024 dimensies (zie
-- `04 Technische inrichting/Bestuurdersportaal - Fase C hybride retrieval ontwerp`).
-- `embedding_model` legt per chunk vast welk model de embedding maakte, zodat
-- bij een modelwissel gericht ge-her-embed kan worden (lifecycle, §5b ontwerp).
--
-- Idempotent: veilig herhaaldelijk uit te voeren. Eerst in Supabase draaien,
-- daarna de code deployen.
-- ============================================================================

create extension if not exists vector;

alter table public.document_chunks
  add column if not exists embedding vector(1024);
alter table public.document_chunks
  add column if not exists embedding_model text;

-- HNSW-index met cosine-afstand voor snelle semantische nabijheid.
-- pgvector slaat NULL-embeddings over; chunks zonder embedding blijven via FTS
-- vindbaar (graceful degradation).
create index if not exists idx_chunks_embedding
  on public.document_chunks using hnsw (embedding vector_cosine_ops);
