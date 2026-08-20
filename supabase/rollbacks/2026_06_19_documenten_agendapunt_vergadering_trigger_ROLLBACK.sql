-- ============================================================================
-- ROLLBACK voor 2026_06_19_documenten_agendapunt_vergadering_trigger.sql
-- ============================================================================
drop trigger if exists trg_document_agendapunt_vergadering on public.documenten;
drop function if exists public.fn_document_agendapunt_vergadering_check();
