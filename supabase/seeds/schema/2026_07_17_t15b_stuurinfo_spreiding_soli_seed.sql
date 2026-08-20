-- ============================================================================
-- Migratie 2026-07-17 — T15 SEED: spreiding (tab 4) + solidariteit (tab 5)
-- ----------------------------------------------------------------------------
-- WAAROM: vult de tab 4/5-data (werkopdracht Spreiding+Solidariteit; zie
-- decisions/0076) met SYNTHETISCHE, PII-vrije aggregaatdata voor 'horizon' en
-- 'meridiaan', voor de twee bestaande periodes (2026Q1 + 2026Q2). Geen nieuwe
-- tabellen: alles past in fonds_stuurinfo_kpi en fonds_stuurinfo_reeks.
--
-- TAB 4 — collectieve uitkeringsfase (kpi-rijen per periode):
--   uitkeringsfase_beschikbaar, uitkeringsfase_voorziening (mln),
--   uitkeringsfase_aanpassingsfactor (pct, ± — INVOER van de actuaris, wordt
--   bewust NIET in het portaal berekend), uitkeringsfase_band_onder/_boven
--   (pct). Spreidingsvermogen (beschikbaar − voorziening) en financierings-
--   graad (beschikbaar ÷ voorziening) worden in de leeslaag AFGELEID en staan
--   bewust niet in de data (geen tweede waarheid).
--   FG-maandreeks: reeks_key 'uitkeringsfase_fg_maand', 12 punten per periode
--   (punt_key '00'..'11', maandlabel in label — t11 trend_fg-conventie),
--   laatste maand = de afgeleide kwartaal-FG; overlappende maanden tussen Q1-
--   en Q2-reeks zijn identiek. SEED-ONLY: handinvoer van de maandreeks is
--   bewust buiten scope (Excel-uploadticket, later).
--
-- TAB 5 — solidariteitsreserve (per periode):
--   reeks_key 'soli_vulling' met punt_keys premie|rendement|micro_langleven|
--   overrendementsbijdrage (±, mln) + kpi soli_uitdeling (mln). Netto vulling,
--   beginstand (= soli-stand vorige periode) en eindstand worden in de
--   leeslaag AFGELEID. micro_langleven = het biometrische resultaat (tab 3,
--   later ticket) — één bron, geen tweede invoer (decisions/0076).
--   De bandbreedte staat NIET hier: die leeft op de soli-rij in
--   fonds_stuurinfo_reserve (T13b-seed, 1,5–5,0) — dezelfde bron als tab 1.
--
-- SEEDWAARDEN — de data wint van het prototype (decisions/0076): de T13b-seed
-- heeft soli-standen Horizon 68,0 (Q1) → 78,0 (Q2) en Meridiaan 29,0 → 34,0
-- (live op tab 1); het prototype (74,8 → 78,0) is intern inconsistent. De
-- vulling is zó gekozen dat beginstand + netto − uitdeling EXACT de bestaande
-- standen raakt (harde RPC-check SOLI_EINDSTAND_ONGELIJK):
--   horizon   2026Q2: 1,1 + 4,6 − 0,6 + 4,9 = 10,0 → 68,0 + 10,0 − 0 = 78,0 ✓
--   horizon   2026Q1: 0,4 + 0,7 + 0,3 + 0,4 =  1,8 → beginstand 66,2 (afgeleid)
--   meridiaan 2026Q2: 0,5 + 2,0 − 0,3 + 2,8 =  5,0 → 29,0 +  5,0 − 0 = 34,0 ✓
--   meridiaan 2026Q1: 0,2 + 0,3 + 0,1 + 0,2 =  0,8 → beginstand 28,2 (afgeleid)
-- Micro-langleven is in Q2 negatief (±-eis uit de werkopdracht).
--
-- AUDIT: de T14-capture-triggers bestaan al — deze seed produceert logregels
-- met gebruiker_id/invoer_bron null (= systeem/seed; de beheer-UI toont dat
-- zo). Idempotent herdraaien logt niets extra (no-op-guard).
--
-- GEEN deelnemer-PII; populatie_n blijft NULL. Afhankelijk van de T13b-seed
-- (periodes + soli-standen). Idempotent (on conflict do update).
-- ROLLBACK: 2026_07_17_t15b_stuurinfo_spreiding_soli_seed_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 1. Tab 4 — kerncijfers uitkeringsfase (kpi-rijen) ────────────────────────
-- Afgeleide controle (leeslaag rekent dit na): Horizon Q2 FG = 880/864 = 101,9;
-- Q1 = 809/788 = 102,7. Meridiaan Q2 = 378/372 = 101,6; Q1 = 348/339 = 102,7.
insert into public.fonds_stuurinfo_kpi (fonds_id, periode, kpi_key, label, waarde, eenheid, volgorde)
select f.id, k.periode, k.kpi_key, k.label, k.waarde, k.eenheid, k.volgorde
from public.fondsen f
join (values
  ('horizon','2026Q2','uitkeringsfase_beschikbaar','Totaal beschikbaar vermogen (uitkeringsfase)',880,'mln',10),
  ('horizon','2026Q2','uitkeringsfase_voorziening','Uitkeringsvermogen (voorziening)',864,'mln',11),
  ('horizon','2026Q2','uitkeringsfase_aanpassingsfactor','Aanpassingsfactor (na spreiden)',0.62,'pct',12),
  ('horizon','2026Q2','uitkeringsfase_band_onder','Bandbreedte uitkeringsfase — ondergrens',85,'pct',13),
  ('horizon','2026Q2','uitkeringsfase_band_boven','Bandbreedte uitkeringsfase — bovengrens',115,'pct',14),
  ('horizon','2026Q1','uitkeringsfase_beschikbaar','Totaal beschikbaar vermogen (uitkeringsfase)',809,'mln',10),
  ('horizon','2026Q1','uitkeringsfase_voorziening','Uitkeringsvermogen (voorziening)',788,'mln',11),
  ('horizon','2026Q1','uitkeringsfase_aanpassingsfactor','Aanpassingsfactor (na spreiden)',0.90,'pct',12),
  ('horizon','2026Q1','uitkeringsfase_band_onder','Bandbreedte uitkeringsfase — ondergrens',85,'pct',13),
  ('horizon','2026Q1','uitkeringsfase_band_boven','Bandbreedte uitkeringsfase — bovengrens',115,'pct',14),
  ('meridiaan','2026Q2','uitkeringsfase_beschikbaar','Totaal beschikbaar vermogen (uitkeringsfase)',378,'mln',10),
  ('meridiaan','2026Q2','uitkeringsfase_voorziening','Uitkeringsvermogen (voorziening)',372,'mln',11),
  ('meridiaan','2026Q2','uitkeringsfase_aanpassingsfactor','Aanpassingsfactor (na spreiden)',0.55,'pct',12),
  ('meridiaan','2026Q2','uitkeringsfase_band_onder','Bandbreedte uitkeringsfase — ondergrens',85,'pct',13),
  ('meridiaan','2026Q2','uitkeringsfase_band_boven','Bandbreedte uitkeringsfase — bovengrens',115,'pct',14),
  ('meridiaan','2026Q1','uitkeringsfase_beschikbaar','Totaal beschikbaar vermogen (uitkeringsfase)',348,'mln',10),
  ('meridiaan','2026Q1','uitkeringsfase_voorziening','Uitkeringsvermogen (voorziening)',339,'mln',11),
  ('meridiaan','2026Q1','uitkeringsfase_aanpassingsfactor','Aanpassingsfactor (na spreiden)',0.80,'pct',12),
  ('meridiaan','2026Q1','uitkeringsfase_band_onder','Bandbreedte uitkeringsfase — ondergrens',85,'pct',13),
  ('meridiaan','2026Q1','uitkeringsfase_band_boven','Bandbreedte uitkeringsfase — bovengrens',115,'pct',14)
) as k(slug, periode, kpi_key, label, waarde, eenheid, volgorde) on k.slug = f.slug
on conflict (fonds_id, periode, kpi_key) do update set
  label = excluded.label, waarde = excluded.waarde, eenheid = excluded.eenheid,
  delta = null, toelichting = null, volgorde = excluded.volgorde, bijgewerkt = now();

