-- ============================================================================
-- ROLLBACK voor 2026_06_22_profiel_rpc.sql
--
-- Verwijdert uitsluitend de transactionele opslag-RPC. De profiel-tabellen,
-- kolommen en RLS uit 2026_06_22_profiel.sql blijven intact (draai die rollback
-- apart als je heel Increment F wilt terugdraaien).
--
-- LET OP: na deze rollback faalt /api/profiel PATCH (de route roept de RPC aan).
-- Draai deze rollback alleen samen met een code-revert naar de losse-statements-
-- variant, of als opmaat naar de volledige F-rollback.
-- ============================================================================

drop function if exists public.profiel_opslaan(
  text, uuid, text, text, text, uuid[], uuid[], uuid[]
);
