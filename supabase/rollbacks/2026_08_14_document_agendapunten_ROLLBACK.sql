-- ============================================================================
-- ROLLBACK 2026-08-14 — document_agendapunten
-- ----------------------------------------------------------------------------
-- Draait 2026_08_14_document_agendapunten.sql terug. Idempotent (drop if exists).
--
-- LET OP:
--  * Draai dit alleen als de UI/route (/api/documents/[id]/agendapunten) NIET
--    meer gedeployed is.
--  * Koppelingen zijn HERSTELBARE verwijzingen (geen documenten): het droppen
--    verwijdert alleen de vergaderkoppelingen, niet de onderliggende stukken.
--    Ter informatie loggen we hoeveel koppelingen verdwijnen.
-- ============================================================================

begin;

do $$
declare
  v_aantal integer;
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'document_agendapunten') then
    select count(*) into v_aantal from public.document_agendapunten;
    raise notice 'ROLLBACK document_agendapunten: % koppeling(en) worden verwijderd.', v_aantal;
  end if;
end $$;

drop trigger if exists trg_document_agendapunt_validatie on public.document_agendapunten;
drop function if exists public.fn_document_agendapunt_validatie();
drop table if exists public.document_agendapunten;

commit;
