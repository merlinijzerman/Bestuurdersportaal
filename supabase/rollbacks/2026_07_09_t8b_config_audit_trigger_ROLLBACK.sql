-- ============================================================================
-- ROLLBACK voor 2026_07_09_t8b_config_audit_trigger.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de vier audit-triggers, de capture-functie en de UNIQUE-constraint.
-- LET OP: na deze rollback logt de DB config-wijzigingen NIET meer automatisch.
-- Draai dit alleen samen met een teruggezette app-laag die zélf schrijfLog doet
-- (anders ontstaan er ongeaudite config-wijzigingen). Reeds geschreven logregels
-- blijven staan (append-only).
-- ============================================================================

begin;

drop trigger if exists trg_fonds_theming_audit   on public.fonds_theming;
drop trigger if exists trg_fonds_manifest_audit  on public.fonds_module_manifest;
drop trigger if exists trg_fonds_flags_audit     on public.fonds_feature_flags;
drop trigger if exists trg_fonds_overrides_audit on public.fonds_content_overrides;

drop function if exists public.fn_fonds_config_capture();

alter table public.fonds_config_log
  drop constraint if exists fonds_config_log_versie_uniek;

commit;
