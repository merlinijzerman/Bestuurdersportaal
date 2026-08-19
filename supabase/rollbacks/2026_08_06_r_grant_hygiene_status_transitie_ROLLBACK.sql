-- ============================================================================
-- ROLLBACK van 2026_08_06_r_grant_hygiene_status_transitie.sql
-- Herstelt de Supabase-default-ACL (EXECUTE terug aan anon). LET OP: hierna
-- faalt gate H opnieuw op fn_document_status_transitie — alleen draaien als je
-- de grant-hygiëne bewust wilt terugdraaien.
-- ============================================================================

begin;

grant execute on function public.fn_document_status_transitie(text, text) to anon, authenticated, service_role;

commit;
