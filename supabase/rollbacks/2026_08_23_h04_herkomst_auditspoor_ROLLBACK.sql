-- ============================================================================
-- ROLLBACK van 2026_08_23_h04_herkomst_auditspoor.sql
-- ----------------------------------------------------------------------------
-- Zet aqlab_log_download terug op één parameter en verwijdert de herkomst-kolom.
--
-- LET OP: draai dit ALLEEN samen met een terugrol van de applicatiecode. De
-- routes geven na H-04 een tweede argument mee; blijft die code staan terwijl de
-- RPC weer één parameter heeft, dan faalt elke aanroep en verdwijnt het
-- downloadspoor stil.
--
-- De kolom droppen verliest de herkomst van rijen die sinds de uitrol zijn
-- geschreven. Wil je die bewaren, laat de kolom dan staan — hij is nullable en
-- hindert niets.
-- ============================================================================

begin;

drop function if exists public.aqlab_log_download(uuid, text);

create function public.aqlab_log_download(p_export_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.aqlab_log (gebruiker_id, actie, object_type, object_id, nieuwe_waarde)
  select
    auth.uid(),
    'audit_export_gedownload_fonds',
    'aqlab_audit_exports',
    p_export_id,
    jsonb_build_object('fonds_id', (select p.fonds_id from public.profielen p where p.id = auth.uid()))
  where exists (
    select 1 from public.aqlab_release_decisions d
    where d.audit_export_id = p_export_id and d.release_status = 'vrijgegeven'
  );
$$;

revoke all on function public.aqlab_log_download(uuid) from public;
grant execute on function public.aqlab_log_download(uuid) to authenticated;

alter table public.document_inzage
  drop constraint if exists document_inzage_herkomst_check;
alter table public.document_inzage
  drop column if exists herkomst;

commit;
