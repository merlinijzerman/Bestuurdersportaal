-- ============================================================================
-- ROLLBACK voor 2026_06_22x_ocr_audit.sql
--
-- Verwijdert de OCR-audit-kolommen op documenten. Idempotent. Broninhoud,
-- chunks en alle overige gegevens blijven intact; alleen de herleidbaarheid
-- "is hier OCR toegepast" gaat verloren. Draai dit alleen om besluit 0020
-- terug te draaien.
-- ============================================================================

alter table public.documenten
  drop column if exists ocr_engine,
  drop column if exists ocr_toegepast;
