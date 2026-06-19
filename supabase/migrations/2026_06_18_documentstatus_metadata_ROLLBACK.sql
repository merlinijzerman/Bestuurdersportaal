-- ============================================================================
-- ROLLBACK voor 2026_06_18_documentstatus_metadata.sql
--
-- ALLEEN gebruiken om Increment C (documentstatus + metadata-beheer + review-
-- queue) volledig terug te draaien. Verwijdert de nieuwe tabellen, triggers,
-- functies, constraints en kolommen; schakelt de transitievalidatie uit; en
-- heft de NULL-coulance op door de bronstatus-/status-kolommen te droppen.
-- Volgorde respecteert FK-/trigger-afhankelijkheden.
-- ============================================================================

-- 1. Nieuwe tabellen (koppeltabel, auditlog, review-queue).
drop table if exists public.document_procesinstanties        cascade;
drop table if exists public.document_metadata_log            cascade;
drop table if exists public.document_metadata_review_queue   cascade;

-- 2. Triggers op documenten + bijbehorende functies.
drop trigger if exists trg_document_status_overgang     on public.documenten;
drop trigger if exists trg_document_primair_vs_secundair on public.documenten;
drop function if exists public.fn_document_status_overgang_check();
drop function if exists public.fn_document_primair_vs_secundair_check();
drop function if exists public.fn_document_procesinstantie_validatie();
drop function if exists public.fn_document_status_transitie(text, text);
drop function if exists public.fn_doc_meta_log_immutable();
drop function if exists public.fn_doc_meta_log_hash();

-- 3. Indexen op documenten (de kolom-drops in stap 5 ruimen kolom-indexen mee
--    op, maar partiële indexen droppen we expliciet).
drop index if exists public.idx_documenten_status;
drop index if exists public.idx_documenten_bronstatus;
drop index if exists public.idx_documenten_vergadering;
drop index if exists public.idx_documenten_review;

-- 4. CHECK-constraints op documenten.
alter table public.documenten drop constraint if exists documenten_context_check;
alter table public.documenten drop constraint if exists documenten_documenttype_check;
alter table public.documenten drop constraint if exists documenten_status_check;
alter table public.documenten drop constraint if exists documenten_bronstatus_check;
alter table public.documenten drop constraint if exists documenten_review_status_check;
alter table public.documenten drop constraint if exists documenten_context_dossier_check;
alter table public.documenten drop constraint if exists documenten_context_vergadering_check;
alter table public.documenten drop constraint if exists documenten_agendapunt_vergadering_check;

-- 5. Kolommen op documenten (heft o.a. de NULL-bronstatus-coulance op).
alter table public.documenten
  drop column if exists context,
  drop column if exists vergadering_id,
  drop column if exists documenttype,
  drop column if exists status,
  drop column if exists bronstatus,
  drop column if exists documentdatum,
  drop column if exists geldig_vanaf,
  drop column if exists geldig_tot,
  drop column if exists vervangt_document_id,
  drop column if exists vervangen_door_document_id,
  drop column if exists metadata_te_controleren,
  drop column if exists metadata_review_status,
  drop column if exists metadata_gecontroleerd_door,
  drop column if exists metadata_gecontroleerd_op;

-- NB: laag 1 (documenten.actief) en de primaire procesinstantie_id-koppeling
-- uit Increment B blijven staan — die horen niet bij deze rollback.
