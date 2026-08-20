-- ============================================================================
-- ROLLBACK 2026-07-09 — T8: DEMO-seed tweede fonds
-- ----------------------------------------------------------------------------
-- Verwijdert het fictieve demo-fonds "meridiaan" en (via on delete cascade op de
-- config-tabellen) zijn theming/manifest/flags. Draai dit vóór echte-fonds-
-- onboarding. Idempotent.
-- ============================================================================

begin;

-- Config-rijen hangen met on delete cascade aan fondsen; het volstaat het fonds
-- te verwijderen. Expliciete deletes eerst voor de duidelijkheid/robuustheid.
delete from public.fonds_feature_flags
 where fonds_id in (select id from public.fondsen where slug = 'meridiaan');
delete from public.fonds_module_manifest
 where fonds_id in (select id from public.fondsen where slug = 'meridiaan');
delete from public.fonds_theming
 where fonds_id in (select id from public.fondsen where slug = 'meridiaan');
delete from public.fondsen where slug = 'meridiaan';

commit;
