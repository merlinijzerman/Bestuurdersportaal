-- ============================================================
--  Opschoonscript — voorbereidingen van vóór het duiding-schema
--  Datum: 2026-07-05 | Context: FO duiding v0.2
-- ============================================================
--  Sinds 05-07 levert de voorbereiding-route een `duiding`-blok en
--  `bronnen[]` in ai_output. Oudere voorbereidingen missen die velden
--  en tonen in de UI een "Vernieuw voorbereiding"-banner.
--
--  Dit script maakt die oude AI-output leeg zodat bestuurders bij een
--  volgende "Genereer" een verse voorbereiding in het nieuwe schema
--  krijgen. LET OP de keuze tussen variant A en B:
--
--  Variant A (AANBEVOLEN): alleen ai_output + bronnen_meta wissen,
--    eigen notities van de bestuurder (eigen_notities, vrije_notities)
--    blijven behouden. De rij blijft bestaan.
--  Variant B: rijen volledig verwijderen — óók de persoonlijke
--    notities gaan dan verloren. Alleen gebruiken als zeker is dat
--    er geen notities zijn die bewaard moeten blijven (demo-data).
--
--  Uitvoeren in de Supabase SQL-editor (service-role; RLS geldt daar
--  niet — het script raakt dus voorbereidingen van ALLE gebruikers).
--  Draai altijd eerst stap 0 (preview).
-- ============================================================

-- ---------------------------------------------------------------
-- Stap 0 — PREVIEW: welke voorbereidingen zijn oud-schema?
-- (ai_output gevuld maar zonder duiding-blok)
-- ---------------------------------------------------------------
select
  v.id,
  v.agendapunt_id,
  v.gebruiker_id,
  v.gegenereerd_op,
  (v.ai_output ? 'duiding')                        as heeft_duiding,
  (v.ai_output <> '{}'::jsonb)                     as heeft_ai_output,
  (v.eigen_notities <> '{}'::jsonb)                as heeft_lens_of_vraag_notities,
  (coalesce(v.vrije_notities, '') <> '')           as heeft_vrije_notities
from public.voorbereidingen v
where v.ai_output <> '{}'::jsonb
  and not (v.ai_output ? 'duiding')
order by v.gegenereerd_op;

-- ---------------------------------------------------------------
-- Variant A (AANBEVOLEN) — AI-output wissen, notities behouden
-- ---------------------------------------------------------------
-- begin;
-- update public.voorbereidingen
-- set ai_output     = '{}'::jsonb,
--     bronnen_meta  = '{}'::jsonb,
--     bijgewerkt_op = now()
-- where ai_output <> '{}'::jsonb
--   and not (ai_output ? 'duiding');
-- -- Controleer het aantal geraakte rijen tegen de preview, dan:
-- commit;  -- of: rollback;

-- ---------------------------------------------------------------
-- Variant B — rijen volledig verwijderen (INCL. eigen notities!)
-- Alleen voor demo-data zonder bewaarwaardige notities.
-- ---------------------------------------------------------------
-- begin;
-- delete from public.voorbereidingen
-- where ai_output <> '{}'::jsonb
--   and not (ai_output ? 'duiding');
-- commit;  -- of: rollback;

-- ---------------------------------------------------------------
-- Naverificatie — verwacht: 0 rijen
-- ---------------------------------------------------------------
-- select count(*) from public.voorbereidingen
-- where ai_output <> '{}'::jsonb and not (ai_output ? 'duiding');
