-- ============================================================================
-- ROLLBACK 2026-08-13 (T5) — comparison_results + schrijffunctie
-- ----------------------------------------------------------------------------
-- Draait 2026_08_13_t5_vergelijking.sql volledig terug. Puur additief, dus de
-- rollback dropt uitsluitend de nieuwe objecten; comparison_run (T7) en de gedeelde
-- functie public.fn_log_append_only() blijven staan.
--
-- LET OP: dit VERWIJDERT vastgelegde vergelijkingsbevindingen (comparison_results).
-- De comparison_run-headers blijven bestaan (T7-tabel); alleen de detail-rijen en
-- de T5-schrijffunctie verdwijnen. Alleen draaien wanneer T5 bewust wordt teruggetrokken.
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

-- Functie eerst (hangt niet aan de tabel, maar netjes vóór de drop).
drop function if exists public.fn_schrijf_vergelijking(text,text,text,text,jsonb);

-- Triggers (hangen aan de tabel).
drop trigger if exists trg_comparison_results_no_update on public.comparison_results;
drop trigger if exists trg_comparison_results_no_delete on public.comparison_results;

-- Tabel.
drop table if exists public.comparison_results;   -- → comparison_run, documenten, concepts

commit;

-- ── Verificatie ───────────────────────────────────────────────────────────────
--   select count(*) from pg_class
--    where relnamespace = 'public'::regnamespace and relname = 'comparison_results';  -- → 0
--   select count(*) from pg_proc
--    where proname = 'fn_schrijf_vergelijking';                                        -- → 0
