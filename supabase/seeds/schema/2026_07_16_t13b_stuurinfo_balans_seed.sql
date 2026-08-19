-- ============================================================================
-- Migratie 2026-07-16 — T13 SEED: balans (AZL-lijn) + reserves, Q1+Q2 2026
-- ----------------------------------------------------------------------------
-- WAAROM: vult het T13-periodemodel (2026_07_16_t13_stuurinfo_periode_reserve.sql)
-- met SYNTHETISCHE, PII-vrije aggregaatdata voor 'horizon' en 'meridiaan', voor
-- TWEE periodes (2026Q1 + 2026Q2), zodat de periodefilter en de vergelijking
-- huidig vs. voorgaand kwartaal aantoonbaar werken. Bedragen Horizon = het
-- goedgekeurde prototype (stuurinformatie-prototype.html); Meridiaan = ×0,43
-- (T11-precedent), met 'overige activa' als sluitpost zodat het balansevenwicht
-- (totaal activa = totaal passiva) per periode exact sluit.
--
-- BALANS-TAXONOMIE (AZL-lijn, vervangt de T11-balansreeksen — zie decisions/0074):
--   balans_activa : belegd, overig
--   balans_passiva: ev_toets_mvev, ev_toets_oper, ev_toets_overig (toetsvermogen),
--                   ev_soli, ev_comp (samen eigen vermogen), tv, vuk, overig
-- Subtotalen (toetsvermogen, eigen vermogen, totalen) worden in de leeslaag
-- AFGELEID en staan bewust niet in de data. De cohort-ppv-reeks verdwijnt van
-- de balans (→ tab 2, later). GEEN deelnemer-PII; populatie_n blijft NULL.
--
-- RESERVES: alleen de solidariteitsreserve heeft een formele ABTN-band
-- (ondergrens/bovengrens, in % van de technische voorziening) → stoplicht.
-- Alle overige reserves zijn bewust bandloos → "monitoring" (werkhypothese:
-- MVEV-/operationele reserve krijgen mogelijk later een band; valideren met
-- AZL/actuaris). pct_basis = 'technische_voorziening'.
--
-- Idempotent (on conflict do update). Afhankelijk van de T13-tabelmigratie én
-- 2026_07_09_t8_demo_fonds_seed.sql (fonds 'meridiaan').
-- ROLLBACK: 2026_07_16_t13b_stuurinfo_balans_seed_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 1. Periode-registry: Q1 + Q2 2026 voor beide fondsen ────────────────────
insert into public.fonds_stuurinfo_periode (fonds_id, periode, peildatum, bron, volgorde)
select f.id, p.periode, p.peildatum, 'seed_synthetisch', p.volgorde
from public.fondsen f
cross join (values
  ('2026Q1', date '2026-03-31', 1),
  ('2026Q2', date '2026-06-30', 2)
) as p(periode, peildatum, volgorde)
where f.slug in ('horizon', 'meridiaan')
on conflict (fonds_id, periode) do update set
  peildatum = excluded.peildatum, bron = excluded.bron,
  volgorde = excluded.volgorde, bijgewerkt = now();

-- ── 2. Oude T11-balanstaxonomie opruimen (vervangen door de AZL-structuur) ──
-- Migratie draait privileged; de deny-by-default RLS (geen delete-policy) blijft
-- onverkort gelden voor app-clients. Cohort-ppv verhuist naar tab 2 (later).
delete from public.fonds_stuurinfo_reeks
where reeks_key in ('balans_activa_bescherming','balans_activa_overrend',
                    'balans_activa_liquide','balans_passiva_ppv',
                    'balans_passiva_reserve','balans_passiva_overig');

