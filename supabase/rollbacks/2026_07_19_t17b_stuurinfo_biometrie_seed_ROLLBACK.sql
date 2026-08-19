-- ============================================================================
-- ROLLBACK 2026-07-19 — T17b: seed tab 3 (Biometrische rendementen)
-- ----------------------------------------------------------------------------
-- Draai dit VÓÓR 2026_07_19_t17_stuurinfo_biometrie_ROLLBACK.sql: de herstelde
-- T15-functie verwacht de soli_vulling.micro_langleven-rijen die stap 3 hier
-- terugzet. Herstelt exact de T15b-/T16b-seedwaarden.
-- ============================================================================

begin;

-- ── 1. Nieuwe reeksen verwijderen ────────────────────────────────────────────
delete from public.fonds_stuurinfo_reeks r
using public.fondsen f
where r.fonds_id = f.id and f.slug in ('horizon','meridiaan')
  and r.reeks_key in ('langleven','risicodekking');

-- ── 2. Herijking oper_mutatie 2026Q2 terugdraaien (T16b-waarden) ─────────────
update public.fonds_stuurinfo_reeks r
set waarde = c.waarde, bijgewerkt = now()
from public.fondsen f,
     (values
       ('horizon',  'overrendement',        1.3),
       ('horizon',  'verrekening_reserves', 0.2),
       ('horizon',  'overig',               0.1),
       ('meridiaan','overrendement',        0.8),
       ('meridiaan','verrekening_reserves', 0.2)
     ) as c(slug, punt_key, waarde)
where f.slug = c.slug and r.fonds_id = f.id
  and r.periode = '2026Q2' and r.reeks_key = 'oper_mutatie'
  and r.punt_key = c.punt_key
  and r.waarde is distinct from c.waarde;

-- ── 3. soli_vulling.micro_langleven herstellen (T15b-waarden) ────────────────
insert into public.fonds_stuurinfo_reeks
  (fonds_id, periode, reeks_key, punt_key, label, volgorde, waarde)
select f.id, r.periode, 'soli_vulling', 'micro_langleven',
       'Resultaat micro-langleven', 3, r.waarde
from public.fondsen f
join (values
  ('horizon',  '2026Q2', -0.6),
  ('horizon',  '2026Q1',  0.3),
  ('meridiaan','2026Q2', -0.3),
  ('meridiaan','2026Q1',  0.1)
) as r(slug, periode, waarde) on r.slug = f.slug
on conflict (fonds_id, periode, reeks_key, punt_key) do update set
  label = excluded.label, volgorde = excluded.volgorde,
  waarde = excluded.waarde, bijgewerkt = now();

commit;
