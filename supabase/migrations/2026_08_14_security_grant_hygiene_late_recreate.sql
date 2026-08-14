-- ============================================================================
-- Migratie 2026-08-14 — grant-hygiëne na laat aangemaakte functies
-- ----------------------------------------------------------------------------
-- Een schone replay liet zien dat twee functies ná de algemene grant-hygiëne-
-- migratie worden (her)aangemaakt. PostgreSQL geeft nieuwe functies standaard
-- EXECUTE aan PUBLIC, waardoor ook anon ze kon uitvoeren. Herhaal de gewenste
-- eindtoestand daarom als laatste securitymigratie.
--
-- Idempotent en transactioneel.
-- ROLLBACK: 2026_08_14_security_grant_hygiene_late_recreate_ROLLBACK.sql
-- ============================================================================

begin;

-- Rechtstreeks aanroepbare denormalisatie-helper. De applicatie en worker
-- gebruiken deze als authenticated respectievelijk service_role.
revoke all on function public.fn_chunk_denorm(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.fn_chunk_denorm(uuid)
  to authenticated, service_role;

-- Triggerfunctie: de trigger vuurt onafhankelijk van een EXECUTE-grant voor de
-- schrijvende gebruiker. Rechtstreekse uitvoering is alleen voor service_role.
revoke all on function public.fn_document_agendapunt_validatie()
  from public, anon, authenticated, service_role;
grant execute on function public.fn_document_agendapunt_validatie()
  to service_role;

commit;

-- Verificatie: beide queries moeten false opleveren.
-- select has_function_privilege('anon',
--   'public.fn_chunk_denorm(uuid)', 'execute');
-- select has_function_privilege('anon',
--   'public.fn_document_agendapunt_validatie()', 'execute');
