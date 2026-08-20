-- ============================================================
--  ROLLBACK van 2026_08_14_procedure_fase_toelichting.sql
--  Verwijdert de per-proces fase-toelichting-tabel en haar policies.
--  Let op: dit wist de vastgelegde toelichtingen. Idempotent.
-- ============================================================

begin;

drop policy if exists "fase-toelichting eigen fonds lezen"
  on public.procedure_fase_toelichting;
drop policy if exists "fase-toelichting toevoegen voorzitter-beheerder"
  on public.procedure_fase_toelichting;
drop policy if exists "fase-toelichting wijzigen voorzitter-beheerder"
  on public.procedure_fase_toelichting;

drop table if exists public.procedure_fase_toelichting;

commit;
