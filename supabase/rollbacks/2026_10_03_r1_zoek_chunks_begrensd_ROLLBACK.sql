-- ============================================================================
-- R1 (besluit 0218) — terugdraaien van 2026_10_03_r1_zoek_chunks_begrensd.sql.
-- ----------------------------------------------------------------------------
-- Verwijdert `public.zoek_chunks_begrensd` (de enige wijziging van die
-- migratie). `zoek_chunks` en `zoek_chunks_hybride` worden niet geraakt; de
-- policies evenmin. Data: geen. Grants: alleen die van de verwijderde functie.
--
-- Applicatiegedrag ná rollback: met de vlag ZOEK_TEKST_V2 uit roept de app de
-- functie nooit aan. Staat de vlag aan, dan antwoordt PostgREST met PGRST202
-- (onbekende functie) en valt de app éénmaal per retrieval terug op
-- `zoek_chunks`, met een warn-logregel en de auditmarker
-- `tekstzoekpad: "fallback_pgrst202"` (telt rood in de r1-releasecheck).
-- Zet de vlag dus uit vóór of direct na deze rollback.
--
-- Fail-closed: binnen dezelfde transactie wordt gecontroleerd dat de functie
-- weg is en dat `zoek_chunks` nog precies één overload heeft met EXECUTE voor
-- authenticated en service_role. Idempotent.
-- ============================================================================

begin;

drop function if exists public.zoek_chunks_begrensd(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid);

do $$
begin
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'zoek_chunks_begrensd') then
    raise exception 'R1 ROLLBACK FAALT: er bestaat nog een overload van public.zoek_chunks_begrensd.';
  end if;
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'zoek_chunks') <> 1 then
    raise exception 'R1 ROLLBACK FAALT: public.zoek_chunks heeft niet precies één overload.';
  end if;
  if not has_function_privilege('authenticated',
       'public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid)', 'execute')
     or not has_function_privilege('service_role',
       'public.zoek_chunks(text, int, uuid[], text[], text[], uuid[], text, date, text[], uuid)', 'execute') then
    raise exception 'R1 ROLLBACK FAALT: zoek_chunks mist EXECUTE voor authenticated/service_role.';
  end if;
  raise notice 'R1 rollback: zoek_chunks_begrensd verwijderd; zoek_chunks ongewijzigd.';
end $$;

commit;
