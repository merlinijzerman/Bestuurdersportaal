-- ============================================================================
-- Migratie 2026-07-10 — T11 SEED: synthetische aggregaatdata + module-config
-- ----------------------------------------------------------------------------
-- WAAROM: vult de T11-datatabellen (2026_07_10_t11_stuurinfo_klantbeeld_data.sql)
-- met SYNTHETISCHE, PII-vrije aggregaatdata voor twee fondsen — 'horizon' en het
-- demo-fonds 'meridiaan' (2026_07_09_t8_demo_fonds_seed.sql) — met bewust
-- VERSCHILLENDE waarden + config, zodat acceptatiecriterium 1 aantoonbaar is:
-- twee fondsen tonen op één codebase verschillende, correct gescheiden inhoud.
--
-- GEEN DEELNEMER-PII: alle rijen zijn aggregaat/cohort/fonds-niveau. De cohort-
-- rijen zijn een gesloten-vorm functie van leeftijd (geen individu-data). De
-- getallen zijn realistische dummy's (CLAUDE.md: alle stuurinformatiecijfers zijn
-- dummy-data). Deze seed is verwijderbaar vóór echte administratiekoppeling.
--
-- CONFIG-GEDREVEN: per-fonds presentatie/inhoud (KPI-volgorde, signaleringen,
-- werkgever-basisparameters, segmenten) gaat in fonds_module_manifest.config
-- (jsonb) — óók tenant-geïsoleerd via de manifest-RLS. Numerieke FEITEN staan in
-- de RLS-datatabellen; PRESENTATIE/CONTENT in de config.
--
-- SUPPRESSIE-DEMO (decisions/0055, n<10): Meridiaan krijgt één bewust kleine
-- deelnemer-status-cel (populatie_n=4) zodat de kleine-populatie-suppressie in de
-- UI zichtbaar wordt (waarde onderdrukt). De app-leeslaag maskeert n<10.
--
-- Idempotent (on conflict do update / do nothing). Afhankelijk van de T11-tabel-
-- migratie én 2026_07_09_t8_demo_fonds_seed.sql (fonds 'meridiaan').
-- ROLLBACK: 2026_07_10_t11_seed_synthetisch_ROLLBACK.sql
-- ============================================================================

begin;

