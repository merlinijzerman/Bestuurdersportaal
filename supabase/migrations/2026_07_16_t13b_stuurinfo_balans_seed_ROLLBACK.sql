-- ============================================================================
-- ROLLBACK 2026-07-16 — T13 SEED: balans (AZL-lijn) + reserves, Q1+Q2 2026
-- ----------------------------------------------------------------------------
-- Draait 2026_07_16_t13b_stuurinfo_balans_seed.sql terug voor de slugs
-- horizon/meridiaan:
--   - verwijdert periode 2026Q2 uit de registry (FK on delete cascade ruimt de
--     bijbehorende kpi-/reeks-/reserve-rijen mee op);
--   - verwijdert de AZL-balansreeksen en reserves van 2026Q1;
--   - herstelt de financieringsgraad-KPI van 2026Q1 naar de T11-waarden;
--   - haalt regelingLabel uit de module-config.
-- De OUDE T11-balansreeksen (balans_activa_bescherming, balans_passiva_ppv, …)
-- worden NIET automatisch teruggezet: draai daarvoor desgewenst
-- 2026_07_10_t11_seed_synthetisch.sql opnieuw — LET OP: dat kan pas NÁ de
-- t13-tabelrollback (zolang de periode-kolom + verbrede PK bestaan, faalt die
-- seed op de verplichte periode zonder default én op de oude on-conflict-sleutel).
-- Draai deze rollback VÓÓR 2026_07_16_t13_stuurinfo_periode_reserve_ROLLBACK.sql.
-- ============================================================================

begin;

-- 1. Periode 2026Q2 weg (cascade: kpi/reeks/reserve-rijen van die periode mee).
delete from public.fonds_stuurinfo_periode p
using public.fondsen f
where f.id = p.fonds_id and f.slug in ('horizon','meridiaan')
  and p.periode = '2026Q2';

-- 2. AZL-balansreeksen en reserves van 2026Q1 weg.
delete from public.fonds_stuurinfo_reeks r
using public.fondsen f
where f.id = r.fonds_id and f.slug in ('horizon','meridiaan')
  and r.periode = '2026Q1'
  and r.reeks_key in ('balans_activa','balans_passiva');

delete from public.fonds_stuurinfo_reserve r
using public.fondsen f
where f.id = r.fonds_id and f.slug in ('horizon','meridiaan')
  and r.periode = '2026Q1';

-- 3. Financieringsgraad-KPI 2026Q1 terug naar de T11-waarden.
update public.fonds_stuurinfo_kpi k
set waarde = 102.4, delta = 0.3, toelichting = '+0,3 pp t.o.v. Q4', bijgewerkt = now()
from public.fondsen f
where f.id = k.fonds_id and f.slug = 'horizon'
  and k.periode = '2026Q1' and k.kpi_key = 'financieringsgraad';

update public.fonds_stuurinfo_kpi k
set waarde = 108.2, delta = 0.6, toelichting = '+0,6 pp t.o.v. Q4', bijgewerkt = now()
from public.fondsen f
where f.id = k.fonds_id and f.slug = 'meridiaan'
  and k.periode = '2026Q1' and k.kpi_key = 'financieringsgraad';

-- 4. regelingLabel uit de module-config. versie + 1 verplicht: de T8b-audit-
--    trigger logt per wijziging een unieke (…, versie)-rij (zie seed stap 6).
update public.fonds_module_manifest m
set config = m.config - 'regelingLabel', versie = m.versie + 1, bijgewerkt = now()
from public.fondsen f
where f.id = m.fonds_id and f.slug in ('horizon','meridiaan')
  and m.module_key = 'stuurinformatie';

commit;

-- ── Verificatie (handmatig ná de rollback) ─────────────────────────────────
-- 1. Geen 2026Q2-periodes of -rijen meer:
--      select count(*) from public.fonds_stuurinfo_periode where periode = '2026Q2';
-- 2. Geen AZL-balansreeksen of reserves meer:
--      select count(*) from public.fonds_stuurinfo_reeks
--       where reeks_key in ('balans_activa','balans_passiva');
--      select count(*) from public.fonds_stuurinfo_reserve;
