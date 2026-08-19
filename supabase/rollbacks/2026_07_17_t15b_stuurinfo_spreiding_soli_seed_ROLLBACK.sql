-- ============================================================================
-- ROLLBACK 2026-07-17 — T15 SEED: spreiding (tab 4) + solidariteit (tab 5)
-- ----------------------------------------------------------------------------
-- Draait 2026_07_17_t15b_stuurinfo_spreiding_soli_seed.sql terug voor de slugs
-- horizon/meridiaan: verwijdert de tab 4/5-kpi-rijen en -reeksen. De periodes,
-- balans, reserves (incl. soli-bandgrenzen) en het T14-auditlog blijven
-- ongemoeid — die zijn van T13b/T14. Draai deze rollback VÓÓR de
-- t15-structuur-rollback (repo-conventie; technisch onafhankelijk).
-- Migratie draait privileged; de deny-by-default RLS (geen delete-policy)
-- blijft onverkort gelden voor app-clients.
-- ============================================================================

begin;

delete from public.fonds_stuurinfo_kpi k
using public.fondsen f
where f.id = k.fonds_id and f.slug in ('horizon','meridiaan')
  and k.kpi_key in ('uitkeringsfase_beschikbaar','uitkeringsfase_voorziening',
                    'uitkeringsfase_aanpassingsfactor','uitkeringsfase_band_onder',
                    'uitkeringsfase_band_boven','soli_uitdeling');

delete from public.fonds_stuurinfo_reeks r
using public.fondsen f
where f.id = r.fonds_id and f.slug in ('horizon','meridiaan')
  and r.reeks_key in ('uitkeringsfase_fg_maand','soli_vulling');

commit;

-- ── Verificatie (handmatig ná de rollback) ─────────────────────────────────
-- NB: gescoped op horizon/meridiaan — andere fondsen kunnen deze keys later
-- via de beheer-invoer hebben; die raakt deze rollback bewust niet.
-- select count(*) from public.fonds_stuurinfo_kpi k
--   join public.fondsen f on f.id = k.fonds_id
--  where f.slug in ('horizon','meridiaan')
--    and (k.kpi_key like 'uitkeringsfase_%' or k.kpi_key = 'soli_uitdeling'); -- 0
-- select count(*) from public.fonds_stuurinfo_reeks r
--   join public.fondsen f on f.id = r.fonds_id
--  where f.slug in ('horizon','meridiaan')
--    and r.reeks_key in ('uitkeringsfase_fg_maand','soli_vulling');           -- 0
