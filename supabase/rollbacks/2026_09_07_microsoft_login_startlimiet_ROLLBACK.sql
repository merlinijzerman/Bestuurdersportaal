-- ============================================================================
--  ROLLBACK van 2026_09_07_microsoft_login_startlimiet.sql (#335 T2, V9).
--  Verwijdert de tempoteller en haar gatewayfunctie. Geen dataverlies van
--  betekenis: de tabel bevat alleen HMAC-sleutels en tellingen per venster.
--  Volgorde: eerst de T2-code terugrollen (de startroute faalt anders fail-closed
--  op de ontbrekende functie — correct, maar legt de Microsoft-inlogstart plat).
-- ============================================================================
begin;
drop function if exists login_private.tel_startpoging(text, integer, integer);
drop table if exists login_private.start_pogingen;
commit;
