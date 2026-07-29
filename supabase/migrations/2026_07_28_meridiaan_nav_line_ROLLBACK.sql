-- ============================================================================
-- ROLLBACK 2026-07-28 — Meridiaan nav-line terugdraaien
-- ----------------------------------------------------------------------------
-- Verwijdert het token dat 2026_07_28_meridiaan_nav_line.sql toevoegde, zodat
-- Meridiaan weer terugvalt op de globale (lichte) nav-line-default.
--
-- LET OP: na deze rollback is Meridiaans menu-tekst bij HOVER weer onleesbaar
-- (bijna-wit op bijna-wit, ~1,12:1) zolang de lichte tokenlaag actief is, en
-- is de rechterrand van de sidebar weer een felle lichte lijn op donkergroen.
-- Draai dus alleen terug in combinatie met het terugdraaien van de tokenlaag
-- zelf, of wanneer Meridiaan een andere nav-kleur krijgt.
--
-- Idempotent: alleen als het token aanwezig is.
-- ============================================================================

begin;

update public.fonds_theming ft
   set tokens = ft.tokens - 'nav-line-rgb',
       versie = ft.versie + 1,
       bijgewerkt = now()
  from public.fondsen f
 where f.id = ft.fonds_id
   and f.slug = 'meridiaan'
   and (ft.tokens ? 'nav-line-rgb');

commit;
