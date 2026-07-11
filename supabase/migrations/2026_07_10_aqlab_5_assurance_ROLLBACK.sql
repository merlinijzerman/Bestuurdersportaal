-- ============================================================================
-- ROLLBACK 2026-07-10 (AQLab-5 / assurance-release-audit)
-- ----------------------------------------------------------------------------
-- Draait de aqlab_5-migratie terug. Idempotent (if exists / guarded).
-- LET OP:
--   • De capability-seed wordt alleen verwijderd als er GEEN actieve grants op
--     hangen (FK-veiligheid); anders blijft de referentierij staan.
--   • De bucket wordt alleen verwijderd als hij LEEG is (anders verwijder je
--     bevroren auditrapporten — eerst handmatig afhandelen/archiveren).
-- Deze migratie legt geen tabellen/kolommen aan (die leven in aqlab_3), dus er
-- valt verder niets te droppen.
-- ============================================================================

begin;

-- 2. Govern-capability terug (alleen zonder afhankelijke grants).
delete from public.platform_capabilities pc
 where pc.capability = 'platform.aqlab.govern'
   and not exists (
     select 1 from public.platform_identity_capabilities pic
      where pic.capability = pc.capability
   );

commit;

-- 1. Bucket terug — ALLEEN handmatig en alleen als leeg (destructief):
--      delete from storage.objects where bucket_id = 'aqlab-audit';  -- eerst legen
--      delete from storage.buckets where id = 'aqlab-audit';
