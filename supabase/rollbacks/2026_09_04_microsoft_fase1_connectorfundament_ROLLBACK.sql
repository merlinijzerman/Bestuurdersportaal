-- ROLLBACK van 2026_09_04_microsoft_fase1_connectorfundament.sql
--
-- LET OP: dit vernietigt alle lokale Microsoft-koppelingen, token-caches,
-- OAuth-transacties en connectoraudit uit fase 1. Draai dit alleen bewust en
-- nadat de Preview-pilotflag is uitgezet. Microsoft-consent wordt hiermee niet
-- upstream ingetrokken.

begin;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'microsoft_vault') then
    alter role microsoft_vault nologin;
    revoke all privileges on all functions in schema microsoft_private from microsoft_vault;
    revoke usage on schema microsoft_private from microsoft_vault;
  end if;
end $$;

drop schema if exists microsoft_private cascade;
drop trigger if exists trg_fonds_integratieprofiel_standaard on public.fondsen;
drop function if exists public.fn_fonds_integratieprofiel_standaard();
drop table if exists public.fonds_integratie_profielen;

commit;

-- De loginrol blijft uitgeschakeld bestaan. Verwijder haar pas afzonderlijk
-- nadat is vastgesteld dat geen deployment of secretstore de login nog gebruikt.
