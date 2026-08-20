-- ============================================================================
-- ROLLBACK voor 2026_06_23_platform_fundament.sql (Increment P0).
-- ----------------------------------------------------------------------------
-- ⚠️ ALLEEN voor PRE-PRODUCTIE of een mislukte migratie VÓÓR livegebruik
-- (TO §11). NA productie-livegang worden audit-/append-only governancegegevens
-- (platform_event_log, platform_identity_capabilities-historie) NIET destructief
-- verwijderd; correcties verlopen dan via nieuwe records / deactiveren / een
-- opvolgmigratie. Een ROLLBACK mag geen auditspoor wissen tenzij dit expliciet
-- onderdeel is van een gecontroleerde pre-live rollback.
--
-- Verwijdert de P0-tabellen, triggers, functies en index. Volgorde respecteert
-- FK-afhankelijkheden (identity_capabilities → capabilities/identities).
-- ============================================================================

-- 1. Triggers + functies van het event-log.
drop trigger if exists trg_platform_event_hash      on public.platform_event_log;
drop trigger if exists trg_platform_event_no_update on public.platform_event_log;
drop trigger if exists trg_platform_event_no_delete on public.platform_event_log;
drop function if exists public.fn_platform_event_hash();
drop function if exists public.fn_platform_event_immutable();

-- 2. Tabellen (cascade ruimt index/policies/constraints mee op).
drop table if exists public.platform_event_log              cascade;
drop table if exists public.platform_identity_capabilities  cascade;
drop table if exists public.platform_capabilities           cascade;
drop table if exists public.platform_identities             cascade;

-- pgcrypto blijft staan: gedeeld met bestaande migraties (fn_doc_meta_log_hash).
