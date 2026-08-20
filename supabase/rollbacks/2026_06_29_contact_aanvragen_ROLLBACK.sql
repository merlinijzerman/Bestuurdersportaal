-- ============================================================================
-- ROLLBACK 2026-06-29 — contact_aanvragen.
-- ----------------------------------------------------------------------------
-- LET OP: dit verwijdert de tabel inclusief opgeslagen contactinzendingen.
-- Alleen draaien als de tabel nog leeg/ongebruikt is (W0: geen code hangt eraan).
-- De DELETE-blokkerende trigger wordt hieronder eerst expliciet verwijderd,
-- zodat DROP TABLE niet door de append-only-trigger wordt tegengehouden
-- (DROP TABLE vuurt geen row-delete-trigger, maar we ruimen netjes op).
-- ============================================================================

drop trigger if exists trg_contact_aanvragen_no_delete on public.contact_aanvragen;
drop function if exists public.fn_contact_aanvragen_no_delete();
drop table if exists public.contact_aanvragen;
