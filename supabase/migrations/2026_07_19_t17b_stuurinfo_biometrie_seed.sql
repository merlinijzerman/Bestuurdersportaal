-- ============================================================================
-- Migratie 2026-07-19 — T17b: seed tab 3 (Biometrische rendementen)
-- ----------------------------------------------------------------------------
-- WAAROM: synthetische demo-data voor tab 3 (decisions/0078), voor twee
-- fondsen (horizon = prototypegeest; meridiaan ≈ ×0,43 — afgerond en daarna
-- EXACT sluitend gemaakt op de bestaande reserve-/vullingsdata: consistentie
-- wint van schaal, 0076-precedent) en TWEE periodes (2026Q1 + 2026Q2).
--
-- VIER STAPPEN:
--   1. langleven-reeks (micro/macro/vrijval per periode). De som is EXACT de
--      oude soli_vulling.micro_langleven-waarde per fonds/periode — zo blijven
--      alle soli-eindstandvergelijkingen (T15b-seed) kloppen terwijl de
--      decompositie nieuw is. Macro domineert het negatieve Q2-resultaat
--      (prototype: "aanpassing prognosetafel domineert").
--   2. risicodekking-reeks (toegekende PP/WZP en AO/PVI, <= 0). De afgeleide
--      resultaten (premie_component-risicopremies + toegekend) volgen de
--      prototypebedragen: horizon Q2 → PP/WZP 1,1 − 0,3 = +0,8 en AO/PVI
--      1,1 − 0,4 = +0,7.
--   3. HERIJKING oper_mutatie 2026Q2: de nieuwe oper-vergelijking is
--      vorige stand + som(8 bronnen) + resultaat PP/WZP + resultaat AO/PVI
--      = stand. De resultaten zaten in de T16b-seed impliciet in
--      overrendement/verrekening_reserves/overig; die drie worden verlaagd
--      zodat de som exact blijft sluiten (rekencontrole onderaan). 2026Q1 is
--      de oudste periode (geen onafhankelijke primo) — daar geen herijking.
--   4. OPSCHONING: de opgeslagen soli_vulling.micro_langleven-rijen vervallen
--      (reader-afleiding uit de langleven-reeks — decisions/0078; t13b-
--      precedent voor seed-opschoning). De waarde blijft via stap 1 gelijk.
--
-- Afgeleide waarden (netto langleven, resultaten PP/WZP en AO/PVI) worden
-- bewust NIET geseed — de leeslaag leidt ze af (stuurinfo-biometrie.ts).
--
-- Idempotent (upserts op de natuurlijke sleutels; delete herhaalbaar).
-- Transactioneel. Eerst in Supabase draaien (ná t17), DAN code-deploy.
-- ROLLBACK: 2026_07_19_t17b_stuurinfo_biometrie_seed_ROLLBACK.sql
-- (seed-rollback vóór de functie-rollback van t17).
-- HARDE SCOPEGRENS: fonds-aggregaten, geen deelnemer-PII; populatie_n blijft
-- NULL (geen suppressie-vraagstuk).
-- ============================================================================

begin;

