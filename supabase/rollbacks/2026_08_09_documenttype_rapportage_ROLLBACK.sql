-- ============================================================================
-- ROLLBACK 2026-08-09 — Documenttype `rapportage` terugdraaien
-- ----------------------------------------------------------------------------
-- Herstelt de CHECK-constraint `documenten_documenttype_check` naar de lijst
-- ZONDER `rapportage`.
--
-- LET OP: draai deze rollback alleen als er geen enkele rij `documenttype =
-- 'rapportage'` heeft — anders faalt de oude constraint. Controleer eerst:
--   select count(*) from public.documenten where documenttype = 'rapportage';
-- Is dat > 0, herclassificeer die rijen (bv. naar 'overig') vóór de rollback.
-- ============================================================================

begin;

alter table public.documenten drop constraint if exists documenten_documenttype_check;
alter table public.documenten add  constraint documenten_documenttype_check
  check (documenttype is null or documenttype in (
    'beleid','besluit','besluitdocument','besluitregistratie','bestuursvoorstel',
    'notulen','advies','memo','analyse','bijlage','overig'));

commit;
