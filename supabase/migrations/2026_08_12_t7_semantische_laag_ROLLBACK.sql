-- ============================================================================
-- ROLLBACK 2026-08-12 (T7) — datamodel semantische laag + reproduceerbaarheid
-- ----------------------------------------------------------------------------
-- Draait 2026_08_12_t7_semantische_laag.sql volledig terug. Puur additief schema,
-- dus de rollback dropt uitsluitend de nieuwe objecten; geen bestaande tabel of
-- policy is geraakt. Volgorde respecteert de FK-afhankelijkheden
-- (semantic_units → extraction_run/concepts; alle → fondsen/documenten).
--
-- LET OP: dit VERWIJDERT geëxtraheerde units, runs, oordelen en de catalogus.
-- Alleen draaien wanneer T7 bewust wordt teruggetrokken.
--
-- De gedeelde functie public.fn_log_append_only() blijft staan — die is van de
-- audit-logtabellen (2026_07_08) en niet door T7 geïntroduceerd.
--
-- ⚠ Draai hierna óók de bijbehorende terugdraai van de gate-registratie: verwijder
-- 'concepts' weer uit de global-lijst (gate A1) en de select-allowlist (gate C) in
-- supabase/checks/2026_07_31_r1_structurele_gates.sql (handmatig — een checkbestand
-- is geen migratie).
-- Plak dit bestand in Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

begin;

-- Triggers eerst (hangen aan de tabellen).
drop trigger if exists trg_extraction_run_no_update       on public.extraction_run;
drop trigger if exists trg_extraction_run_no_delete       on public.extraction_run;
drop trigger if exists trg_comparison_run_no_update       on public.comparison_run;
drop trigger if exists trg_comparison_run_no_delete       on public.comparison_run;
drop trigger if exists trg_difference_judgements_no_update on public.difference_judgements;
drop trigger if exists trg_difference_judgements_no_delete on public.difference_judgements;

-- Tabellen in omgekeerde afhankelijkheidsvolgorde.
drop table if exists public.semantic_units;         -- → extraction_run, concepts
drop table if exists public.difference_judgements;
drop table if exists public.comparison_run;
drop table if exists public.extraction_run;         -- na semantic_units
drop table if exists public.concepts;               -- na semantic_units

commit;

-- ── Verificatie ───────────────────────────────────────────────────────────────
--   select count(*) from pg_class
--    where relnamespace = 'public'::regnamespace
--      and relname in ('concepts','semantic_units','extraction_run',
--                      'comparison_run','difference_judgements');   -- → 0
