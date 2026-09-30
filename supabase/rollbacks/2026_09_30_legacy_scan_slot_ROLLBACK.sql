-- Terugdraaien van 2026_09_30_legacy_scan_slot.sql.
-- VOLGORDE: eerst de applicatiecode terugzetten (of WP3_MALWARESCAN_AAN uit /
-- LEGACY_SCAN_BATCH=0), dan deze rollback. Nieuwe code zonder kolom enqueuet
-- geen legacy-scans meer (fail-closed). Data: de slotmarkering op historische
-- jobs verdwijnt; jobstatus/foutcodes blijven. Idempotent.
begin;
drop index if exists public.uq_dpj_legacy_slot_open;
alter table public.document_processing_jobs
  drop constraint if exists document_processing_jobs_legacy_slot_check;
alter table public.document_processing_jobs
  drop column if exists legacy_slot;
commit;
