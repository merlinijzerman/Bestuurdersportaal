-- ============================================================================
-- ROLLBACK van 2026_09_23_434_adapterstand_fonds.sql
-- ----------------------------------------------------------------------------
-- Verwijdert het fondsbrede aggregatiepad. Daarna valt de beheerstand terug op
-- het RLS-beperkte tabelpad en LABELT zichzelf als `eigen_beurten`; zij claimt
-- dus niet alsnog fondsbreed te zijn. Dat is bewust: het leesrecht van
-- `governance_log` verandert hierdoor niet en er blijft niets achter.
-- ============================================================================
drop function if exists public.fn_adapterstand_fonds(integer);
