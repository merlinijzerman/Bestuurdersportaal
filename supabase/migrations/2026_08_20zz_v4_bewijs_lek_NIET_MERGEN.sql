-- =====================================================================
--  BEWUST LEK — V4 bewijs-test-PR (issue #81). NOOIT MERGEN.
-- ---------------------------------------------------------------------
--  Doel: aantonen dat een verzwakte RLS-policy de blokkerende
--  cross-tenant-gate ROOD maakt en de merge naar `main` blokkeert.
--  R1 GATE C (2026_07_31_r1_structurele_gates.sql) vangt een SELECT-
--  policy met qual = 'true' op een tenanttabel: cross-tenant LEZEN.
--  Deze migratie hoort NOOIT gemerged of op een echte DB toegepast te
--  worden; de PR wordt bewust gesloten zonder mergen.
-- =====================================================================
create policy "v4_bewijs_lek_select_alles"
  on public.documenten
  for select
  to authenticated
  using (true);
