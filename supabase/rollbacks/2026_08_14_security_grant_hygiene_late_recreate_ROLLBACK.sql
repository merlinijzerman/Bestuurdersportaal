-- Rollback voor 2026_08_14_security_grant_hygiene_late_recreate.sql.
-- Herstelt alleen de ACL-toestand van direct vóór deze migratie.

begin;

revoke all on function public.fn_chunk_denorm(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.fn_chunk_denorm(uuid)
  to public, anon, authenticated, service_role;

revoke all on function public.fn_document_agendapunt_validatie()
  from public, anon, authenticated, service_role;
grant execute on function public.fn_document_agendapunt_validatie()
  to public, anon, authenticated, service_role;

commit;
