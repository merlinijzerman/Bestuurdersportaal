-- ============================================================================
-- Migratie 2026-07-18 — T16b: seed tabs 6 (Operationeel) + 7 (Premie & comp.)
-- ----------------------------------------------------------------------------
-- WAAROM: synthetische demo-data voor de tabs 6/7 (decisions/0077), voor twee
-- fondsen (horizon = prototypebedragen; meridiaan ≈ ×0,43 — afgerond en
-- daarna EXACT sluitend gemaakt op de meridiaan-reservestanden: consistentie
-- wint van schaal, 0076-precedent) en TWEE periodes (2026Q1 + 2026Q2).
--
-- STAP 0 — DEPOT-CORRECTIE (besluit Merlin, plansessie T16): de T13b-seed gaf
-- het compensatiedepot 2026Q1 = 40 → 2026Q2 = 41 (stijgend), terwijl het
-- depot per ontwerp UITPUTTEND is (onttrekkingen > opbrengsten; prototype:
-- 42,4 → 41,0). De Q1-stand gaat naar 42,4, gecompenseerd binnen de passiva
-- (overige voorzieningen 5 → 2,6) zodat de balans op 2432 blijft sluiten;
-- de gekoppelde reserve-rij gaat mee (stand + pct_waarde). Meridiaan analoog
-- (17 → 18,6; overig 2 → 0,4; som blijft 1045). De audittrigger logt deze
-- correctie automatisch (invoer_bron null = seed/migratie).
--
-- DAARNA de nieuwe reeksen/kpi's. Afgeleide waarden (totaal mutatie, primo,
-- ultimo, totaal premie, buffer, vulgraad, kruisjaar) worden bewust NIET
-- geseed — de leeslaag leidt ze af (stuurinfo-ontwikkeling/-operationeel/
-- -premie.ts). Rekencontroles staan per blok in commentaar.
--
-- De uitputtingsprognose is een AANGELEVERDE ALM-reeks (per rapportageperiode
-- een snapshot; punt_key = jaartal) — seed/upload-only, geen handinvoer.
--
-- Idempotent (upserts op de natuurlijke sleutels). Transactioneel. Eerst in
-- Supabase draaien, DAN code-deploy. Sorteert ná t16.
-- ROLLBACK: 2026_07_18_t16b_stuurinfo_oper_premie_seed_ROLLBACK.sql
-- (seed-rollback vóór de functie-rollback van t16).
-- ============================================================================

begin;

-- ── 0. Depot-correctie 2026Q1 (balans-leaf + gekoppelde reserve-rij) ─────────
-- Horizon: ev_comp 40 → 42,4; overig 5 → 2,6 (passiva-som blijft 2432).
update public.fonds_stuurinfo_reeks r
set waarde = c.waarde, bijgewerkt = now()
from public.fondsen f,
     (values ('ev_comp', 42.4), ('overig', 2.6)) as c(punt_key, waarde)
where f.slug = 'horizon' and r.fonds_id = f.id
  and r.periode = '2026Q1' and r.reeks_key = 'balans_passiva'
  and r.punt_key = c.punt_key
  and r.waarde is distinct from c.waarde;

-- pct_waarde = stand / TV × 100, 1 decimaal (42,4 / 2290 → 1,9).
update public.fonds_stuurinfo_reserve r
set stand = 42.4, pct_waarde = 1.9, bijgewerkt = now()
from public.fondsen f
where f.slug = 'horizon' and r.fonds_id = f.id
  and r.periode = '2026Q1' and r.reserve_key = 'compensatiedepot'
  and (r.stand is distinct from 42.4 or r.pct_waarde is distinct from 1.9);

-- Meridiaan: ev_comp 17 → 18,6; overig 2 → 0,4 (passiva-som blijft 1045).
update public.fonds_stuurinfo_reeks r
set waarde = c.waarde, bijgewerkt = now()
from public.fondsen f,
     (values ('ev_comp', 18.6), ('overig', 0.4)) as c(punt_key, waarde)
where f.slug = 'meridiaan' and r.fonds_id = f.id
  and r.periode = '2026Q1' and r.reeks_key = 'balans_passiva'
  and r.punt_key = c.punt_key
  and r.waarde is distinct from c.waarde;

