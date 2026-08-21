-- ============================================================================
-- ROLLBACK van 2026_08_20_c01_view_schrijfrechten.sql
-- ----------------------------------------------------------------------------
-- ⚠️  LEES DIT EERST. Dit script HERSTELT DE KWETSBAARHEID. Het zet de grants
-- terug die het via de definer-view `vw_fondsleden` mogelijk maakten om buiten
-- RLS om de `rol` en het `fonds_id` van een willekeurig profiel te wijzigen —
-- een volledige tenant-hop.
--
-- Er is GEEN applicatiepad dat deze rechten nodig heeft: in `app/`, `core/` en
-- `platform/` staat geen enkele insert/update/upsert/delete op enige `vw_`-view;
-- de vier leespaden zijn alle `.select()`. Breekt er na de migratie tóch iets,
-- dan is de juiste actie dat pad opsporen — het hoort niet te bestaan — en niet
-- dit script draaien.
--
-- Draai dit dus uitsluitend als een productie-incident anders niet te stoppen
-- is, en leg in hetzelfde uur vast: wat brak, welk pad het veroorzaakte, en
-- wanneer de revoke terugkomt.
--
-- De anon-grants worden NIET hersteld: `anon` had SELECT op vw_dossier_status
-- zonder dat enige publieke pagina die view leest, en op vw_fondsleden hoorde
-- anon nooit iets te hebben (migratie 2026_08_02 trok dat al expliciet in).
-- ============================================================================

begin;

grant insert, update, delete on public.vw_fondsleden to authenticated;
grant insert, update, delete on public.vw_dossier_status to authenticated;

commit;
