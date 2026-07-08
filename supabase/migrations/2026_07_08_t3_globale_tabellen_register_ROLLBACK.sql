-- ============================================================================
-- ROLLBACK 2026-07-08 — T3 register van globale/hybride referentietabellen
-- ----------------------------------------------------------------------------
-- Verwijdert het T3-tabelcommentaar. Zuiver documentair; geen functioneel effect.
-- ============================================================================

begin;

comment on table public.fondsen is null;
comment on table public.procedure_requirements is null;
comment on table public.gremia is null;
comment on table public.expertises is null;
comment on table public.kritische_focusgebieden is null;
comment on table public.documenten is null;
comment on table public.document_inzage is null;
comment on table public.document_metadata_log is null;

commit;
