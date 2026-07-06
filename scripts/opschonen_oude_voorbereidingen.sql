-- ============================================================
--  Opschoonscript — oude AI-output in `voorbereidingen`
--  Datum: 2026-07-06 | Context: voorbereiding als gespreksopener
-- ============================================================
--  Sinds 06-07 schrijft de voorbereiding-route NIETS meer in
--  `voorbereidingen`: "Genereer voorbereiding" plaatst het resultaat
--  als eerste AI-beurt in het agendapunt-gesprek (tabel `gesprekken`).
--  De tabel `voorbereidingen` dient alleen nog voor persoonlijke
--  aantekeningen (vrije_notities; eigen_notities is legacy).
--
--  ALLE bestaande ai_output (duiding-schema én ouder) is daarmee
--  verouderd en wordt nergens meer getoond. Dit script ruimt op.
--  Keuze tussen variant A en B:
--
--  Variant A (AANBEVOLEN): alleen ai_output + bronnen_meta wissen,
--    eigen notities van de bestuurder (eigen_notities, vrije_notities)
--    blijven behouden. De rij blijft bestaan.
--  Variant B: rijen zonder notities volledig verwijderen — veilig,
--    want er gaat niets persoonlijks verloren.
--
--  Uitvoeren in de Supabase SQL-editor (service-role; RLS geldt daar
--  niet — het script raakt dus voorbereidingen van ALLE gebruikers).
--  Draai altijd eerst stap 0 (preview).
-- ============================================================

-- ---------------------------------------------------------------
-- Stap 0 — PREVIEW: welke rijen hebben nog (verouderde) AI-output?
-- ---------------------------------------------------------------
select
  v.id,
  v.agendapunt_id,
  v.gebruiker_id,
  v.gegenereerd_op,
  (v.ai_output <> '{}'::jsonb)                     as heeft_ai_output,
  (v.eigen_notities <> '{}'::jsonb)                as heeft_lens_of_vraag_notities,
  (coalesce(v.vrije_notities, '') <> '')           as heeft_vrije_notities
from public.voorbereidingen v
where v.ai_output <> '{}'::jsonb
order by v.gegenereerd_op;

-- ---------------------------------------------------------------
-- Variant A (AANBEVOLEN) — AI-output wissen, notities behouden
-- ---------------------------------------------------------------
-- begin;
-- update public.voorbereidingen
-- set ai_output     = '{}'::jsonb,
--     bronnen_meta  = '{}'::jsonb,
--     bijgewerkt_op = now()
-- where ai_output <> '{}'::jsonb;
-- -- Controleer het aantal geraakte rijen tegen de preview, dan:
-- commit;  -- of: rollback;

-- ---------------------------------------------------------------
-- Variant B — rijen ZONDER notities volledig verwijderen
-- (rijen mét notities blijven staan; combineer desgewenst met A)
-- ---------------------------------------------------------------
-- begin;
-- delete from public.voorbereidingen
-- where ai_output <> '{}'::jsonb
--   and eigen_notities = '{}'::jsonb
--   and coalesce(vrije_notities, '') = '';
-- commit;  -- of: rollback;

-- ---------------------------------------------------------------
-- Naverificatie — verwacht na A: 0 rijen
-- ---------------------------------------------------------------
-- select count(*) from public.voorbereidingen
-- where ai_output <> '{}'::jsonb;
