-- ============================================================================
-- ROLLBACK 2026-07-18 — T16b: seed tabs 6 + 7 (oper/premie) + depot-correctie
-- ----------------------------------------------------------------------------
-- Draai deze VÓÓR de functie-rollback van t16. Verwijdert de T16-SEED-rijen
-- (invoer_bron is null — rijen die een beheerder inmiddels via de RPC's heeft
-- ingevoerd/overschreven dragen 'handmatig'/'upload' en blijven bewust staan:
-- gebruikersinvoer ongelogd verwijderen zou het auditverhaal breken; beoordeel
-- die apart) en zet de depot-correctie van stap 0 terug naar de T13b-waarden
-- (horizon Q1: ev_comp 42,4 → 40, overig 2,6 → 5; meridiaan Q1: 18,6 → 17,
-- 0,4 → 2; reserve-rijen mee). LET OP: fonds_stuurinfo_log is append-only en
-- behoudt bewust de historie van zowel de seed als deze rollback.
-- ============================================================================

begin;

-- ── 1. T16-seed-reeksen weg (alleen seed: invoer_bron is null) ───────────────
delete from public.fonds_stuurinfo_reeks
where reeks_key in (
  'oper_mutatie', 'oper_kosten_realisatie', 'oper_kosten_begroot',
  'premie_component', 'premie_component_pct', 'comp_mutatie',
  'comp_uitputting_prognose'
)
and invoer_bron is null;

-- ── 2. T16-seed-kpi's weg (alleen seed: invoer_bron is null) ─────────────────
delete from public.fonds_stuurinfo_kpi
where kpi_key in (
  'oper_norm', 'oper_band_onder', 'oper_band_boven',
  'comp_toekenning_jaar', 'comp_startomvang', 'comp_ondergrens_pct'
)
and invoer_bron is null;

-- ── 3. Depot-correctie terugdraaien naar de T13b-seedwaarden ─────────────────
-- Horizon 2026Q1: ev_comp → 40, overig → 5 (passiva-som weer 2432).
update public.fonds_stuurinfo_reeks r
set waarde = c.waarde, bijgewerkt = now()
from public.fondsen f,
     (values ('ev_comp', 40.0), ('overig', 5.0)) as c(punt_key, waarde)
where f.slug = 'horizon' and r.fonds_id = f.id
  and r.periode = '2026Q1' and r.reeks_key = 'balans_passiva'
  and r.punt_key = c.punt_key;

update public.fonds_stuurinfo_reserve r
set stand = 40.0, pct_waarde = 1.7, bijgewerkt = now()
from public.fondsen f
where f.slug = 'horizon' and r.fonds_id = f.id
  and r.periode = '2026Q1' and r.reserve_key = 'compensatiedepot';

-- Meridiaan 2026Q1: ev_comp → 17, overig → 2 (passiva-som weer 1045).
update public.fonds_stuurinfo_reeks r
set waarde = c.waarde, bijgewerkt = now()
from public.fondsen f,
     (values ('ev_comp', 17.0), ('overig', 2.0)) as c(punt_key, waarde)
where f.slug = 'meridiaan' and r.fonds_id = f.id
  and r.periode = '2026Q1' and r.reeks_key = 'balans_passiva'
  and r.punt_key = c.punt_key;

update public.fonds_stuurinfo_reserve r
set stand = 17.0, pct_waarde = 1.7, bijgewerkt = now()
from public.fondsen f
where f.slug = 'meridiaan' and r.fonds_id = f.id
  and r.periode = '2026Q1' and r.reserve_key = 'compensatiedepot';

commit;

-- Verificatie:
--   select count(*) from public.fonds_stuurinfo_reeks
--    where (reeks_key like 'oper_%' or reeks_key like 'premie_component%'
--       or reeks_key like 'comp_%') and invoer_bron is null;  -- verwacht: 0
--   select count(*) from public.fonds_stuurinfo_kpi
--    where (kpi_key like 'oper_%' or kpi_key like 'comp_%')
--      and invoer_bron is null;                               -- verwacht: 0
--   Resterende rijen met invoer_bron = 'handmatig'/'upload' zijn
--   gebruikersinvoer — apart beoordelen vóór eventuele verwijdering.
--   Balans sluit weer op de T13b-waarden (zie verificatie in t16b).