-- pct_waarde: 18,6 / 985 → 1,9.
update public.fonds_stuurinfo_reserve r
set stand = 18.6, pct_waarde = 1.9, bijgewerkt = now()
from public.fondsen f
where f.slug = 'meridiaan' and r.fonds_id = f.id
  and r.periode = '2026Q1' and r.reserve_key = 'compensatiedepot'
  and (r.stand is distinct from 18.6 or r.pct_waarde is distinct from 1.9);

-- ── 1. Tab 6 — mutatiebronnen operationele reserve (reeks oper_mutatie) ──────
-- Rekencontrole (ultimo = reservestand operationele_reserve, T13b-seed):
--   horizon   Q2: som = +1,0 → 8,0 + 1,0 = 9,0 ✓ · Q1: som = +0,8 (primo
--   teruggerekend 7,2 — er is geen 2025Q4) → ultimo 8,0 ✓
--   meridiaan Q2: som = +1,0 → 3,0 + 1,0 = 4,0 ✓ · Q1: som = +0,4 → primo 2,6
insert into public.fonds_stuurinfo_reeks
  (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, r.periode, 'oper_mutatie', r.punt_key, r.label, r.volgorde,
       case when f.slug = 'horizon' then r.horizon else r.meridiaan end
from public.fondsen f
cross join (values
  --  periode    punt_key                 label                              volg  horizon  meridiaan
  ('2026Q2','premie_kostenopslag',   'Premie',                          1,  0.0,  0.0),
  ('2026Q2','beschermingsrendement', 'Beschermingsrendement',           2, -0.1, -0.1),
  ('2026Q2','overrendement',         'Overrendement',                   3,  1.3,  0.8),
  ('2026Q2','gemist_rendement_twk',  'Gemist rendement (a.g.v. TWK)',   4,  0.1,  0.1),
  ('2026Q2','twk_invaar',            'TWK-invaarmutaties',              5,  0.2,  0.1),
  ('2026Q2','verrekening_reserves',  'Verrekening reserves',            6,  0.2,  0.2),
  ('2026Q2','overig',                'Overig',                          7,  0.1,  0.2),
  ('2026Q2','kosten',                'Kosten (geaggregeerd)',           8, -0.8, -0.3),
  ('2026Q1','premie_kostenopslag',   'Premie',                          1,  0.0,  0.0),
  ('2026Q1','beschermingsrendement', 'Beschermingsrendement',           2, -0.1,  0.0),
  ('2026Q1','overrendement',         'Overrendement',                   3,  1.1,  0.4),
  ('2026Q1','gemist_rendement_twk',  'Gemist rendement (a.g.v. TWK)',   4,  0.1,  0.1),
  ('2026Q1','twk_invaar',            'TWK-invaarmutaties',              5,  0.2,  0.1),
  ('2026Q1','verrekening_reserves',  'Verrekening reserves',            6,  0.1,  0.1),
  ('2026Q1','overig',                'Overig',                          7,  0.1,  0.0),
  ('2026Q1','kosten',                'Kosten (geaggregeerd)',           8, -0.7, -0.3)
) as r(periode, punt_key, label, volgorde, horizon, meridiaan)
where f.slug in ('horizon','meridiaan')
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

-- ── 2. Tab 6 — kostendetail (reeks oper_kosten_realisatie/-begroot, YTD) ─────
-- Aangeleverd (uitvoerder); bewust géén harde koppeling met de geaggregeerde
-- kwartaal-kostenpost hierboven (YTD vs. kwartaalmutatie — decisions/0077).
-- Totalen: horizon Q2 3,1 vs. 3,3 (onder budget) · Q1 2,3 vs. 2,5;
--          meridiaan Q2 1,3 vs. 1,4 · Q1 1,0 vs. 1,1.
insert into public.fonds_stuurinfo_reeks
  (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, r.periode, r.reeks_key, r.punt_key, r.label, r.volgorde,
       case when f.slug = 'horizon' then r.horizon else r.meridiaan end
from public.fondsen f
cross join (values
  ('2026Q2','oper_kosten_realisatie','uitvoeringskosten','Uitvoeringskosten',1, 1.9, 0.8),
  ('2026Q2','oper_kosten_realisatie','vermogensbeheer',  'Vermogensbeheer',  2, 0.9, 0.4),
  ('2026Q2','oper_kosten_realisatie','bestuur_overig',   'Bestuur & overig', 3, 0.3, 0.1),
  ('2026Q2','oper_kosten_begroot',   'uitvoeringskosten','Uitvoeringskosten',1, 2.1, 0.9),
  ('2026Q2','oper_kosten_begroot',   'vermogensbeheer',  'Vermogensbeheer',  2, 1.0, 0.4),
  ('2026Q2','oper_kosten_begroot',   'bestuur_overig',   'Bestuur & overig', 3, 0.2, 0.1),
  ('2026Q1','oper_kosten_realisatie','uitvoeringskosten','Uitvoeringskosten',1, 1.4, 0.6),
  ('2026Q1','oper_kosten_realisatie','vermogensbeheer',  'Vermogensbeheer',  2, 0.6, 0.3),
  ('2026Q1','oper_kosten_realisatie','bestuur_overig',   'Bestuur & overig', 3, 0.3, 0.1),
  ('2026Q1','oper_kosten_begroot',   'uitvoeringskosten','Uitvoeringskosten',1, 1.6, 0.7),
  ('2026Q1','oper_kosten_begroot',   'vermogensbeheer',  'Vermogensbeheer',  2, 0.8, 0.3),
  ('2026Q1','oper_kosten_begroot',   'bestuur_overig',   'Bestuur & overig', 3, 0.1, 0.1)
) as r(periode, reeks_key, punt_key, label, volgorde, horizon, meridiaan)
where f.slug in ('horizon','meridiaan')
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

-- ── 3. Tab 6 — norm + band operationele reserve (kpi's, € mln) ───────────────
-- Bewust kpi's en NIET de reserve-rij-band (die is in % van de TV en stuurt
-- het tab 1-stoplicht — dat blijft "monitoring", decisions/0077).
-- Horizon: norm 8,0, band 6,0–12,0 (stand Q2 9,0 → 112,5% v. norm, in band);
-- meridiaan: norm 3,4, band 2,6–5,2 (stand Q2 4,0 → in band).
insert into public.fonds_stuurinfo_kpi
  (fonds_id, periode, kpi_key, label, waarde, eenheid, volgorde)
select f.id, p.periode, k.kpi_key, k.label,
       case when f.slug = 'horizon' then k.horizon else k.meridiaan end,
       'mln', k.volgorde
from public.fondsen f
cross join (values ('2026Q1'), ('2026Q2')) as p(periode)
cross join (values
  ('oper_norm',       'Norm operationele reserve',                30, 8.0, 3.4),
  ('oper_band_onder', 'Band operationele reserve — ondergrens',   31, 6.0, 2.6),
  ('oper_band_boven', 'Band operationele reserve — bovengrens',   32, 12.0, 5.2)
) as k(kpi_key, label, volgorde, horizon, meridiaan)
where f.slug in ('horizon','meridiaan')
on conflict (fonds_id, periode, kpi_key) do update set
  label = excluded.label, waarde = excluded.waarde, eenheid = excluded.eenheid,
  delta = null, toelichting = null, volgorde = excluded.volgorde, bijgewerkt = now();

-- ── 4. Tab 7 — premiecomponenten (€ en % grondslag; beide aangeleverd) ───────
-- Totalen (afgeleid in de leeslaag): horizon Q2 € 19,0 / Q1 € 18,6 / 31,63%;
-- meridiaan Q2 € 8,3 / Q1 € 8,1. De %-tabel is de premiestelling van het
-- kwartaal (hier beide periodes gelijk). WERKHYPOTHESE: de echte splitsing en
-- de grondslagdefinitie komen van de uitvoerder (decisions/0077).
insert into public.fonds_stuurinfo_reeks
  (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, r.periode, 'premie_component', r.punt_key, r.label, r.volgorde,
       case when f.slug = 'horizon' then r.horizon else r.meridiaan end
from public.fondsen f
cross join (values
  ('2026Q2','spaarpremie',              'Spaarpremie',               1, 15.8, 6.8),
  ('2026Q2','risico_ppwzp',             'Risicopremie PP/WZP',       2,  1.1, 0.5),
  ('2026Q2','risico_aop',               'Risicopremie AOP',          3,  0.1, 0.1),
  ('2026Q2','risico_pvi',               'Risicopremie PVI',          4,  1.0, 0.4),
  ('2026Q2','opslag_uitvoeringskosten', 'Opslag uitvoeringskosten',  5,  0.6, 0.3),
  ('2026Q2','opslag_toekomstige_kosten','Opslag toekomstige kosten', 6,  0.4, 0.2),
  ('2026Q1','spaarpremie',              'Spaarpremie',               1, 15.5, 6.7),
  ('2026Q1','risico_ppwzp',             'Risicopremie PP/WZP',       2,  1.1, 0.5),
  ('2026Q1','risico_aop',               'Risicopremie AOP',          3,  0.1, 0.1),
  ('2026Q1','risico_pvi',               'Risicopremie PVI',          4,  1.0, 0.4),
  ('2026Q1','opslag_uitvoeringskosten', 'Opslag uitvoeringskosten',  5,  0.5, 0.2),
  ('2026Q1','opslag_toekomstige_kosten','Opslag toekomstige kosten', 6,  0.4, 0.2)
) as r(periode, punt_key, label, volgorde, horizon, meridiaan)
where f.slug in ('horizon','meridiaan')
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

-- % van de premiegrondslag — voor beide fondsen dezelfde premiestelling
-- (percentages zijn tarieven, geen bedragen; som 31,63%).
insert into public.fonds_stuurinfo_reeks
  (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, p.periode, 'premie_component_pct', r.punt_key, r.label, r.volgorde, r.pct
from public.fondsen f
cross join (values ('2026Q1'), ('2026Q2')) as p(periode)
cross join (values
  ('spaarpremie',              'Spaarpremie',               1, 26.31),
  ('risico_ppwzp',             'Risicopremie PP/WZP',       2,  1.84),
  ('risico_aop',               'Risicopremie AOP',          3,  0.12),
  ('risico_pvi',               'Risicopremie PVI',          4,  1.68),
  ('opslag_uitvoeringskosten', 'Opslag uitvoeringskosten',  5,  0.97),
  ('opslag_toekomstige_kosten','Opslag toekomstige kosten', 6,  0.71)
) as r(punt_key, label, volgorde, pct)
where f.slug in ('horizon','meridiaan')
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

-- ── 5. Tab 7 — mutatiebronnen compensatiedepot (reeks comp_mutatie) ──────────
-- Rekencontrole (ultimo = reservestand compensatiedepot, incl. stap 0):
--   horizon   Q2: som = −1,4 → 42,4 − 1,4 = 41,0 ✓ · Q1: som = −1,4 → primo
--   teruggerekend 43,8 → ultimo 42,4 ✓
--   meridiaan Q2: som = −0,6 → 18,6 − 0,6 = 18,0 ✓ · Q1: som = −0,6 → primo 19,2
insert into public.fonds_stuurinfo_reeks
  (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, p.periode, 'comp_mutatie', r.punt_key, r.label, r.volgorde,
       case when f.slug = 'horizon' then r.horizon else r.meridiaan end
from public.fondsen f
cross join (values ('2026Q1'), ('2026Q2')) as p(periode)
cross join (values
  ('premie',                'Premie',                                 1,  0.0,  0.0),
  ('beschermingsrendement', 'Beschermingsrendement',                  2, -0.1, -0.1),
  ('overrendement',         'Overrendement',                          3,  0.2,  0.1),
  ('onttrekkingen',         'Onttrekkingen (compensatietoekenning)',  4, -1.6, -0.7),
  ('verrekening_reserves',  'Verrekening reserves',                   5,  0.0,  0.0),
  ('overig',                'Overig',                                 6,  0.1,  0.1)
) as r(punt_key, label, volgorde, horizon, meridiaan)
where f.slug in ('horizon','meridiaan')
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

-- ── 6. Tab 7 — kpi's (toekenning/jaar, startomvang, prognose-ondergrens) ─────
-- Vulgraad (afgeleid): horizon 41/60 = 68,3% · meridiaan 18/26 = 69,2%.
insert into public.fonds_stuurinfo_kpi
  (fonds_id, periode, kpi_key, label, waarde, eenheid, volgorde)
select f.id, p.periode, k.kpi_key, k.label,
       case when f.slug = 'horizon' then k.horizon else k.meridiaan end,
       k.eenheid, k.volgorde
from public.fondsen f
cross join (values ('2026Q1'), ('2026Q2')) as p(periode)
cross join (values
  ('comp_toekenning_jaar','Compensatietoekenning per jaar',                  'mln', 40,  6.5,  2.8),
  ('comp_startomvang',    'Startomvang compensatiedepot',                    'mln', 41, 60.0, 26.0),
  ('comp_ondergrens_pct', 'Ondergrens compensatiedepot (% van startomvang)', 'pct', 42, 40.0, 40.0)
) as k(kpi_key, label, eenheid, volgorde, horizon, meridiaan)
where f.slug in ('horizon','meridiaan')
on conflict (fonds_id, periode, kpi_key) do update set
  label = excluded.label, waarde = excluded.waarde, eenheid = excluded.eenheid,
  delta = null, toelichting = null, volgorde = excluded.volgorde, bijgewerkt = now();

-- ── 7. Tab 7 — uitputtingsprognose (ALM-reeks, snapshot per periode) ─────────
-- punt_key = jaartal; volgorde = jaartal (deterministisch sorteren). Het
-- eerste prognosejaar start op de stand van de betreffende periode.
-- Ondergrens-kruisjaar (afgeleid): horizon 2029 (21,5 < 24,0);
-- meridiaan 2029 (10,2 < 10,4).
insert into public.fonds_stuurinfo_reeks
  (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, r.periode, 'comp_uitputting_prognose', r.jaar, r.jaar, r.jaar::int,
       case when f.slug = 'horizon' then r.horizon else r.meridiaan end
from public.fondsen f
cross join (values
  ('2026Q2','2026', 41.0, 18.0),
  ('2026Q2','2027', 34.5, 15.4),
  ('2026Q2','2028', 28.0, 12.8),
  ('2026Q2','2029', 21.5, 10.2),
  ('2026Q2','2030', 15.0,  7.6),
  ('2026Q2','2031',  8.5,  5.0),
  ('2026Q2','2032',  2.0,  2.4),
  ('2026Q1','2026', 42.4, 18.6),
  ('2026Q1','2027', 36.0, 16.0),
  ('2026Q1','2028', 29.5, 13.4),
  ('2026Q1','2029', 23.0, 10.8),
  ('2026Q1','2030', 16.5,  8.2),
  ('2026Q1','2031', 10.0,  5.6),
  ('2026Q1','2032',  3.5,  3.0)
) as r(periode, jaar, horizon, meridiaan)
where f.slug in ('horizon','meridiaan')
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

commit;

-- ── Verificatie (handmatig ná de seed) ──────────────────────────────────────
-- 1. Balans sluit nog per fonds/periode (verschil overal 0, ook ná stap 0):
--      select f.slug, r.periode,
--             sum(case when r.reeks_key = 'balans_activa'  then r.waarde else 0 end)
--           - sum(case when r.reeks_key = 'balans_passiva' then r.waarde else 0 end) as verschil
--        from public.fonds_stuurinfo_reeks r
--        join public.fondsen f on f.id = r.fonds_id
--       where r.reeks_key in ('balans_activa','balans_passiva')
--       group by f.slug, r.periode order by 1, 2;
-- 2. Mutaties sluiten op de reservestanden (moet overal ~0 zijn):
--      select f.slug, m.periode, m.reeks_key,
--             prev.stand + sum(m.waarde) - cur.stand as verschil
--        from public.fonds_stuurinfo_reeks m
--        join public.fondsen f on f.id = m.fonds_id
--        join public.fonds_stuurinfo_reserve cur
--          on cur.fonds_id = m.fonds_id and cur.periode = m.periode
--         and cur.reserve_key = case m.reeks_key when 'oper_mutatie'
--             then 'operationele_reserve' else 'compensatiedepot' end
--        join public.fonds_stuurinfo_reserve prev
--          on prev.fonds_id = m.fonds_id and prev.periode = '2026Q1'
--         and prev.reserve_key = cur.reserve_key
--       where m.reeks_key in ('oper_mutatie','comp_mutatie') and m.periode = '2026Q2'
--       group by 1, 2, 3, prev.stand, cur.stand order by 1, 3;
-- 3. Prognose: 7 jaren per fonds/periode; eerste jaar = depot-stand:
--      select f.slug, periode, count(*) from public.fonds_stuurinfo_reeks r
--        join public.fondsen f on f.id = r.fonds_id
--       where reeks_key = 'comp_uitputting_prognose' group by 1, 2;
