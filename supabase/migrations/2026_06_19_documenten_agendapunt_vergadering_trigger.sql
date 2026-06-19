-- ============================================================================
-- Migratie 2026-06-19 — Increment C fast-follow: agendapunt↔vergadering-
-- consistentie afdwingen (FO §6 / TO §2.4 regel 3b).
-- ----------------------------------------------------------------------------
-- De C-migratie dekte met een CHECK alleen "agendapunt_id ⇒ vergadering_id
-- aanwezig". Het tweede deel van de contextregel — "het agendapunt moet bij
-- DÍE vergadering horen" — vergt een DB-lookup en kan niet als simpele CHECK.
-- lib/document-metadata.ts claimde dit al als "DB-side afgedwongen (trigger)";
-- deze migratie maakt die claim waar (ontwerp-sync-bevinding D1).
--
-- Idempotent. EERST in Supabase draaien, DAN code-deploy.
-- ROLLBACK: 2026_06_19_documenten_agendapunt_vergadering_trigger_ROLLBACK.sql.
-- ============================================================================

create or replace function public.fn_document_agendapunt_vergadering_check()
returns trigger language plpgsql as $$
declare
  v_verg uuid;
begin
  if new.agendapunt_id is not null then
    select vergadering_id into v_verg
      from public.agendapunten where id = new.agendapunt_id;
    if v_verg is null then
      raise exception 'Agendapunt % bestaat niet', new.agendapunt_id;
    end if;
    if new.vergadering_id is distinct from v_verg then
      raise exception
        'Agendapunt % hoort niet bij de opgegeven vergadering % (maar bij %).',
        new.agendapunt_id, new.vergadering_id, v_verg;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_document_agendapunt_vergadering on public.documenten;
create trigger trg_document_agendapunt_vergadering
  before insert or update of agendapunt_id, vergadering_id on public.documenten
  for each row execute procedure public.fn_document_agendapunt_vergadering_check();

-- ============================================================================
--  Verificatie (handmatig na Run):
--  -- Bestaande rijen zijn consistent (C-backfill zette vergadering_id uit het
--  -- agendapunt). Verwacht: 0 inconsistente rijen.
--  select count(*) from public.documenten d
--    join public.agendapunten a on a.id = d.agendapunt_id
--   where d.vergadering_id is distinct from a.vergadering_id;
-- ============================================================================
