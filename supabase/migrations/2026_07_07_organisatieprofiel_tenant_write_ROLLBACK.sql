-- ============================================================================
-- ROLLBACK 2026-07-07 — Organisatieprofiel tenant-zelfservice schrijf-policies.
-- ----------------------------------------------------------------------------
-- Verwijdert de tenant INSERT/UPDATE-policies. De SELECT-policy (eigen fonds)
-- uit 2026_07_06_organisatie_profielen.sql blijft staan; na deze rollback kan
-- schrijven weer uitsluitend via de service-role (platform-back-office).
-- ============================================================================

drop policy if exists "organisatieprofiel update eigen fonds"
  on public.organisatie_profielen;
drop policy if exists "organisatieprofiel insert eigen fonds"
  on public.organisatie_profielen;
