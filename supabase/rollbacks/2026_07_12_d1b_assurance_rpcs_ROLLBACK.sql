-- ============================================================================
-- ROLLBACK van 2026_07_12_d1b_assurance_rpcs.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de drie D1b-RPC's en de storage-policy. Veilig zodra de D1b-code
-- is teruggedraaid (de assurance-routes werken weer via de service-role zolang
-- SUPABASE_SERVICE_ROLE_KEY in de env staat). Draai ná de code-revert.
-- ============================================================================
begin;

drop policy if exists "aqlab-audit fonds-download vrijgegeven" on storage.objects;

drop function if exists public.aqlab_assurance_meetwaarden(text[]);
drop function if exists public.aqlab_audit_export_bron(uuid);
drop function if exists public.aqlab_log_download(uuid);

commit;