-- ── 1. Cohort-aggregaten (18..68) voor beide fondsen ────────────────────────
-- Gesloten-vorm functie van leeftijd (geen RNG, geen individu-data). Per-fonds
-- factoren differentiëren omvang (aantal) en salarisniveau. base-CTE berekent de
-- tussenwaarden; de insert leidt de kolommen af.
with ff(slug, aantal_factor, salaris_factor) as (
  values ('horizon', 1.00, 1.00),
         ('meridiaan', 0.42, 1.12)
), base as (
  select
    f.id as fonds_id,
    a.age as leeftijd,
    ff.aantal_factor,
    ff.salaris_factor,
    greatest(0.0, least(1.0, (a.age - 18) / 50.0)) as t,
    (case
       when a.age < 25 then 600 when a.age < 35 then 950
       when a.age < 45 then 1350 when a.age < 55 then 1450
       when a.age < 60 then 1300 when a.age < 65 then 950 else 700 end) as pop_peak,
    ((30000 + least(a.age - 25, 30) * 1400) * ff.salaris_factor) as salaris,
    greatest(0, least(a.age - 25, 42)) as dienstjaren
  from ff
  join public.fondsen f on f.slug = ff.slug
  cross join generate_series(18, 68) as a(age)
)
insert into public.fonds_klantbeeld_cohort (
  fonds_id, leeftijd, aantal, actief_p, slapend_p, uitkerend_p, salaris,
  maand_premie, maand_uitkering, invaar_kapitaal, doel_op67,
  over_weight, bescherm_weight, duration_jr, uitvoering_mult
)
select
  b.fonds_id,
  b.leeftijd,
  round(b.pop_peak * b.aantal_factor)::int as aantal,
  -- status-split (piecewise, identiek aan lib/klantbeeld-data.ts cohortConfig)
  (case
     when b.leeftijd < 22 then 0.85
     when b.leeftijd < 60 then 1 - (0.2 + (b.leeftijd - 22) * 0.005)
     when b.leeftijd < 67 then (1 - (b.leeftijd - 60) / 7.0) * 0.65
     else 0 end)::numeric(6,4) as actief_p,
  (case
     when b.leeftijd < 22 then 0.15
     when b.leeftijd < 60 then 0.2 + (b.leeftijd - 22) * 0.005
     when b.leeftijd < 67 then 0.35
     else 0.05 end)::numeric(6,4) as slapend_p,
  (case
     when b.leeftijd < 60 then 0
     when b.leeftijd < 67 then ((b.leeftijd - 60) / 7.0) * 0.65
     else 0.95 end)::numeric(6,4) as uitkerend_p,
  round(b.salaris)::numeric as salaris,
  (case when b.leeftijd >= 67 then 0 else round(b.salaris * 0.3 * 0.2 / 12) end) as maand_premie,
  (case when b.leeftijd >= 65 then round(b.salaris * 0.65 / 12) else 0 end) as maand_uitkering,
  round((case when b.leeftijd < 22
              then (b.dienstjaren * 5500 + greatest(0, b.leeftijd - 25) * 2200) * 0.5
              else (b.dienstjaren * 5500 + greatest(0, b.leeftijd - 25) * 2200) end)
        * b.salaris_factor) as invaar_kapitaal,
  round(350000 * greatest(0.7, least(1.4, b.salaris / 55000.0))) as doel_op67,
  (1 - b.t * 0.8)::numeric(6,4) as over_weight,
  (b.t * 0.8)::numeric(6,4) as bescherm_weight,
  (8 + b.t * 12)::numeric(6,3) as duration_jr,
  (0.85 + 0.30 * ((b.leeftijd % 7) / 7.0))::numeric(6,4) as uitvoering_mult
from base b
on conflict (fonds_id, leeftijd) do update set
  aantal = excluded.aantal, actief_p = excluded.actief_p, slapend_p = excluded.slapend_p,
  uitkerend_p = excluded.uitkerend_p, salaris = excluded.salaris,
  maand_premie = excluded.maand_premie, maand_uitkering = excluded.maand_uitkering,
  invaar_kapitaal = excluded.invaar_kapitaal, doel_op67 = excluded.doel_op67,
  over_weight = excluded.over_weight, bescherm_weight = excluded.bescherm_weight,
  duration_jr = excluded.duration_jr, uitvoering_mult = excluded.uitvoering_mult,
  bijgewerkt = now();

-- ── 2. Stuurinformatie-KPI's ────────────────────────────────────────────────
-- Horizon (uit de bestaande demo-constanten). Meridiaan differentieert.
insert into public.fonds_stuurinfo_kpi (fonds_id, kpi_key, label, waarde, delta, eenheid, toelichting, volgorde, populatie_n)
select f.id, k.kpi_key, k.label, k.waarde, k.delta, k.eenheid, k.toelichting, k.volgorde, k.populatie_n
from public.fondsen f
cross join (values
  ('financieringsgraad',     'Financieringsgraad',                102.4,  0.3,  'pct',        '+0,3 pp t.o.v. Q4',                  1, null::int),
  ('aanpassing_uitkeringen', 'Jaarlijkse aanpassing uitkeringen', 0.48,   null, 'pct_signed', 'indicatie volgend jaar · 1/5 × (FG − 100%)', 2, null),
  ('solidariteitsreserve',   'Solidariteitsreserve',              2.4,    null, 'pct',        'target 5% · opbouw',                 3, null),
  ('vermogen',               'Vermogen',                          98400,  1700, 'mln',        '+1,7 mld YTD',                       4, null),
  ('rendement_ytd',          'Rendement YTD',                     6.8,    6.4,  'pct',        'benchmark +6,4%',                    5, null),
  ('deelnemers_totaal',      'Deelnemers',                        1210300,1840, 'aantal',     'netto mutatie t.o.v. Q4',            6, 1210300)
) as k(kpi_key, label, waarde, delta, eenheid, toelichting, volgorde, populatie_n)
where f.slug = 'horizon'
on conflict (fonds_id, kpi_key) do update set
  label = excluded.label, waarde = excluded.waarde, delta = excluded.delta,
  eenheid = excluded.eenheid, toelichting = excluded.toelichting,
  volgorde = excluded.volgorde, populatie_n = excluded.populatie_n, bijgewerkt = now();

