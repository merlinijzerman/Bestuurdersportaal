-- ============================================================================
-- ROLLBACK van 2026_08_05_c1_retrieval_denorm_indexen.sql
-- ----------------------------------------------------------------------------
-- Verwijdert uitsluitend de in C1 toegevoegde indexen. Puur additief teruggedraaid;
-- geen data-, kolom-, RLS- of functie-impact. Idempotent (drop index if exists).
-- Bij CONCURRENTLY-aanmaak: gebruik `drop index concurrently if exists ...`.
-- ============================================================================

drop index if exists public.idx_chunks_status_geldig;
drop index if exists public.idx_chunks_procesinstantie;
drop index if exists public.idx_chunks_documentdatum;
drop index if exists public.idx_documenten_fonds_status;