-- ── 3a. Balans-reeksen Horizon (prototypebedragen, € mln) ───────────────────
-- Evenwichtscheck per periode: activa 2026Q2 = 2400+80 = 2480 = passiva
-- (10+9+2+78+41+2328+8+4); 2026Q1 = 2360+72 = 2432 = (10+8+2+68+40+2290+9+5).
insert into public.fonds_stuurinfo_reeks (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, r.periode, r.reeks_key, r.punt_key, r.label, r.volgorde, r.waarde
from public.fondsen f
cross join (values
  -- 2026Q2 — activa
  ('2026Q2','balans_activa','belegd','Belegd vermogen',1,2400),
  ('2026Q2','balans_activa','overig','Overige activa, vorderingen en liquiditeiten',2,80),
  -- 2026Q2 — passiva
  ('2026Q2','balans_passiva','ev_toets_mvev','MVEV-reserve',1,10),
  ('2026Q2','balans_passiva','ev_toets_oper','Operationele reserve',2,9),
  ('2026Q2','balans_passiva','ev_toets_overig','Overig',3,2),
  ('2026Q2','balans_passiva','ev_soli','Solidariteitsreserve',4,78),
  ('2026Q2','balans_passiva','ev_comp','Compensatiedepot',5,41),
  ('2026Q2','balans_passiva','tv','Technische voorziening',6,2328),
  ('2026Q2','balans_passiva','vuk','Voorziening uitvoeringskosten',7,8),
  ('2026Q2','balans_passiva','overig','Overige voorzieningen en passiva',8,4),
  -- 2026Q1 — activa
  ('2026Q1','balans_activa','belegd','Belegd vermogen',1,2360),
  ('2026Q1','balans_activa','overig','Overige activa, vorderingen en liquiditeiten',2,72),
  -- 2026Q1 — passiva
  ('2026Q1','balans_passiva','ev_toets_mvev','MVEV-reserve',1,10),
  ('2026Q1','balans_passiva','ev_toets_oper','Operationele reserve',2,8),
  ('2026Q1','balans_passiva','ev_toets_overig','Overig',3,2),
  ('2026Q1','balans_passiva','ev_soli','Solidariteitsreserve',4,68),
  ('2026Q1','balans_passiva','ev_comp','Compensatiedepot',5,40),
  ('2026Q1','balans_passiva','tv','Technische voorziening',6,2290),
  ('2026Q1','balans_passiva','vuk','Voorziening uitvoeringskosten',7,9),
  ('2026Q1','balans_passiva','overig','Overige voorzieningen en passiva',8,5)
) as r(periode, reeks_key, punt_key, label, volgorde, waarde)
where f.slug = 'horizon'
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

-- ── 3b. Balans-reeksen Meridiaan (×0,43, 'overig' activa als sluitpost) ─────
-- Evenwichtscheck: 2026Q2 = 1032+35 = 1067 = (4+4+1+34+18+1001+3+2);
--                  2026Q1 = 1015+30 = 1045 = (4+3+1+29+17+985+4+2).
insert into public.fonds_stuurinfo_reeks (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, r.periode, r.reeks_key, r.punt_key, r.label, r.volgorde, r.waarde
from public.fondsen f
cross join (values
  -- 2026Q2 — activa
  ('2026Q2','balans_activa','belegd','Belegd vermogen',1,1032),
  ('2026Q2','balans_activa','overig','Overige activa, vorderingen en liquiditeiten',2,35),
  -- 2026Q2 — passiva
  ('2026Q2','balans_passiva','ev_toets_mvev','MVEV-reserve',1,4),
  ('2026Q2','balans_passiva','ev_toets_oper','Operationele reserve',2,4),
  ('2026Q2','balans_passiva','ev_toets_overig','Overig',3,1),
  ('2026Q2','balans_passiva','ev_soli','Solidariteitsreserve',4,34),
  ('2026Q2','balans_passiva','ev_comp','Compensatiedepot',5,18),
  ('2026Q2','balans_passiva','tv','Technische voorziening',6,1001),
  ('2026Q2','balans_passiva','vuk','Voorziening uitvoeringskosten',7,3),
  ('2026Q2','balans_passiva','overig','Overige voorzieningen en passiva',8,2),
  -- 2026Q1 — activa
  ('2026Q1','balans_activa','belegd','Belegd vermogen',1,1015),
  ('2026Q1','balans_activa','overig','Overige activa, vorderingen en liquiditeiten',2,30),
  -- 2026Q1 — passiva
  ('2026Q1','balans_passiva','ev_toets_mvev','MVEV-reserve',1,4),
  ('2026Q1','balans_passiva','ev_toets_oper','Operationele reserve',2,3),
  ('2026Q1','balans_passiva','ev_toets_overig','Overig',3,1),
  ('2026Q1','balans_passiva','ev_soli','Solidariteitsreserve',4,29),
  ('2026Q1','balans_passiva','ev_comp','Compensatiedepot',5,17),
  ('2026Q1','balans_passiva','tv','Technische voorziening',6,985),
  ('2026Q1','balans_passiva','vuk','Voorziening uitvoeringskosten',7,4),
  ('2026Q1','balans_passiva','overig','Overige voorzieningen en passiva',8,2)
) as r(periode, reeks_key, punt_key, label, volgorde, waarde)
where f.slug = 'meridiaan'
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

-- ── 4a. Reserves Horizon (stand € mln; pct in % van de technische voorziening)
-- Alleen de solidariteitsreserve heeft de formele ABTN-band (1,5%–5,0%).
insert into public.fonds_stuurinfo_reserve
  (fonds_id, periode, reserve_key, label, stand, pct_basis, pct_waarde, ondergrens, bovengrens, volgorde)
select f.id, r.periode, r.reserve_key, r.label, r.stand,
       'technische_voorziening', r.pct_waarde, r.ondergrens, r.bovengrens, r.volgorde
from public.fondsen f
cross join (values
  ('2026Q2','solidariteitsreserve',       'Solidariteitsreserve',        78.0, 3.3, 1.5,  5.0,  1),
  ('2026Q2','mvev_reserve',               'MVEV-reserve',                10.0, 0.4, null::numeric, null::numeric, 2),
  ('2026Q2','operationele_reserve',       'Operationele reserve',         9.0, 0.4, null, null, 3),
  ('2026Q2','kostenreserve',              'Kostenreserve',               40.0, 1.7, null, null, 4),
  ('2026Q2','ao_reserve',                 'AO-reserve',                  19.0, 0.8, null, null, 5),
  ('2026Q2','ppwzp_reserve',              'PP/Wzp-reserve',               7.0, 0.3, null, null, 6),
  ('2026Q2','ppwzp_reserve_eerbiedigend', 'PP/Wzp-reserve eerbiedigend',  0.1, 0.0, null, null, 7),
  ('2026Q2','compensatiedepot',           'Compensatiedepot',            41.0, 1.8, null, null, 8),
  ('2026Q1','solidariteitsreserve',       'Solidariteitsreserve',        68.0, 3.0, 1.5,  5.0,  1),
  ('2026Q1','mvev_reserve',               'MVEV-reserve',                10.0, 0.4, null, null, 2),
  ('2026Q1','operationele_reserve',       'Operationele reserve',         8.0, 0.3, null, null, 3),
  ('2026Q1','kostenreserve',              'Kostenreserve',               39.0, 1.7, null, null, 4),
  ('2026Q1','ao_reserve',                 'AO-reserve',                  18.0, 0.8, null, null, 5),
  ('2026Q1','ppwzp_reserve',              'PP/Wzp-reserve',               7.0, 0.3, null, null, 6),
  ('2026Q1','ppwzp_reserve_eerbiedigend', 'PP/Wzp-reserve eerbiedigend',  0.1, 0.0, null, null, 7),
  ('2026Q1','compensatiedepot',           'Compensatiedepot',            40.0, 1.7, null, null, 8)
) as r(periode, reserve_key, label, stand, pct_waarde, ondergrens, bovengrens, volgorde)
where f.slug = 'horizon'
on conflict (fonds_id, periode, reserve_key) do update set
  label = excluded.label, stand = excluded.stand, pct_basis = excluded.pct_basis,
  pct_waarde = excluded.pct_waarde, ondergrens = excluded.ondergrens,
  bovengrens = excluded.bovengrens, volgorde = excluded.volgorde, bijgewerkt = now();

-- ── 4b. Reserves Meridiaan (consistent met de ×0,43-balans) ─────────────────
insert into public.fonds_stuurinfo_reserve
  (fonds_id, periode, reserve_key, label, stand, pct_basis, pct_waarde, ondergrens, bovengrens, volgorde)
select f.id, r.periode, r.reserve_key, r.label, r.stand,
       'technische_voorziening', r.pct_waarde, r.ondergrens, r.bovengrens, r.volgorde
from public.fondsen f
cross join (values
  ('2026Q2','solidariteitsreserve',       'Solidariteitsreserve',        34.0, 3.4, 1.5,  5.0,  1),
  ('2026Q2','mvev_reserve',               'MVEV-reserve',                 4.0, 0.4, null::numeric, null::numeric, 2),
  ('2026Q2','operationele_reserve',       'Operationele reserve',         4.0, 0.4, null, null, 3),
  ('2026Q2','kostenreserve',              'Kostenreserve',               17.0, 1.7, null, null, 4),
  ('2026Q2','ao_reserve',                 'AO-reserve',                   8.0, 0.8, null, null, 5),
  ('2026Q2','ppwzp_reserve',              'PP/Wzp-reserve',               3.0, 0.3, null, null, 6),
  ('2026Q2','ppwzp_reserve_eerbiedigend', 'PP/Wzp-reserve eerbiedigend',  0.0, 0.0, null, null, 7),
  ('2026Q2','compensatiedepot',           'Compensatiedepot',            18.0, 1.8, null, null, 8),
  ('2026Q1','solidariteitsreserve',       'Solidariteitsreserve',        29.0, 2.9, 1.5,  5.0,  1),
  ('2026Q1','mvev_reserve',               'MVEV-reserve',                 4.0, 0.4, null, null, 2),
  ('2026Q1','operationele_reserve',       'Operationele reserve',         3.0, 0.3, null, null, 3),
  ('2026Q1','kostenreserve',              'Kostenreserve',               17.0, 1.7, null, null, 4),
  ('2026Q1','ao_reserve',                 'AO-reserve',                   8.0, 0.8, null, null, 5),
  ('2026Q1','ppwzp_reserve',              'PP/Wzp-reserve',               3.0, 0.3, null, null, 6),
  ('2026Q1','ppwzp_reserve_eerbiedigend', 'PP/Wzp-reserve eerbiedigend',  0.0, 0.0, null, null, 7),
  ('2026Q1','compensatiedepot',           'Compensatiedepot',            17.0, 1.7, null, null, 8)
) as r(periode, reserve_key, label, stand, pct_waarde, ondergrens, bovengrens, volgorde)
where f.slug = 'meridiaan'
on conflict (fonds_id, periode, reserve_key) do update set
  label = excluded.label, stand = excluded.stand, pct_basis = excluded.pct_basis,
  pct_waarde = excluded.pct_waarde, ondergrens = excluded.ondergrens,
  bovengrens = excluded.bovengrens, volgorde = excluded.volgorde, bijgewerkt = now();

-- ── 5. Financieringsgraad per periode (KPI) ─────────────────────────────────
-- De delta van de KPI-tegel wordt in de leeslaag AFGELEID uit beide periodes;
-- delta/toelichting blijven hier leeg. De overige drie tegels (balanstotaal,
-- eigen vermogen, kapitalen) komen uit de balans-reeks — niet geseed.
insert into public.fonds_stuurinfo_kpi (fonds_id, periode, kpi_key, label, waarde, eenheid, volgorde)
select f.id, k.periode, 'financieringsgraad', 'Financieringsgraad', k.waarde, 'pct', 1
from public.fondsen f
join (values
  ('horizon',   '2026Q1', 105.5),
  ('horizon',   '2026Q2', 106.0),
  ('meridiaan', '2026Q1', 107.8),
  ('meridiaan', '2026Q2', 108.2)
) as k(slug, periode, waarde) on k.slug = f.slug
on conflict (fonds_id, periode, kpi_key) do update set
  label = excluded.label, waarde = excluded.waarde, eenheid = excluded.eenheid,
  delta = null, toelichting = null, volgorde = excluded.volgorde, bijgewerkt = now();

-- ── 6. Module-config (T8): presentatielabel regeling ────────────────────────
-- Feiten staan in de RLS-datatabellen; dit is puur presentatie. peildatum komt
-- voortaan uit de periode-registry; de oude config-velden blijven staan maar
-- worden door de balans-tab niet meer gelezen.
-- LET OP: versie = versie + 1 is verplicht (T8-schrijfconventie): de
-- audittrigger fn_fonds_config_capture logt per wijziging een rij met
-- (fonds_id, config_type, config_sleutel, versie) uniek — zonder bump botst
-- de log op fonds_config_log_versie_uniek. Idempotent in effect (het label is
-- een vaste waarde); elke run is wél een nieuwe, correct gelogde configversie.
update public.fonds_module_manifest m
set config = coalesce(m.config, '{}'::jsonb)
             || '{"regelingLabel":"Solidaire premieregeling"}'::jsonb,
    versie = m.versie + 1,
    bijgewerkt = now()
from public.fondsen f
where f.id = m.fonds_id
  and f.slug in ('horizon', 'meridiaan')
  and m.module_key = 'stuurinformatie';

commit;

-- ── Verificatie (handmatig ná de seed) ──────────────────────────────────────
-- 1. Balansevenwicht sluit per fonds/periode (verschil moet overal 0 zijn):
--      select f.slug, r.periode,
--             sum(case when r.reeks_key = 'balans_activa'  then r.waarde else 0 end)
--           - sum(case when r.reeks_key = 'balans_passiva' then r.waarde else 0 end) as verschil
--        from public.fonds_stuurinfo_reeks r
--        join public.fondsen f on f.id = r.fonds_id
--       where r.reeks_key in ('balans_activa','balans_passiva')
--       group by f.slug, r.periode order by 1, 2;
-- 2. Reserves: 8 rijen per fonds/periode; alleen solidariteitsreserve heeft een band:
--      select f.slug, periode, count(*),
--             count(*) filter (where ondergrens is not null) as met_band
--        from public.fonds_stuurinfo_reserve r join public.fondsen f on f.id = r.fonds_id
--       group by 1, 2 order by 1, 2;
-- 3. Oude balanstaxonomie weg (moet 0 zijn):
--      select count(*) from public.fonds_stuurinfo_reeks
--       where reeks_key like 'balans_activa_%' or reeks_key like 'balans_passiva_%';
