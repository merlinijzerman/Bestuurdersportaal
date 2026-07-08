-- ============================================================================
-- Migratie 2026-07-08 — T3: append-only DB-borging op audit-logtabellen
-- ----------------------------------------------------------------------------
-- WAAROM: de guardrail "de *_log-tabellen worden nooit ge-UPDATE of -DELETE"
-- (CLAUDE.md) was voor vier tabellen NIET in de database afgedwongen. Ze hadden
-- een `for all`-policy en GEEN before update/delete-trigger — anders dan
-- document_metadata_log, platform_event_log en governance_events, die zo'n
-- trigger wél hebben. Hun append-only karakter steunde dus alleen op de
-- afwezigheid van code-paden, niet op de database (schijnzekerheid; v0.4 §14).
--
-- Betrokken tabellen: governance_log, risico_log, procedure_log, agendapunt_log.
-- GECONTROLEERD (2026-07-08): geen enkele .update()/.delete() op deze tabellen
-- in lib/ of app/ — alle toegang is .from(...).select()/.insert(). Deze migratie
-- verandert dus geen bestaand app-gedrag; ze maakt de bestaande belofte hard.
--
-- Complementair aan 2026_07_08_t3_rls_with_check.sql: die sluit de schrijfkant
-- (welke fonds_id mag je inschrijven), déze borgt de onveranderlijkheid (geen
-- UPDATE/DELETE van bestaande auditregels). Samen = fail-closed audit.
--
-- Idempotent (create or replace + drop trigger if exists). Transactioneel.
-- ROLLBACK: 2026_07_08_t3_append_only_logs_ROLLBACK.sql
-- TENANT-IMPACT: geen. Effect is puur restrictief op UPDATE/DELETE, die nergens
-- in de app voorkomen.
-- ============================================================================

begin;

-- Eén gedeelde immutability-functie; de foutmelding noemt de betrokken tabel
-- via TG_TABLE_NAME, zodat een onbedoelde mutatie herleidbaar is.
create or replace function public.fn_log_append_only()
returns trigger language plpgsql as $f$
begin
  raise exception '% is append-only (geen UPDATE/DELETE toegestaan)', tg_table_name;
end;
$f$;

do $$
declare
  t text;
  logtabellen text[] := array[
    'governance_log',
    'risico_log',
    'procedure_log',
    'agendapunt_log'
  ];
begin
  foreach t in array logtabellen loop
    execute format('drop trigger if exists trg_%1$s_no_update on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_no_update before update on public.%1$s '
      'for each row execute procedure public.fn_log_append_only()', t);
    execute format('drop trigger if exists trg_%1$s_no_delete on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_no_delete before delete on public.%1$s '
      'for each row execute procedure public.fn_log_append_only()', t);
  end loop;
end $$;

commit;

-- ── Verificatie (handmatig draaien ná de migratie) ──────────────────────────
-- 1. Acht triggers aanwezig (2 per tabel):
--      select event_object_table, trigger_name, event_manipulation
--        from information_schema.triggers
--       where trigger_name like 'trg_%_no_update' or trigger_name like 'trg_%_no_delete'
--       order by event_object_table;
--    → verwacht: no_update + no_delete voor elk van de 4 logtabellen.
-- 2. Een UPDATE op een bestaande auditregel moet falen:
--      update public.governance_log set actie = actie where true;  -- → exception
