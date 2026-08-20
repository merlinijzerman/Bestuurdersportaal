-- ============================================================================
-- ROLLBACK bij 2026-06-24 — RAG R1.1 + R1.2 (structuur-bewuste chunking +
-- contextual retrieval).
-- ----------------------------------------------------------------------------
-- Draait 2026_06_24_rag_structuur_contextueel.sql terug. Pré-productie-vangnet:
-- draai dit alleen als de code-deploy is teruggerold, anders schrijven de
-- ingest-/backfill-paden naar kolommen die hier verdwijnen.
--
-- GEEN DATAVERLIES op de bron: `tekst` is nooit aangeraakt. We herstellen de
-- baseline zoek_vector (to_tsvector('dutch', tekst)) en droppen de R1-kolommen.
-- Bestaande embeddings blijven staan; ze zijn over verrijkte tekst gemaakt en
-- dus lichtelijk "contextueel". Wil je ook de embeddings naar baseline: re-embed
-- vanuit `tekst` via het backfill-pad (dat is een code-actie, geen schema).
--
-- Volgorde gespiegeld t.o.v. de forward-migratie. Idempotent (drop ... if exists).
-- ============================================================================

-- ── 3. reindex_runs (incl. index, policy, RLS vervallen mee) ────────────────
drop table if exists public.reindex_runs;

-- ── 2. zoek_vector terug naar de baseline-expressie ─────────────────────────
drop index if exists public.idx_chunks_zoek;
alter table public.document_chunks drop column if exists zoek_vector;
alter table public.document_chunks
  add column zoek_vector tsvector
  generated always as (to_tsvector('dutch', tekst)) stored;
create index idx_chunks_zoek on public.document_chunks using gin(zoek_vector);

-- ── 1. R1.1 + R1.2-kolommen ─────────────────────────────────────────────────
alter table public.document_chunks
  drop column if exists structuur_type,
  drop column if exists structuur_label,
  drop column if exists context_prefix,
  drop column if exists prefix_model,
  drop column if exists indexering_versie;
