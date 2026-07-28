-- ============================================================================
-- Migratie 2026-07-28 — Huisstijl tranche 1 (besluit 0084): Meridiaan nav-tekst
-- ----------------------------------------------------------------------------
-- WAAROM: tranche 1 draait de navigatie van diep ink-navy naar LICHT, met
-- donkere navtekst als default (globals.css: --nav-text-rgb 90 96 128,
-- --nav-text-active-rgb 23 26 40). Het fictieve demo-fonds "Stichting Demofonds
-- Meridiaan" (seed 2026_07_09_t8_demo_fonds_seed.sql) overschrijft echter
-- `nav-rgb` naar diep groen (30 58 47) ZONDER óók de navtekst te themen. Daardoor
-- erft Meridiaan nu de nieuwe DONKERE navtekst op een DONKERE achtergrond →
-- onleesbaar menu. Onder de oude (donkere) default was dit niet zichtbaar.
--
-- Deze migratie merget twee allowlist-tokens (THEMABARE_TOKENS, zie
-- core/lib/fonds-config-core.ts) in de bestaande theming-jsonb, met LICHTE
-- navtekst afgestemd op Meridiaans donkergroene nav:
--   nav-text-rgb        = 190 205 197   (7,48:1 op 30 58 47 — AA)
--   nav-text-active-rgb = 244 248 245   (11,51:1 op 30 58 47 — AA)
--
-- SCOPE: puur cosmetische data-correctie voor het demo-fonds. Raakt Horizon niet
-- (Horizon heeft geen theming-rij → erft de lichte default). GEEN RLS-/policy-/
-- schemawijziging; GEEN nieuwe grants. De UPDATE vuurt de bestaande append-only
-- config-audit-trigger (t8b) — gewenst en reproduceerbaar.
--
-- IDEMPOTENT: alleen bijwerken als `nav-text-rgb` nog niet in de tokens staat,
-- zodat herhaald draaien `versie` niet blijft ophogen.
-- MIGRATIE-EERST-DAN-DEPLOY: draai deze migratie in Supabase vóór de code-deploy.
-- ROLLBACK: 2026_07_28_huisstijl_t1_meridiaan_nav_text_ROLLBACK.sql
-- ============================================================================

begin;

update public.fonds_theming ft
   set tokens = ft.tokens || jsonb_build_object(
                  'nav-text-rgb',        '190 205 197',
                  'nav-text-active-rgb', '244 248 245'
                ),
       versie = ft.versie + 1,
       bijgewerkt = now()
  from public.fondsen f
 where f.id = ft.fonds_id
   and f.slug = 'meridiaan'
   and not (ft.tokens ? 'nav-text-rgb');

commit;