-- ── 1. Langleven-resultaat naar bron (reeks langleven, ± € mln) ──────────────
-- Rekencontrole (som = oude micro_langleven-waarde):
--   horizon   Q2: −0,8 − 1,2 + 1,4 = −0,6 ✓ · Q1: −0,3 − 0,2 + 0,8 = +0,3 ✓
--   meridiaan Q2: −0,3 − 0,6 + 0,6 = −0,3 ✓ · Q1: −0,1 − 0,2 + 0,4 = +0,1 ✓
insert into public.fonds_stuurinfo_reeks
  (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, r.periode, 'langleven', r.punt_key, r.label, r.volgorde,
       case when f.slug = 'horizon' then r.horizon else r.meridiaan end
from public.fondsen f
cross join (values
  --  periode    punt_key   label                                  volg  horizon  meridiaan
  ('2026Q2','micro',  'Micro-langleven',                       1, -0.8, -0.3),
  ('2026Q2','macro',  'Macro-langleven',                       2, -1.2, -0.6),
  ('2026Q2','vrijval','Vrijval van kapitaal bij overlijden',   3,  1.4,  0.6),
  ('2026Q1','micro',  'Micro-langleven',                       1, -0.3, -0.1),
  ('2026Q1','macro',  'Macro-langleven',                       2, -0.2, -0.2),
  ('2026Q1','vrijval','Vrijval van kapitaal bij overlijden',   3,  0.8,  0.4)
) as r(periode, punt_key, label, volgorde, horizon, meridiaan)
where f.slug in ('horizon','meridiaan')
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

-- ── 2. Toegekende risicodekkingen (reeks risicodekking, <= 0, € mln) ─────────
-- Binnengekomen risicopremies zijn de BESTAANDE premie_component-rijen
-- (T16b-seed; horizon: PP/WZP 1,1 en AOP+PVI 0,1+1,0 = 1,1 per kwartaal;
-- meridiaan: 0,5 en 0,5) — géén tweede opslag. Afgeleide resultaten:
--   horizon   Q2: +0,8 / +0,7 · Q1: +0,7 / +0,6
--   meridiaan Q2: +0,3 / +0,3 · Q1: +0,3 / +0,2
insert into public.fonds_stuurinfo_reeks
  (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, r.periode, 'risicodekking', r.punt_key, r.label, r.volgorde,
       case when f.slug = 'horizon' then r.horizon else r.meridiaan end
from public.fondsen f
cross join (values
  --  periode    punt_key           label                    volg  horizon  meridiaan
  ('2026Q2','ppwzp_toegekend','Toegekende PP/WZP',       1, -0.3, -0.2),
  ('2026Q2','aopvi_toegekend','Toegekende AO/PVI',       2, -0.4, -0.2),
  ('2026Q1','ppwzp_toegekend','Toegekende PP/WZP',       1, -0.4, -0.2),
  ('2026Q1','aopvi_toegekend','Toegekende AO/PVI',       2, -0.5, -0.3)
) as r(periode, punt_key, label, volgorde, horizon, meridiaan)
where f.slug in ('horizon','meridiaan')
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

-- ── 3. Herijking oper_mutatie 2026Q2 (nieuwe vergelijking sluit exact) ───────
-- Rekencontrole nieuwe vergelijking (vorige + som(8) + r_ppwzp + r_aopvi = stand):
--   horizon:   8,0 + (0,0 −0,1 +0,4 +0,1 +0,2 +0,0 −0,3 −0,8 = −0,5)
--              + 0,8 + 0,7 = 9,0 ✓  (was: overrendement 1,3, verrekening 0,2,
--              overig 0,1 — samen −1,5 herijkt)
--   meridiaan: 3,0 + (0,0 −0,1 +0,4 +0,1 +0,1 +0,0 +0,2 −0,3 = +0,4)
--              + 0,3 + 0,3 = 4,0 ✓  (was: overrendement 0,8, verrekening 0,2
--              — samen −0,6 herijkt)
update public.fonds_stuurinfo_reeks r
set waarde = c.waarde, bijgewerkt = now()
from public.fondsen f,
     (values
       ('horizon',  'overrendement',        0.4),
       ('horizon',  'verrekening_reserves', 0.0),
       ('horizon',  'overig',              -0.3),
       ('meridiaan','overrendement',        0.4),
       ('meridiaan','verrekening_reserves', 0.0)
     ) as c(slug, punt_key, waarde)
where f.slug = c.slug and r.fonds_id = f.id
  and r.periode = '2026Q2' and r.reeks_key = 'oper_mutatie'
  and r.punt_key = c.punt_key
  and r.waarde is distinct from c.waarde;

-- ── 4. Opschoning: soli_vulling.micro_langleven vervalt (reader-afleiding) ───
-- De langleven-post in de soli-ontwikkeling wordt vanaf T17 AFGELEID uit de
-- langleven-reeks (stap 1, zelfde waarde) — decisions/0078. Delete als
-- tabel-eigenaar (RLS kent bewust geen delete-policy voor app-gebruikers);
-- de audittrigger logt geen deletes — geaccepteerd voor seed-opschoning
-- (t13b-precedent).
delete from public.fonds_stuurinfo_reeks r
using public.fondsen f
where r.fonds_id = f.id and f.slug in ('horizon','meridiaan')
  and r.reeks_key = 'soli_vulling' and r.punt_key = 'micro_langleven';

commit;

-- ── Verificatie (handmatig ná de seed) ──────────────────────────────────────
-- 1. Soli-eindstand blijft sluiten (verwacht 0 voor beide fondsen, 2026Q2):
--      select f.slug,
--             round(vorig.stand
--               + (select sum(waarde) from public.fonds_stuurinfo_reeks
--                   where fonds_id = f.id and periode = '2026Q2'
--                     and reeks_key = 'soli_vulling') -- 3 invoerbronnen
--               + (select sum(waarde) from public.fonds_stuurinfo_reeks
--                   where fonds_id = f.id and periode = '2026Q2'
--                     and reeks_key = 'langleven')    -- afgeleide post
--               - uitd.waarde - huidig.stand, 3) as verschil
--        from public.fondsen f
--        join public.fonds_stuurinfo_reserve vorig  on vorig.fonds_id = f.id
--             and vorig.periode = '2026Q1' and vorig.reserve_key = 'solidariteitsreserve'
--        join public.fonds_stuurinfo_reserve huidig on huidig.fonds_id = f.id
--             and huidig.periode = '2026Q2' and huidig.reserve_key = 'solidariteitsreserve'
--        join public.fonds_stuurinfo_kpi uitd on uitd.fonds_id = f.id
--             and uitd.periode = '2026Q2' and uitd.kpi_key = 'soli_uitdeling'
--       where f.slug in ('horizon','meridiaan');
-- 2. Oper-vergelijking sluit (verwacht 0 voor beide fondsen, 2026Q2):
--      select f.slug,
--             round(vorig.stand
--               + (select sum(waarde) from public.fonds_stuurinfo_reeks
--                   where fonds_id = f.id and periode = '2026Q2' and reeks_key = 'oper_mutatie')
--               + (select sum(waarde) from public.fonds_stuurinfo_reeks
--                   where fonds_id = f.id and periode = '2026Q2'
--                     and reeks_key = 'premie_component'
--                     and punt_key in ('risico_ppwzp','risico_aop','risico_pvi'))
--               + (select sum(waarde) from public.fonds_stuurinfo_reeks
--                   where fonds_id = f.id and periode = '2026Q2' and reeks_key = 'risicodekking')
--               - huidig.stand, 3) as verschil
--        from public.fondsen f
--        join public.fonds_stuurinfo_reserve vorig  on vorig.fonds_id = f.id
--             and vorig.periode = '2026Q1' and vorig.reserve_key = 'operationele_reserve'
--        join public.fonds_stuurinfo_reserve huidig on huidig.fonds_id = f.id
--             and huidig.periode = '2026Q2' and huidig.reserve_key = 'operationele_reserve'
--       where f.slug in ('horizon','meridiaan');
-- 3. Geen micro_langleven-rijen meer:
--      select count(*) from public.fonds_stuurinfo_reeks
--       where reeks_key = 'soli_vulling' and punt_key = 'micro_langleven';  -- verwacht: 0
