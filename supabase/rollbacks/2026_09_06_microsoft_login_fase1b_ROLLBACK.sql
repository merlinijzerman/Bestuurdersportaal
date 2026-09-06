-- ============================================================================
--  ROLLBACK van 2026_09_06_microsoft_login_fase1b.sql — Microsoft-login fase 1B (#335, T1)
--
--  WAT DIT TERUGDRAAIT
--    Het private schema login_private (bindingen, transacties, audit, gateway-
--    en hookhelperfuncties), de publieke hook fn_access_token_hook, de publieke
--    configtabel fonds_microsoft_login met haar triggers/functies, en de rechten
--    van login_gateway, login_hook_owner en supabase_auth_admin.
--
--  WAT DIT NADRUKKELIJK NIET RAAKT
--    * auth.identities: bestaande Supabase-identiteiten (provider azure) blijven
--      staan; verwijder ze bewust via unlinkIdentity of de Auth-admin vóór of ná
--      deze rollback. Zonder hook en bindingen is een achtergebleven identiteit
--      niet meer door de hook geblokkeerd — schakel dus EERST de hook uit én zet
--      de Azure-provider uit in het Supabase-project (runbook F1B).
--    * De rollen login_gateway en login_hook_owner: login_gateway gaat op NOLOGIN;
--      beide blijven bestaan. Verwijder ze pas apart nadat is vastgesteld dat geen
--      deployment of secretstore de login nog gebruikt (patroon microsoft_vault).
--
--  VOLGORDE — NIET-ONDERHANDELBAAR
--    1. Fondsflag uit (public.fonds_microsoft_login.actief = false voor elk fonds).
--    2. Custom Access Token Hook UIT in het Supabase-project en Azure-provider uit.
--    3. T2-code (routes/callback) teruggerold, anders faalt die fail-closed op
--       'config_ontbreekt' — correct gedrag, maar het legt Microsoft-login plat.
--    4. PAS DAARNA dit bestand.
--
--  DATAVERLIES — FAIL-CLOSED
--    login_private.audit_log is het koppel-/loginspoor. Dit script WEIGERT zolang
--    het regels bevat. Exporteer eerst en zet dan de grendel bewust om:
--      \copy (select * from login_private.audit_log) to 'login_audit_log.csv' csv header
--    en vervang daarna `v_forceer := false` door `true`.
-- ============================================================================

begin;

do $$
declare v_forceer boolean := false; v_n bigint;
begin
  if to_regclass('login_private.audit_log') is not null then
    execute 'select count(*) from login_private.audit_log' into v_n;
    if v_n > 0 and not v_forceer then
      raise exception 'login_private.audit_log bevat % regels; exporteer eerst en zet v_forceer := true', v_n;
    end if;
  end if;
end $$;

-- De helper is eigendom van login_hook_owner; om haar rechten in te trekken en het
-- schema te droppen heeft postgres (geen superuser) tijdelijk INHERIT-lidmaatschap nodig.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'login_hook_owner') then
    grant login_hook_owner to postgres;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'login_gateway') then
    alter role login_gateway nologin;
    if to_regnamespace('login_private') is not null then
      revoke all privileges on all functions in schema login_private from login_gateway;
      revoke usage on schema login_private from login_gateway;
    end if;
  end if;
  if to_regnamespace('login_private') is not null then
    revoke usage on schema login_private from supabase_auth_admin;
    if exists (select 1 from pg_roles where rolname = 'login_hook_owner') then
      revoke all privileges on all tables in schema login_private from login_hook_owner;
      revoke usage on schema login_private from login_hook_owner;
    end if;
  end if;
end $$;

drop function if exists public.fn_access_token_hook(jsonb);
drop trigger if exists trg_fonds_microsoft_login_audit on public.fonds_microsoft_login;
drop function if exists public.fn_fonds_microsoft_login_audit();
drop trigger if exists trg_fonds_microsoft_login_standaard on public.fondsen;
drop function if exists public.fn_fonds_microsoft_login_standaard();
drop table if exists public.fonds_microsoft_login;

drop schema if exists login_private cascade;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'login_hook_owner') then
    revoke login_hook_owner from postgres;
  end if;
end $$;

commit;

-- USAGE op schema public voor supabase_auth_admin wordt bewust NIET ingetrokken:
-- andere Auth-hooks kunnen erop steunen. Trek het apart in als vaststaat dat er
-- geen andere Postgres-hook is geconfigureerd.
