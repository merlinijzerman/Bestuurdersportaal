-- ============================================================================
-- ROLLBACK 2026-07-15 — bron_whitelist (Scenario A live web-retrieval, 0072).
-- ----------------------------------------------------------------------------
-- Verwijdert de whitelist-tabellen, triggers en functies. LET OP: de app-code
-- die de whitelist leest/beheert moet EERST teruggedraaid zijn (env-vlag
-- WEB_RETRIEVAL_ACTIEF uit + deploy zonder de web-retrieval-tak), anders leest de
-- chat-route naar een niet-bestaande tabel.
-- ============================================================================

begin;

drop trigger if exists trg_bron_whitelist_log_no_update on public.bron_whitelist_log;
drop trigger if exists trg_bron_whitelist_log_no_delete on public.bron_whitelist_log;
drop trigger if exists trg_bron_whitelist_log_hash      on public.bron_whitelist_log;
drop function if exists public.fn_bron_whitelist_log_immutable();
drop function if exists public.fn_bron_whitelist_log_hash();

drop table if exists public.bron_whitelist_log;
drop table if exists public.bron_whitelist;

commit;
