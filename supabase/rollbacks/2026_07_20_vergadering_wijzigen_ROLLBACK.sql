-- ============================================================
--  ROLLBACK 2026-07-20 — Vergadering wijzigen
--
--  Draait 2026_07_20_vergadering_wijzigen.sql terug.
--  LET OP: verwijdert de vergadering_log-tabel inclusief inhoud.
--  Alleen gebruiken als de bijbehorende code-deploy ook is teruggedraaid
--  (de PATCH-route schrijft naar deze tabel en kolommen).
-- ============================================================

drop trigger if exists trg_vergadering_log_no_update on public.vergadering_log;
drop trigger if exists trg_vergadering_log_no_delete on public.vergadering_log;
drop policy if exists "fonds vergadering_log insert" on public.vergadering_log;
drop policy if exists "fonds vergadering_log select" on public.vergadering_log;
drop table if exists public.vergadering_log;

alter table public.vergaderingen
  drop column if exists gewijzigd_op,
  drop column if exists gewijzigd_door;
