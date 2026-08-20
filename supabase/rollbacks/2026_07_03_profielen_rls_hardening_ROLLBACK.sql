-- ============================================================================
-- ROLLBACK 2026-07-03 — profielen-RLS hardening (CR-K1)
-- ----------------------------------------------------------------------------
-- Herstelt de situatie van vóór 2026_07_03_profielen_rls_hardening.sql.
-- LET OP: de oude FOR ALL-policy zonder WITH CHECK is de kwetsbare situatie
-- uit bevinding CR-K1. Alleen gebruiken als de hardening een regressie
-- veroorzaakt, en dan zo snel mogelijk een gecorrigeerde hardening uitrollen.
-- ============================================================================

begin;

drop trigger if exists trg_profiel_bevries_kolommen on public.profielen;
drop function if exists public.fn_profiel_bevries_kolommen();

drop policy if exists "profiel select eigen" on public.profielen;
drop policy if exists "profiel update eigen" on public.profielen;

drop policy if exists "eigen profiel" on public.profielen;
create policy "eigen profiel" on public.profielen
  for all using (auth.uid() = id);

commit;
