-- ROLLBACK migratie 2026-07-06 organisatie_profielen.
drop trigger if exists trg_organisatie_profielen_touch
  on public.organisatie_profielen;
drop policy if exists "organisatieprofiel select eigen fonds"
  on public.organisatie_profielen;
drop table if exists public.organisatie_profielen;
drop function if exists public.fn_organisatie_profielen_touch();