insert into public.fonds_stuurinfo_kpi (fonds_id, kpi_key, label, waarde, delta, eenheid, toelichting, volgorde, populatie_n)
select f.id, k.kpi_key, k.label, k.waarde, k.delta, k.eenheid, k.toelichting, k.volgorde, k.populatie_n
from public.fondsen f
cross join (values
  ('financieringsgraad',     'Financieringsgraad',                108.2,  0.6,  'pct',        '+0,6 pp t.o.v. Q4',                  1, null::int),
  ('solidariteitsreserve',   'Solidariteitsreserve',              4.1,    null, 'pct',        'target 5% · vrijwel op peil',        2, null),
  ('vermogen',               'Vermogen',                          42600,  900,  'mln',        '+0,9 mld YTD',                       3, null),
  ('rendement_ytd',          'Rendement YTD',                     5.9,    6.1,  'pct',        'benchmark +6,1%',                    4, null),
  ('deelnemers_totaal',      'Deelnemers',                        318400, -240, 'aantal',     'netto mutatie t.o.v. Q4',            5, 318400)
) as k(kpi_key, label, waarde, delta, eenheid, toelichting, volgorde, populatie_n)
where f.slug = 'meridiaan'
on conflict (fonds_id, kpi_key) do update set
  label = excluded.label, waarde = excluded.waarde, delta = excluded.delta,
  eenheid = excluded.eenheid, toelichting = excluded.toelichting,
  volgorde = excluded.volgorde, populatie_n = excluded.populatie_n, bijgewerkt = now();

-- ── 3a. Trend financieringsgraad (24 mnd) ───────────────────────────────────
insert into public.fonds_stuurinfo_reeks (fonds_id, reeks_key, punt_key, label, volgorde, waarde)
select f.id, 'trend_fg', lpad(g.i::text, 2, '0'), g.lbl, g.i, g.val
from public.fondsen f
cross join (values
  (0,'mei',99.1),(1,'jun',99.4),(2,'jul',99.7),(3,'aug',100.0),(4,'sep',100.3),(5,'okt',100.5),
  (6,'nov',100.7),(7,'dec',100.9),(8,'jan',101.0),(9,'feb',101.2),(10,'mrt',101.4),(11,'apr',101.5),
  (12,'mei',101.6),(13,'jun',101.8),(14,'jul',102.0),(15,'aug',102.1),(16,'sep',102.2),(17,'okt',102.0),
  (18,'nov',102.1),(19,'dec',102.2),(20,'jan',102.3),(21,'feb',102.4),(22,'mrt',102.3),(23,'apr',102.4)
) as g(i, lbl, val)
where f.slug = 'horizon'
on conflict (fonds_id, reeks_key, punt_key) do update set waarde = excluded.waarde, label = excluded.label, bijgewerkt = now();

insert into public.fonds_stuurinfo_reeks (fonds_id, reeks_key, punt_key, label, volgorde, waarde)
select f.id, 'trend_fg', lpad(g.i::text, 2, '0'), g.lbl, g.i, g.val
from public.fondsen f
cross join (values
  (0,'mei',104.0),(1,'jun',104.3),(2,'jul',104.9),(3,'aug',105.2),(4,'sep',105.6),(5,'okt',105.8),
  (6,'nov',106.0),(7,'dec',106.3),(8,'jan',106.5),(9,'feb',106.8),(10,'mrt',107.0),(11,'apr',107.1),
  (12,'mei',107.3),(13,'jun',107.5),(14,'jul',107.6),(15,'aug',107.7),(16,'sep',107.9),(17,'okt',107.7),
  (18,'nov',107.9),(19,'dec',108.0),(20,'jan',108.1),(21,'feb',108.2),(22,'mrt',108.1),(23,'apr',108.2)
) as g(i, lbl, val)
where f.slug = 'meridiaan'
on conflict (fonds_id, reeks_key, punt_key) do update set waarde = excluded.waarde, label = excluded.label, bijgewerkt = now();

