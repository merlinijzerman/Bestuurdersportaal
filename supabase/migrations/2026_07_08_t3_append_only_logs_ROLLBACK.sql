-- ============================================================================
-- ROLLBACK 2026-07-08 — T3 append-only DB-borging op audit-logtabellen
-- ----------------------------------------------------------------------------
-- Verwijdert de before update/delete-triggers op governance_log, risico_log,
-- procedure_log en agendapunt_log en de gedeelde immutability-functie.
--
-- LET OP: hierna is de append-only belofte voor deze vier tabellen weer alleen
-- code-conventie, niet DB-afgedwongen (schijnzekerheid, v0.4 §14). Alleen
-- gebruiken bij een aantoonbare regressie.
-- ============================================================================

begin;

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
    execute format('drop trigger if exists trg_%1$s_no_delete on public.%1$s', t);
  end loop;
end $$;

drop function if exists public.fn_log_append_only();

commit;
