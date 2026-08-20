-- ============================================================================
--  ROLLBACK 2026-07-31 — R4: granthygiëne
--
--  ⚠️  Dit zet de Supabase-standaardgrant terug: `anon` en `authenticated`
--  krijgen opnieuw ALLE rechten op ALLE tabellen in `public`, inclusief TRUNCATE
--  (dat door RLS niet wordt afgedekt en de append-only auditsporen leegbaar
--  maakt) en INSERT voor de publieke anon-key.
--
--  Draai dit alleen als na R4 een functioneel pad aantoonbaar breekt, en trek
--  dan daarna gericht opnieuw in in plaats van deze toestand te laten staan.
--  Noteer in dat geval welk pad brak — de analyse in R4 zei dat er geen zou
--  zijn, dus een breuk is zelf een bevinding.
--
--  De expliciete revoke op rate_limit_events (2026_06_10_rate_limiting.sql)
--  wordt hieronder opnieuw toegepast, zodat de rollback die maatregel niet
--  stilzwijgend ongedaan maakt.
-- ============================================================================

begin;

grant all on all tables in schema public to anon, authenticated;

alter default privileges in schema public
  grant all on tables to anon, authenticated;

-- Maatregel uit 2026_06_10_rate_limiting.sql opnieuw zetten.
revoke all on public.rate_limit_events from anon, authenticated;

commit;
