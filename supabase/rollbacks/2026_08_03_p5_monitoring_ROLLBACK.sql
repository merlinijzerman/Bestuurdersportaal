-- ============================================================================
--  ROLLBACK 2026-08-03 — P5/P4-light: monitoringbasis beheer-surface
--
--  Verwijdert de drie nieuwe tabellen en de RPC. Er is GEEN bestaande tabel,
--  policy, trigger of grant gewijzigd door de voorwaartse migratie, dus deze
--  rollback raakt het tenant-datamodel en het auditspoor niet.
--
--  LET OP — dit is DESTRUCTIEF voor monitoringhistorie:
--   * app_errors                 → alle gelogde foutregels weg;
--   * platform_signal_snapshots  → de volledige tijdreeks weg;
--   * platform_signaal_config    → handmatig bijgestelde drempels weg.
--  Geen van drieën is een auditspoor (zie besluit 0104), dus er gaat geen
--  bewijsmateriaal verloren, maar de trendlijn begint na een herinstallatie
--  wél weer bij nul. Overweeg eerst een select-into-backup als de historie
--  nog waarde heeft.
--
--  VOLGORDE: rol EERST de code terug (of laat de code-deploy niet vooruitlopen).
--  Draait de code nog terwijl de tabellen weg zijn, dan faalt elke poging tot
--  wegschrijven — dat is afgevangen (nooit blokkerend, val terug op
--  console.error), maar het levert wel een stroom warnings op.
--
--  Vergeet niet ook `platform_signaal_config` weer uit de globaal-array van
--  supabase/checks/2026_07_31_r1_structurele_gates.sql te halen; een registratie
--  voor een niet-bestaande tabel is geen fout, maar wel misleidend.
-- ============================================================================

begin;

drop function if exists public.fn_app_error_log(
  text, text, text, integer, text, text, text, text[], uuid
);

drop table if exists public.platform_signal_snapshots;
drop table if exists public.platform_signaal_config;
drop table if exists public.app_errors;

commit;

-- ── Verificatie ─────────────────────────────────────────────────────────────
--   select tablename from pg_tables
--    where schemaname='public'
--      and tablename in ('app_errors','platform_signal_snapshots','platform_signaal_config');
--   → nul rijen.
--
--   select proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
--    where ns.nspname='public' and p.proname='fn_app_error_log';
--   → nul rijen.
