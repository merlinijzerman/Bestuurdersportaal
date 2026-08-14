-- 2026_08_14_procedure_toelichting_kolommen.sql
--
-- OB-E10: `toelichting` als data bij de bewijslast en de checklist.
-- De standaardset-JSON draagt per requirement én per checklistpunt een
-- toelichting; tot nu bestond die kolom niet in de DB, dus de UI toonde
-- "nog geen toelichting". Deze migratie voegt de nullable kolom toe op:
--   • procedure_requirements  (template-seed; live gelezen door de readiness/
--     evidence-laag — de Bewijsstukken-sectie toont 'm meteen)
--   • procedure_checklist     (instantie-snapshot; nieuwe procedures krijgen de
--     toelichting bij aanmaken)
--
-- Pure additieve, nullable kolommen. Geen policy-, grant- of functiewijziging
-- → structurele gates niet vereist; RLS ongewijzigd (kolom erft de tabel-ACL).
-- Idempotent via `add column if not exists`.

begin;

alter table public.procedure_requirements
  add column if not exists toelichting text;

comment on column public.procedure_requirements.toelichting is
  'OB-E10: bestuurlijke toelichting bij dit bewijsstuk (uit de definitie/standaardset).';

alter table public.procedure_checklist
  add column if not exists toelichting text;

comment on column public.procedure_checklist.toelichting is
  'OB-E10: toelichting bij dit checklistpunt (meegesnapshot uit de definitie bij start).';

commit;
