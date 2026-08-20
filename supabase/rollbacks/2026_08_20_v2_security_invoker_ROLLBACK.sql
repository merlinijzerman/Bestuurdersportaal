-- ============================================================================
-- ROLLBACK van 2026_08_20_v2_security_invoker.sql
-- ----------------------------------------------------------------------------
-- WAARSCHUWING: dit herstelt de situatie waarin RLS de definer-views NIET als
-- tweede laag dekt (de views draaien weer als eigenaar `postgres`). Alleen
-- gebruiken bij een aantoonbaar incident.
-- ============================================================================

begin;

alter view public.vw_fondsleden       set (security_invoker = off);
alter view public.vw_governance_audit set (security_invoker = off);
drop policy if exists "profiel select eigen fonds" on public.profielen;

commit;
