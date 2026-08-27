-- ============================================================================
-- ROLLBACK — W11 handelingen_log (2026_08_26_w11_handelingen_log.sql)
-- ----------------------------------------------------------------------------
-- Verwijdert de handelingslog-infrastructuur volledig. Alleen veilig zolang de
-- code de throw-stub nog draait (fn_schrijf_handeling nog niet aangeroepen) én
-- ENFORCE_AUDIT uit staat. Draai deze rollback vóór het terugdraaien van de
-- code-deploy, niet erna.
-- ============================================================================

drop trigger if exists trg_handelingen_no_update on public.handelingen_log;
drop trigger if exists trg_handelingen_retentie   on public.handelingen_log;
drop policy   if exists "handelingen lezen met capability" on public.handelingen_log;

drop function if exists public.fn_handelingen_snoei();
drop function if exists public.fn_schrijf_handeling(text, text, text, int, uuid);
drop function if exists public.mag_handelingen_lezen(uuid);
drop function if exists public.fn_handelingen_retentie_guard();

drop table if exists public.handelingen_log;
drop table if exists public.handelingen_lees_grants;