-- ── 2. Tab 4 — FG-maandreeks uitkeringsfase (12 maanden per periode) ─────────
-- punt_key = '00'..'11' (t11 trend_fg-conventie), maandlabel in label.
-- Q2-reeks eindigt op jun-26 = 101,9 (= Q2-FG); Q1-reeks op mrt-26 = 102,7
-- (= Q1-FG); overlappende maanden (jul-25 t/m mrt-26) zijn tussen beide
-- reeksen identiek (zelfde werkelijkheid, ander venster).
insert into public.fonds_stuurinfo_reeks (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, r.periode, 'uitkeringsfase_fg_maand', r.punt_key, r.label, r.volgorde, r.waarde
from public.fondsen f
join (values
  -- horizon 2026Q2 (jul-25 … jun-26)
  ('horizon','2026Q2','00','jul-25',0,100.2),
  ('horizon','2026Q2','01','aug-25',1,100.6),
  ('horizon','2026Q2','02','sep-25',2,100.9),
  ('horizon','2026Q2','03','okt-25',3,101.3),
  ('horizon','2026Q2','04','nov-25',4,101.6),
  ('horizon','2026Q2','05','dec-25',5,102.0),
  ('horizon','2026Q2','06','jan-26',6,102.2),
  ('horizon','2026Q2','07','feb-26',7,102.5),
  ('horizon','2026Q2','08','mrt-26',8,102.7),
  ('horizon','2026Q2','09','apr-26',9,102.4),
  ('horizon','2026Q2','10','mei-26',10,102.1),
  ('horizon','2026Q2','11','jun-26',11,101.9),
  -- horizon 2026Q1 (apr-25 … mrt-26)
  ('horizon','2026Q1','00','apr-25',0,99.6),
  ('horizon','2026Q1','01','mei-25',1,99.9),
  ('horizon','2026Q1','02','jun-25',2,100.1),
  ('horizon','2026Q1','03','jul-25',3,100.2),
  ('horizon','2026Q1','04','aug-25',4,100.6),
  ('horizon','2026Q1','05','sep-25',5,100.9),
  ('horizon','2026Q1','06','okt-25',6,101.3),
  ('horizon','2026Q1','07','nov-25',7,101.6),
  ('horizon','2026Q1','08','dec-25',8,102.0),
  ('horizon','2026Q1','09','jan-26',9,102.2),
  ('horizon','2026Q1','10','feb-26',10,102.5),
  ('horizon','2026Q1','11','mrt-26',11,102.7),
  -- meridiaan 2026Q2 (jul-25 … jun-26)
  ('meridiaan','2026Q2','00','jul-25',0,100.4),
  ('meridiaan','2026Q2','01','aug-25',1,100.7),
  ('meridiaan','2026Q2','02','sep-25',2,101.0),
  ('meridiaan','2026Q2','03','okt-25',3,101.3),
  ('meridiaan','2026Q2','04','nov-25',4,101.7),
  ('meridiaan','2026Q2','05','dec-25',5,102.0),
  ('meridiaan','2026Q2','06','jan-26',6,102.3),
  ('meridiaan','2026Q2','07','feb-26',7,102.5),
  ('meridiaan','2026Q2','08','mrt-26',8,102.7),
  ('meridiaan','2026Q2','09','apr-26',9,102.3),
  ('meridiaan','2026Q2','10','mei-26',10,101.9),
  ('meridiaan','2026Q2','11','jun-26',11,101.6),
  -- meridiaan 2026Q1 (apr-25 … mrt-26)
  ('meridiaan','2026Q1','00','apr-25',0,99.8),
  ('meridiaan','2026Q1','01','mei-25',1,100.0),
  ('meridiaan','2026Q1','02','jun-25',2,100.2),
  ('meridiaan','2026Q1','03','jul-25',3,100.4),
  ('meridiaan','2026Q1','04','aug-25',4,100.7),
  ('meridiaan','2026Q1','05','sep-25',5,101.0),
  ('meridiaan','2026Q1','06','okt-25',6,101.3),
  ('meridiaan','2026Q1','07','nov-25',7,101.7),
  ('meridiaan','2026Q1','08','dec-25',8,102.0),
  ('meridiaan','2026Q1','09','jan-26',9,102.3),
  ('meridiaan','2026Q1','10','feb-26',10,102.5),
  ('meridiaan','2026Q1','11','mrt-26',11,102.7)
) as r(slug, periode, punt_key, label, volgorde, waarde) on r.slug = f.slug
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

-- ── 3. Tab 5 — vulling solidariteitsreserve naar bron (±, € mln) ─────────────
-- micro_langleven = het biometrische resultaat (tab 3, later) — één bron.
insert into public.fonds_stuurinfo_reeks (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, r.periode, 'soli_vulling', r.punt_key, r.label, r.volgorde, r.waarde
from public.fondsen f
join (values
  ('horizon','2026Q2','premie','Premie',1,1.1),
  ('horizon','2026Q2','rendement','Rendement',2,4.6),
  ('horizon','2026Q2','micro_langleven','Resultaat micro-langleven',3,-0.6),
  ('horizon','2026Q2','overrendementsbijdrage','Overrendementsbijdrage',4,4.9),
  ('horizon','2026Q1','premie','Premie',1,0.4),
  ('horizon','2026Q1','rendement','Rendement',2,0.7),
  ('horizon','2026Q1','micro_langleven','Resultaat micro-langleven',3,0.3),
  ('horizon','2026Q1','overrendementsbijdrage','Overrendementsbijdrage',4,0.4),
  ('meridiaan','2026Q2','premie','Premie',1,0.5),
  ('meridiaan','2026Q2','rendement','Rendement',2,2.0),
  ('meridiaan','2026Q2','micro_langleven','Resultaat micro-langleven',3,-0.3),
  ('meridiaan','2026Q2','overrendementsbijdrage','Overrendementsbijdrage',4,2.8),
  ('meridiaan','2026Q1','premie','Premie',1,0.2),
  ('meridiaan','2026Q1','rendement','Rendement',2,0.3),
  ('meridiaan','2026Q1','micro_langleven','Resultaat micro-langleven',3,0.1),
  ('meridiaan','2026Q1','overrendementsbijdrage','Overrendementsbijdrage',4,0.2)
) as r(slug, periode, punt_key, label, volgorde, waarde) on r.slug = f.slug
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

-- ── 4. Tab 5 — uitdeling (KPI; 0 = geen aanwending dit kwartaal) ─────────────
insert into public.fonds_stuurinfo_kpi (fonds_id, periode, kpi_key, label, waarde, eenheid, volgorde)
select f.id, k.periode, 'soli_uitdeling', 'Uitdeling solidariteitsreserve', k.waarde, 'mln', 20
from public.fondsen f
join (values
  ('horizon','2026Q2',0),
  ('horizon','2026Q1',0),
  ('meridiaan','2026Q2',0),
  ('meridiaan','2026Q1',0)
) as k(slug, periode, waarde) on k.slug = f.slug
on conflict (fonds_id, periode, kpi_key) do update set
  label = excluded.label, waarde = excluded.waarde, eenheid = excluded.eenheid,
  delta = null, toelichting = null, volgorde = excluded.volgorde, bijgewerkt = now();

commit;

-- ── Verificatie (handmatig ná de seed) ──────────────────────────────────────
-- 1. Eindstand-consistentie: vorige stand + netto − uitdeling = huidige stand
--    (verschil moet 0 zijn voor beide fondsen, periode 2026Q2):
--      select f.slug,
--             vorig.stand + som.netto - uitd.waarde - huidig.stand as verschil
--        from public.fondsen f
--        join public.fonds_stuurinfo_reserve huidig
--          on huidig.fonds_id = f.id and huidig.periode = '2026Q2'
--         and huidig.reserve_key = 'solidariteitsreserve'
--        join public.fonds_stuurinfo_reserve vorig
--          on vorig.fonds_id = f.id and vorig.periode = '2026Q1'
--         and vorig.reserve_key = 'solidariteitsreserve'
--        join lateral (
--          select sum(waarde) as netto from public.fonds_stuurinfo_reeks
--           where fonds_id = f.id and periode = '2026Q2' and reeks_key = 'soli_vulling'
--        ) som on true
--        join public.fonds_stuurinfo_kpi uitd
--          on uitd.fonds_id = f.id and uitd.periode = '2026Q2'
--         and uitd.kpi_key = 'soli_uitdeling'
--       where f.slug in ('horizon','meridiaan');
-- 2. FG-maandreeks: 12 punten per fonds/periode, eindpunt = kwartaal-FG:
--      select f.slug, r.periode, count(*),
--             max(r.waarde) filter (where r.punt_key = '11') as laatste
--        from public.fonds_stuurinfo_reeks r join public.fondsen f on f.id = r.fonds_id
--       where r.reeks_key = 'uitkeringsfase_fg_maand' group by 1, 2 order by 1, 2;
-- 3. Spreiding-kerncijfers: 5 kpi-rijen per fonds/periode:
--      select f.slug, k.periode, count(*)
--        from public.fonds_stuurinfo_kpi k join public.fondsen f on f.id = k.fonds_id
--       where k.kpi_key like 'uitkeringsfase_%' group by 1, 2 order by 1, 2;
