-- ============================================================================
-- ROLLBACK — 2026_10_06_r1b_chunks_bibliotheek_borging.sql
-- ----------------------------------------------------------------------------
-- Zet de integriteitsborging terug naar de stand vóór de migratie:
--   FK document_chunks_document_bibliotheek_fkey weg, unique
--   documenten_id_bibliotheek_key weg, document_chunks.document_id en
--   .bibliotheek weer nullable; eventuele hulp-CHECK's uit een onderbroken
--   forward-run weg.
-- GEEN dataverlies: er worden alleen constraints verwijderd; geen rij, kolom of
-- waarde verandert. Elke stap is een eigen transactie met lock_timeout (de
-- stappen nemen kort ACCESS EXCLUSIVE, zonder tabelscan). Idempotent.
-- Volgorde: eerst de FK (die verwijst naar de unique), dan de unique, dan NOT
-- NULL. Draai daarna de driftcheck
-- supabase/checks/2026_10_06_r1b_bibliotheek_drift_readonly.sql (verwacht:
-- borging_aanwezig = false, afwijkingen 0).
-- Nooit automatisch uitgevoerd (supabase/rollbacks/README.md).
-- ============================================================================

begin;
set local lock_timeout = '3s';
alter table public.document_chunks drop constraint if exists document_chunks_document_bibliotheek_fkey;
commit;

begin;
set local lock_timeout = '3s';
alter table public.documenten drop constraint if exists documenten_id_bibliotheek_key;
commit;

begin;
set local lock_timeout = '3s';
alter table public.document_chunks alter column document_id drop not null;
alter table public.document_chunks alter column bibliotheek drop not null;
alter table public.document_chunks drop constraint if exists document_chunks_document_id_nn;
alter table public.document_chunks drop constraint if exists document_chunks_bibliotheek_nn;
commit;

do $$
begin
  if exists (select 1 from pg_constraint where conname in
              ('document_chunks_document_bibliotheek_fkey', 'documenten_id_bibliotheek_key',
               'document_chunks_document_id_nn', 'document_chunks_bibliotheek_nn'))
     or exists (select 1 from pg_attribute where attrelid = 'public.document_chunks'::regclass
                  and attname in ('document_id', 'bibliotheek') and attnotnull) then
    raise exception 'R1B-BORGING rollback: niet volledig teruggezet' using errcode = 'P0R08';
  end if;
  raise notice 'R1B-BORGING rollback: borging verwijderd; data ongewijzigd.';
end $$;
