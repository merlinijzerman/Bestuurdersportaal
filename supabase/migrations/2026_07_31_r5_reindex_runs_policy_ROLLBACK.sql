-- ============================================================================
--  ROLLBACK 2026-07-31 — R5: reindex_runs-policy
--
--  Zet de handgeschreven productietoestand terug: policy "reindex_runs eigen
--  fonds" zonder expliciete WITH CHECK.
--
--  Anders dan bij de R2- en R3-rollbacks opent dit géén lek: de USING-expressie
--  bevat fonds_id zelf, dus de terugval toetst de schrijfkant nog steeds op het
--  eigen fonds. Wat je verliest is de expliciete formulering (en daarmee gate G,
--  die weer rood wordt) en de overeenkomst met de migratie in de repo.
--
--  De index uit R5 (idx_reindex_runs_fonds) laten we staan: die komt uit
--  migratie 2026_06_24 en hoort er hoe dan ook te zijn.
-- ============================================================================

begin;

drop policy if exists "fonds reindex_runs" on public.reindex_runs;

create policy "reindex_runs eigen fonds" on public.reindex_runs
  for all
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

commit;
