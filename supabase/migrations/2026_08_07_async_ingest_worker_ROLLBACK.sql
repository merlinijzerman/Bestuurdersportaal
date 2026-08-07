-- ============================================================================
-- ROLLBACK 2026-08-07 — Async ingest-worker: jobs-uitbreiding + claim-RPC (F1)
-- ----------------------------------------------------------------------------
-- Draait 2026_08_07_async_ingest_worker.sql terug. Idempotent (drop if exists).
--
-- LET OP: draai dit alleen als de code die de nieuwe kolommen/functie gebruikt
-- (F3/F4-worker) NIET meer gedeployed is. Het laten vallen van fonds_id verwijdert
-- de denorm; open jobs verliezen hun eerlijke-verdeling-sleutel.
-- ============================================================================

begin;

drop function if exists public.documenten_claim_ingest_jobs(text, integer, integer, integer);

drop index if exists public.uq_dpj_open_stap;
drop index if exists public.idx_dpj_claim;

alter table public.document_processing_jobs
  drop column if exists extern_batch_id,
  drop column if exists fonds_id,
  drop column if exists verwerkt_chunks,
  drop column if exists lease_expires_at;

commit;
