-- ============================================================================
-- ROLLBACK van 2026_07_12_d1_service_role_rpcs.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de drie D1-RPC's. Veilig zodra de D1-code-switch is teruggedraaid
-- (de oude service-role-paden werken weer zolang SUPABASE_SERVICE_ROLE_KEY in de
-- gedeelde env staat). Draai deze rollback dus NA de code-revert, niet ervoor.
-- ============================================================================
begin;

drop function if exists public.resolve_tenant_host(text);
drop function if exists public.contact_aanvraag_insert(text, text, text, text, text, text, text, text, text, text);
drop function if exists public.contact_notificatie_status(uuid, boolean, text);

commit;
