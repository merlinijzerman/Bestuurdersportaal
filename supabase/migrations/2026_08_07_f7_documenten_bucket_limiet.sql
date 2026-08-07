-- ============================================================================
-- F7 (direct-to-storage): groottegrens op de 'documenten'-bucket.
-- ----------------------------------------------------------------------------
-- Bij direct-to-storage uploadt de browser rechtstreeks naar Storage (langs de
-- Vercel-body-limiet van ~4,5 MB heen). De server-side 25 MB-controle
-- (MAX_BESTAND_BYTES) draait nu PAS in de complete-stap, op het gedownloade
-- object. Zet daarom óók een file_size_limit op de bucket zodat Storage een te
-- groot object al aan de rand weigert (defense-in-depth), náást de client-check
-- en de complete-controle.
--
-- Storage-config leeft in het storage-schema en wordt los van de tabel-migraties
-- beheerd. Draai dit HANDMATIG in Supabase, in de migratie-eerst-dan-deploy-slag.
-- Idempotent.
-- ============================================================================

update storage.buckets
   set file_size_limit = 26214400  -- 25 * 1024 * 1024 bytes; spiegelt MAX_BESTAND_BYTES
 where id = 'documenten';

-- ── Verificatie (informatief) ───────────────────────────────────────────────
do $$
begin
  raise notice 'F7: documenten.file_size_limit = % bytes.',
    (select file_size_limit from storage.buckets where id = 'documenten');
end $$;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- update storage.buckets set file_size_limit = null where id = 'documenten';
