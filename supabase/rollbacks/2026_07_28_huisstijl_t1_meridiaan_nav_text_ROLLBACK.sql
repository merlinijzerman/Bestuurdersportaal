-- ============================================================================
-- ROLLBACK 2026-07-28 — Huisstijl tranche 1: Meridiaan nav-tekst terugdraaien
-- ----------------------------------------------------------------------------
-- Verwijdert de twee nav-tekst-tokens die 2026_07_28_huisstijl_t1_meridiaan_
-- nav_text.sql toevoegde, zodat Meridiaan weer terugvalt op de globale
-- (lichte) navtekst-default. LET OP: na deze rollback is Meridiaans menu weer
-- onleesbaar zolang de lichte-nav-tokenlaag actief is — draai alleen terug in
-- combinatie met het terugdraaien van de tokenlaag zelf.
--
-- Idempotent: alleen als de tokens aanwezig zijn.
-- ============================================================================

begin;

update public.fonds_theming ft
   set tokens = ft.tokens - 'nav-text-rgb' - 'nav-text-active-rgb',
       versie = ft.versie + 1,
       bijgewerkt = now()
  from public.fondsen f
 where f.id = ft.fonds_id
   and f.slug = 'meridiaan'
   and (ft.tokens ? 'nav-text-rgb');

commit;
