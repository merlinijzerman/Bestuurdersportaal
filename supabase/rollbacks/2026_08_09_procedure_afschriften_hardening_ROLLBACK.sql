-- ============================================================================
-- ROLLBACK 2026-08-09 (hardening) — T6 procedure_afschriften
-- ----------------------------------------------------------------------------
-- Draait 2026_08_09_procedure_afschriften_hardening.sql terug. Idempotent.
-- Herstelt de UPDATE-policy naar de vorm zónder bureau-uitsluiting (zoals in
-- de basismigratie) en verwijdert de kolombevriezing. De expliciete grants
-- worden NIET teruggedraaid — terugvallen op de default-ACL is juist het gat
-- dat H1 dicht; laat ze staan.
-- ============================================================================

begin;

drop trigger if exists trg_afschrift_bevries_kolommen on public.procedure_afschriften;
drop function if exists public.fn_afschrift_bevries_kolommen();

drop policy if exists "fonds afschriften bijwerken" on public.procedure_afschriften;
create policy "fonds afschriften bijwerken" on public.procedure_afschriften
  for update
  using (fonds_id = (select fonds_id from public.profielen where id = auth.uid()))
  with check (fonds_id = (select fonds_id from public.profielen where id = auth.uid()));

commit;
