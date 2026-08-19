-- ============================================================================
-- ROLLBACK voor 2026_06_30_contact_beheer.sql.
-- ----------------------------------------------------------------------------
-- Verwijdert de capability platform.contact.manage weer uit de seed-tabel.
--
-- ⚠️ ALLEEN voor PRE-PRODUCTIE of een mislukte migratie VÓÓR livegebruik
-- (zelfde voorbehoud als 2026_06_23_platform_fundament_ROLLBACK.sql): NA
-- productie-livegang geen auditspoor/grants destructief wissen — corrigeer dan
-- via deactiveren (update platform_capabilities set actief=false) en het
-- append-only intrekken van grants (ingetrokken_op), niet via delete.
--
-- Bij gebruik vóór live: trek eerst eventuele actieve grants van deze cap in
-- (append-only) en verwijder daarna de seed-rij. De delete faalt zolang er nog
-- grant-rijen naar de capability verwijzen (FK-integriteit) — dat is bewust.
--
-- Vergeet niet de CODEKANT terug te draaien: verwijder platform.contact.manage
-- uit lib/platform-capabilities.ts (union, lijst, profiel) en uit de SEED in
-- lib/platform-capabilities.sanity.ts, en zet de count terug naar 11.
-- ============================================================================

-- 1. (Pre-live) trek actieve grants van deze capability append-only in.
update public.platform_identity_capabilities
  set ingetrokken_op = now()
  where capability = 'platform.contact.manage'
    and ingetrokken_op is null;

-- 2. Verwijder de seed-rij. Faalt als er (historische) grants naar verwijzen;
--    deactiveer dan i.p.v. verwijderen (zie kop).
delete from public.platform_capabilities
  where capability = 'platform.contact.manage';
