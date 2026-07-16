-- ============================================================================
-- ROLLBACK 2026-07-17 — T15: RPC stuurinfo_soli_opslaan
-- ----------------------------------------------------------------------------
-- Draait 2026_07_17_t15_stuurinfo_spreiding_soli.sql terug: verwijdert de RPC.
-- Er waren geen schema-/data-/policywijzigingen. Draai desgewenst eerst de
-- seed-rollback (2026_07_17_t15b_…_ROLLBACK.sql) — volgorde maakt technisch
-- niet uit (de seed gebruikt de RPC niet), maar zo blijft de repo-conventie
-- (seed-rollback vóór structuur-rollback) intact.
-- ============================================================================

begin;

drop function if exists public.stuurinfo_soli_opslaan(
  text, text, jsonb, numeric, numeric, numeric
);

commit;

-- ── Verificatie (handmatig ná de rollback) ─────────────────────────────────
-- select count(*) from pg_proc where proname = 'stuurinfo_soli_opslaan';  -- 0