-- ── 3b. Balans + deelnemer-status + cohortverdeling (Horizon expliciet) ─────
insert into public.fonds_stuurinfo_reeks (fonds_id, reeks_key, punt_key, label, volgorde, waarde, delta, kleur, populatie_n)
select f.id, r.reeks_key, r.punt_key, r.label, r.volgorde, r.waarde, r.delta, r.kleur, r.populatie_n
from public.fondsen f
cross join (values
  -- balans activa
  ('balans_activa_bescherming','staatsobl','Staatsobligaties',1,27620,0.8,null,null::int),
  ('balans_activa_bescherming','bedrijfsobl','Bedrijfsobligaties',2,12840,1.2,null,null),
  ('balans_activa_bescherming','hypotheken','Hypotheken',3,4510,0.1,null,null),
  ('balans_activa_bescherming','rentederiv','Rentederivaten',4,4230,-2.3,null,null),
  ('balans_activa_overrend','aandelen_ontw','Aandelen ontwikkeld',1,19420,5.4,null,null),
  ('balans_activa_overrend','aandelen_opk','Aandelen opkomend',2,9180,3.1,null,null),
  ('balans_activa_overrend','vastgoed','Vastgoed',3,8870,-0.7,null,null),
  ('balans_activa_overrend','alternatieven','Alternatieven',4,8560,2.8,null,null),
  ('balans_activa_liquide','liquide','Liquide middelen',1,2490,0,null,null),
  ('balans_activa_liquide','vorderingen','Vorderingen',2,680,0,null,null),
  -- balans passiva: persoonlijke pensioenvermogens (delta = rendementPct)
  ('balans_passiva_ppv','c_lt35','Cohort < 35 jaar',1,18700,8.2,'#534AB7',null),
  ('balans_passiva_ppv','c_35_55','Cohort 35–55',2,37400,5.9,'#185FA5',null),
  ('balans_passiva_ppv','c_55_67','Cohort 55–67',3,20500,3.4,'var(--ok)',null),
  ('balans_passiva_ppv','c_67p','Uitkeringsfase 67+',4,17100,1.8,'var(--muted)',null),
  ('balans_passiva_reserve','saldo','Beschikbaar saldo',1,2400,260,null,null),
  ('balans_passiva_overig','compensatie','Compensatiedepot',1,1620,-220,null,null),
  ('balans_passiva_overig','operationeel','Operationele reserve',2,680,0,null,null),
  -- deelnemer-status (populatie_n = aantal → suppressie-drager)
  ('deelnemer_status','actief','Actief',1,462180,820,'#185FA5',462180),
  ('deelnemer_status','slaper','Slaper',2,389640,120,'#85B7EB',389640),
  ('deelnemer_status','ao','Arbeidsongeschikt',3,19350,-30,'var(--warn)',19350),
  ('deelnemer_status','pensioen','Pensioengerechtigd',4,331860,960,'var(--ok)',331860),
  ('deelnemer_status','nabestaande','Nabestaande / wees',5,7270,-30,'var(--muted)',7270),
  -- mutaties
  ('deelnemer_mutatie','instroom','Instroom Q1',1,4130,null,null,null),
  ('deelnemer_mutatie','uitstroom','Uitstroom Q1',2,2290,null,null,null),
  ('deelnemer_mutatie','pensioneringen','Pensioneringen Q1',3,1120,null,null,null)
) as r(reeks_key, punt_key, label, volgorde, waarde, delta, kleur, populatie_n)
where f.slug = 'horizon'
on conflict (fonds_id, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde, waarde = excluded.waarde,
  delta = excluded.delta, kleur = excluded.kleur, populatie_n = excluded.populatie_n, bijgewerkt = now();

-- ── 3c. Meridiaan balans/status: afgeleid van Horizon (schaal 0,43), plus een
--         bewust KLEINE cel (populatie_n=4) voor de suppressie-demo. ──────────
insert into public.fonds_stuurinfo_reeks (fonds_id, reeks_key, punt_key, label, volgorde, waarde, delta, kleur, populatie_n)
select m.id, r.reeks_key, r.punt_key, r.label, r.volgorde,
       round(r.waarde * 0.43),
       case when r.reeks_key = 'balans_passiva_ppv' then r.delta else round(r.delta * 0.43) end,
       r.kleur,
       case when r.populatie_n is null then null else round(r.populatie_n * 0.43)::int end
from public.fonds_stuurinfo_reeks r
join public.fondsen h on h.id = r.fonds_id and h.slug = 'horizon'
cross join public.fondsen m
where m.slug = 'meridiaan'
  and r.reeks_key in ('balans_activa_bescherming','balans_activa_overrend','balans_activa_liquide',
                      'balans_passiva_ppv','balans_passiva_reserve','balans_passiva_overig',
                      'deelnemer_status','deelnemer_mutatie')
on conflict (fonds_id, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde, waarde = excluded.waarde,
  delta = excluded.delta, kleur = excluded.kleur, populatie_n = excluded.populatie_n, bijgewerkt = now();

-- Bewust kleine deelnemer-status-cel bij Meridiaan → suppressie zichtbaar (n<10).
insert into public.fonds_stuurinfo_reeks (fonds_id, reeks_key, punt_key, label, volgorde, waarde, delta, kleur, populatie_n)
select m.id, 'deelnemer_status', 'wezenregeling_pilot', 'Wezenregeling (pilot)', 6, 4, 1, 'var(--accent)', 4
from public.fondsen m where m.slug = 'meridiaan'
on conflict (fonds_id, reeks_key, punt_key) do update set
  waarde = excluded.waarde, populatie_n = excluded.populatie_n, bijgewerkt = now();

-- ── 4. Module-config per fonds (fonds_module_manifest.config, jsonb) ────────
-- Presentatie/content-differentiatie. actief = true (modules blijven aan).
-- Stuurinformatie: KPI-volgorde + signaleringen + vergaderingen + peildatum.
insert into public.fonds_module_manifest (fonds_id, module_key, actief, config, versie)
select f.id, 'stuurinformatie', true, c.config::jsonb, 1
from public.fondsen f
cross join (values ('{"peildatum":"31 maart 2026","kpiVolgorde":["financieringsgraad","aanpassing_uitkeringen","solidariteitsreserve","vermogen","rendement_ytd"],"toonBalans":true,"toonTrend":true,"signaleringen":[{"kleur":"amber","titel":"Solidariteitsreserve onder bandbreedte","sub":"2,4% — afspraak 5%; aanvullingstempo conform plan"},{"kleur":"blue","titel":"DNB-rapportage Q1 deadline 30 april","sub":"Voortgang ABTN-update: 70%"},{"kleur":"green","titel":"Toedelingsregels-toetsing waarmerkend actuaris","sub":"Afgerond — geen bevindingen"}],"vergaderingen":[{"categorie":"Bestuur","titel":"Bestuursvergadering Q2 — agendaconcept","datum":"15 mei","kleur":"blue"},{"categorie":"Beleg.com.","titel":"Herijking beschermingsrendement-toedeling","datum":"8 mei","kleur":"amber"},{"categorie":"Risico","titel":"Update IRM-overzicht voor mei-vergadering","datum":"12 mei","kleur":"blue"}]}')) as c(config)
where f.slug = 'horizon'
on conflict (fonds_id, module_key) do update set config = excluded.config, actief = true, bijgewerkt = now();

insert into public.fonds_module_manifest (fonds_id, module_key, actief, config, versie)
select f.id, 'stuurinformatie', true, c.config::jsonb, 1
from public.fondsen f
cross join (values ('{"peildatum":"31 maart 2026","kpiVolgorde":["financieringsgraad","solidariteitsreserve","vermogen","rendement_ytd"],"toonBalans":true,"toonTrend":true,"signaleringen":[{"kleur":"green","titel":"Solidariteitsreserve vrijwel op peil","sub":"4,1% — afspraak 5%"},{"kleur":"blue","titel":"Jaarwerk 2025 in afronding","sub":"Accountantscontrole loopt"}],"vergaderingen":[{"categorie":"Bestuur","titel":"Bestuursvergadering mei — agenda","datum":"22 mei","kleur":"blue"},{"categorie":"Risico","titel":"Herijking risicobereidheid","datum":"19 mei","kleur":"amber"}]}')) as c(config)
where f.slug = 'meridiaan'
on conflict (fonds_id, module_key) do update set config = excluded.config, actief = true, bijgewerkt = now();

-- Klantbeeld: werkgever-basisparameters + segmenten + inning-baseline.
insert into public.fonds_module_manifest (fonds_id, module_key, actief, config, versie)
select f.id, 'klantbeeld', true, c.config::jsonb, 1
from public.fondsen f
cross join (values ('{"werkgeverBasis":{"werkgevers0":372,"gemSalaris0":48500,"franchise":16500,"premiepctPg":0.30,"wgDeel":0.6667},"segmenten":[{"key":"klein","naam":"Klein","toelichting":"1–25 werknemers","werkgeversAandeel":0.66,"werknemersAandeel":0.18,"premieAandeel":0.16,"kleur":"#94a3b8"},{"key":"midden","naam":"Midden","toelichting":"25–200 werknemers","werkgeversAandeel":0.27,"werknemersAandeel":0.38,"premieAandeel":0.39,"kleur":"#0ea5e9"},{"key":"groot","naam":"Groot","toelichting":"> 200 werknemers","werkgeversAandeel":0.07,"werknemersAandeel":0.44,"premieAandeel":0.45,"kleur":"var(--accent)"}],"inning":{"opTijd0":0.93}}')) as c(config)
where f.slug = 'horizon'
on conflict (fonds_id, module_key) do update set config = excluded.config, actief = true, bijgewerkt = now();

insert into public.fonds_module_manifest (fonds_id, module_key, actief, config, versie)
select f.id, 'klantbeeld', true, c.config::jsonb, 1
from public.fondsen f
cross join (values ('{"werkgeverBasis":{"werkgevers0":154,"gemSalaris0":52000,"franchise":16500,"premiepctPg":0.28,"wgDeel":0.5},"segmenten":[{"key":"klein","naam":"Klein","toelichting":"1–25 werknemers","werkgeversAandeel":0.48,"werknemersAandeel":0.10,"premieAandeel":0.08,"kleur":"#94a3b8"},{"key":"midden","naam":"Midden","toelichting":"25–200 werknemers","werkgeversAandeel":0.34,"werknemersAandeel":0.30,"premieAandeel":0.28,"kleur":"#0ea5e9"},{"key":"groot","naam":"Groot","toelichting":"> 200 werknemers","werkgeversAandeel":0.18,"werknemersAandeel":0.60,"premieAandeel":0.64,"kleur":"var(--accent)"}],"inning":{"opTijd0":0.90}}')) as c(config)
where f.slug = 'meridiaan'
on conflict (fonds_id, module_key) do update set config = excluded.config, actief = true, bijgewerkt = now();

commit;

-- ── Verificatie (handmatig ná de seed) ──────────────────────────────────────
-- 1. Beide fondsen hebben 51 cohort-rijen:
--      select f.slug, count(*) from public.fonds_klantbeeld_cohort c
--        join public.fondsen f on f.id = c.fonds_id group by f.slug;
-- 2. Suppressie-cel aanwezig (Meridiaan, n<10):
--      select populatie_n from public.fonds_stuurinfo_reeks r join public.fondsen f
--        on f.id=r.fonds_id where f.slug='meridiaan' and r.punt_key='wezenregeling_pilot';
-- 3. Config gezet:
--      select f.slug, m.module_key, m.config->>'peildatum'
--        from public.fonds_module_manifest m join public.fondsen f on f.id=m.fonds_id
--       where m.module_key in ('stuurinformatie','klantbeeld');
