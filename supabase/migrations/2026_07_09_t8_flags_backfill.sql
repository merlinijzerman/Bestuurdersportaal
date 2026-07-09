-- ============================================================================
-- Migratie 2026-07-09 — T8: backfill hybride_zoeken → fonds_feature_flags
-- ----------------------------------------------------------------------------
-- WAAROM: hybride_zoeken is de eerste feature flag die naar de generieke
-- fonds_feature_flags-laag verhuist. Deze migratie kopieert de bestaande waarde
-- uit fonds_instellingen 1-op-1 naar de flag `hybride_zoeken` (waarde jsonb
-- boolean), zodat er GEEN gedragsregressie is:
--   • fondsen met een expliciete instelling behouden exact die waarde;
--   • fondsen zonder instelling krijgen géén flag → de app valt terug op de
--     env-default HYBRID_SEARCH (identiek aan het huidige gedrag).
--
-- fonds_instellingen blijft bewust STAAN (beslispunt ④): backfillen + repointen,
-- de oude tabel één increment als fail-safe laten bestaan. De code leest na deze
-- migratie via fonds_feature_flags (lib/fonds-config.ts); een latere migratie kan
-- fonds_instellingen droppen zodra bevestigd is dat niets er meer op leunt.
--
-- Idempotent: on conflict do nothing (re-run overschrijft geen nieuwere waarde
-- die via het beheerscherm is gezet). Afhankelijk van 2026_07_09_t8_config_manifestlaag.sql.
-- ROLLBACK: 2026_07_09_t8_flags_backfill_ROLLBACK.sql
-- TENANT-IMPACT: geen gedragswijziging; puur datamigratie binnen bestaande RLS.
-- ============================================================================

begin;

insert into public.fonds_feature_flags (fonds_id, flag_key, waarde, versie)
select fi.fonds_id, 'hybride_zoeken', to_jsonb(fi.hybride_zoeken), 1
  from public.fonds_instellingen fi
 on conflict (fonds_id, flag_key) do nothing;

commit;

-- ── Verificatie (handmatig ná de migratie) ─────────────────────────────────
-- Elke fonds_instellingen-rij heeft een corresponderende flag met gelijke waarde:
--   select fi.fonds_id, fi.hybride_zoeken, ff.waarde
--     from public.fonds_instellingen fi
--     left join public.fonds_feature_flags ff
--       on ff.fonds_id = fi.fonds_id and ff.flag_key = 'hybride_zoeken'
--    where to_jsonb(fi.hybride_zoeken) is distinct from ff.waarde;  -- → 0 rijen
