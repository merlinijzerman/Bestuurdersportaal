-- ============================================================================
-- Migratie 2026-07-28 — Meridiaan: nav-line meethemen (nawerk huisstijl T1)
-- ----------------------------------------------------------------------------
-- WAAROM: het demo-fonds Meridiaan overschrijft `nav-rgb` naar donkergroen
-- (30 58 47) en sinds 2026_07_28_huisstijl_t1_meridiaan_nav_text.sql ook de
-- navtekst — maar NIET `nav-line-rgb`. Dat token erft daardoor de lichte
-- default uit globals.css (228 231 241), en `nav-line` doet in
-- core/components/Sidebar.tsx twee dingen tegelijk:
--
--   1. de rechterrand van de sidebar          (border-r border-nav-line)
--   2. de hover-vulling van menu-items        (hover:bg-nav-line
--      hover:text-nav-text-active — regels 126, 151, 201)
--
-- Gevolg (2): bij hover krijgt Meridiaan een bijna-witte vulling (228 231 241)
-- met bijna-witte tekst erop (nav-text-active 244 248 245) => ~1,12:1. De
-- menu-tekst verdwijnt onder de cursor. Gevolg (1): een felle lichte rand tegen
-- donkergroen.
--
-- Dit is de spiegel van de bug die besluit 0084 ving voor `nav-text`: daar is
-- vastgesteld dat de hover-VULLING op een donkere tenant-nav zichtbaar blijft,
-- maar niet nagelopen of de TEKST op die vulling nog leesbaar is wanneer de
-- tenant `nav-line` niet meethemt.
--
-- WAARDE: nav-line-rgb = 56 88 72 (donkergroen, afgestemd op Meridiaans nav).
--   - nav-text-active (244 248 245) op 56 88 72 =  7,37:1  (AA, ruim)
--   - nav-text        (190 205 197) op 56 88 72 =  4,79:1  (AA)
--   - hover-vulling   (56 88 72)  op nav 30 58 47 = 1,56:1 (zichtbaar; de
--     lichte default-nav haalt ter vergelijking 1,20:1 — dus consistent met
--     de hover-sterkte die het portaal elders heeft)
--
-- SCOPE: puur cosmetische data-correctie op één bestaande, RLS-beschermde rij
-- van het FICTIEVE demo-fonds (seed 2026_07_09_t8_demo_fonds_seed.sql; geen
-- auth-gebruikers, "verwijderen vóór productie"). Raakt Horizon niet — dat
-- fonds heeft geen theming-rij en erft de lichte default (geverifieerd:
-- fonds_theming bevat uitsluitend de meridiaan-rij). GEEN RLS-, policy- of
-- schemawijziging; GEEN nieuwe grants. `nav-line-rgb` staat al in
-- THEMABARE_TOKENS (core/lib/fonds-config-core.ts) — de allowlist wijzigt niet.
-- De UPDATE vuurt de bestaande append-only config-audit-trigger (t8b): versie
-- 2 -> 3, één auditregel. Gewenst en reproduceerbaar.
--
-- IDEMPOTENT: alleen bijwerken als `nav-line-rgb` nog niet in de tokens staat,
-- zodat herhaald draaien `versie` niet blijft ophogen.
-- CODE-DEPLOY: niet nodig. Dit is uitsluitend data; de Sidebar-code en de
-- tokenlaag blijven ongewijzigd.
-- ROLLBACK: 2026_07_28_meridiaan_nav_line_ROLLBACK.sql
-- ============================================================================

begin;

update public.fonds_theming ft
   set tokens = ft.tokens || jsonb_build_object(
                  'nav-line-rgb', '56 88 72'
                ),
       versie = ft.versie + 1,
       bijgewerkt = now()
  from public.fondsen f
 where f.id = ft.fonds_id
   and f.slug = 'meridiaan'
   and not (ft.tokens ? 'nav-line-rgb');

commit;
