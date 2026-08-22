-- ============================================================================
--  SEED (PREVIEW ONLY) 2026-08-15 — fictieve fonds_licentie voor de demo
--
--  ⚠ UITSLUITEND OP PREVIEW DRAAIEN. NIET OP PRODUCTIE.
--  §12 van de werkopdracht en CLAUDE.md: Preview bevat uitsluitend synthetische
--  inhoud; Productie krijgt ECHTE licentiecijfers via het platform-beheer, niet
--  deze fictieve seed. Draai dit bestand daarom nooit tegen Productie
--  (aebwiufuegsiwhwpdrfb) — alleen tegen Preview (swviwoytzvaqypieqgji).
--
--  WAT DIT SEEDT
--  Eén licentierij per demo-fonds (pgb, phenc, huisartsenpensioen, meridiaan),
--  met de fictieve bundel/tarieven uit MOCKUP-monitoring-verbruik-bundel-v0.2.
--  De contract-ingangsdatums zijn RELATIEF aan het lopende jaar (now()), zodat
--  de weergave (die standaard het huidige jaar toont) de rijen daadwerkelijk
--  oppikt en huisartsenpensioen het "later gestart"-geval demonstreert
--  (jan/feb = n.v.t., pro-rata bundel) — acceptatiecriterium 2.
--
--  Het VERBRUIK zelf (euro's/status) komt live uit governance_log; deze seed
--  vult alleen de licentie-config. De exacte mockup-scenario's (Delta rood,
--  Alpha oranje) worden bewezen door core/lib/verbruik-bundel-core.sanity.ts,
--  niet door productie-tokens naar Preview te kopiëren.
--
--  IDEMPOTENT: on conflict (fonds_id) do nothing. Fondsen die (nog) niet bestaan
--  leveren simpelweg geen rij op.
--  ROLLBACK: 2026_08_15_fonds_licentie_seed_preview_ROLLBACK.sql
-- ============================================================================

begin;

insert into public.fonds_licentie
  (fonds_id, bundel_eur_jaar, tarief_in_eur_mln, tarief_uit_eur_mln, contract_start, geldig_vanaf)
select f.id, s.bundel, s.t_in, s.t_uit, s.start, date_trunc('year', now())::date
from (values
  ('pgb',                2400, 5.32, 26.63, date_trunc('year', now())::date),
  ('phenc',              2400, 5.32, 26.63, date_trunc('year', now())::date),
  ('huisartsenpensioen', 2400, 5.32, 26.63, (date_trunc('year', now()) + interval '2 months')::date),
  ('meridiaan',          2400, 5.32, 26.63, date_trunc('year', now())::date)
) as s(slug, bundel, t_in, t_uit, start)
join public.fondsen f on f.slug = s.slug
on conflict (fonds_id) do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.fonds_licentie;
  raise notice 'PREVIEW-SEED OK: fonds_licentie bevat nu % rij(en).', n;
end $$;

commit;
