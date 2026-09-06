-- ============================================================================
--  Gedragssuite Microsoft-login fase 1B (#335, T1/PR-A, besluit 0211) — hoort bij
--  supabase/migrations/2026_09_06_microsoft_login_fase1b.sql.
--
--  WAT DEZE SUITE BEWIJST
--    DEEL 1 — STRUCTUUR: minimale loginrol login_gateway (exact 13 executes, nul
--                        tabelrechten), NOLOGIN-eigenaar login_hook_owner (alleen
--                        SELECT + policy op de bindingstabel), privaat schema zonder
--                        browser-/service-toegang, gepinde search_paths, RLS aan,
--                        append-only audit, hook SECURITY INVOKER met search_path '',
--                        helper SECURITY DEFINER onder login_hook_owner, publieke
--                        configtabel standaard uit + triggers.
--    DEEL 2 — GEDRAG:    hook: niet-oauth passeert zonder raadpleging; oauth zonder
--                        identiteit/binding → 403; pending A + identiteit B → 403;
--                        pending B → toegestaan; verlopen pending → 403; active →
--                        toegestaan (ook refresh via amr); tid/oid/sub-mismatch,
--                        ontbrekende claims, twee OAuth-identiteiten, andere provider,
--                        revoking/revoked/failed → 403; helperfout → fail-closed;
--                        toestandsovergangen; fondsmismatch; cross-tenant en dubbele
--                        binding onmogelijk; verlopen reservering vrijgegeven;
--                        transacties eenmalig; audit append-only; rolgrenzen
--                        (login_gateway, authenticated, service_role, login_hook_owner);
--                        configtabel: eigen fonds lezen, niet schrijven, wijziging gelogd;
--                        actuele stand: fondsverplaatsing, flag uit, tenant gewijzigd/afwijkend,
--                        ontbrekende config → 403 (uitgifte én refresh), herstel → toegestaan,
--                        wachtwoord steeds onaangeroerd.
--
--  Zelf-seedend en volledig terugdraaiend: DEEL 2 draait in één transactie die
--  eindigt op `rollback`. Er blijft niets achter.
--
--  Draaien:  psql "$DB" -v ON_ERROR_STOP=1 -f supabase/checks/2026_09_06_microsoft_login_fase1b.sql
--  psql exit 0 + "OK"-notices = groen; elke "FAALT" → raise → non-zero exit.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw, afbraak en catalogusmetadata; per scenario wordt
--      met `set local role` naar login_gateway, login_hook_owner, authenticated
--      of service_role geschakeld (lidmaatschap binnen de transactie verleend en
--      teruggedraaid). De hook zelf wordt als postgres aangeroepen: de
--      Supabase-rol postgres kan supabase_auth_admin niet aannemen (gereserveerd
--      lidmaatschap), en de hook is SECURITY INVOKER — postgres leest dezelfde
--      auth.identities. Dat supabase_auth_admin de hook en de helper mág
--      uitvoeren wordt in DEEL 1 uit de catalogus bewezen; de echte GoTrue-
--      aanroep is in spike T0.5 (SPIKE-335-T0.5.md) gemeten.
-- ----------------------------------------------------------------------------

\echo '== DEEL 1 — STRUCTUUR =='

do $$
declare
  fouten text := '';
  v_n integer;
  v_owner text;
  v_cfg text;
  v_gateway_functies text[] := array[
    'lees_config','reserveer_identiteit','activeer_identiteit','herstel_koppeling','markeer_mislukt',
    'start_intrekking','voltooi_intrekking','zoek_identiteit','levende_binding','markeer_gebruikt',
    'maak_transactie','consumeer_transactie','registreer_gebeurtenis'];
  f text;
begin
  -- Rollen
  if not exists (select 1 from pg_roles where rolname='login_gateway' and rolcanlogin and not rolinherit and not rolsuper
                   and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls and rolconnlimit between 1 and 5) then
    fouten := fouten || E'\n- login_gateway is niet de vereiste minimale loginrol';
  end if;
  if not exists (select 1 from pg_roles where rolname='login_hook_owner' and not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreaterole) then
    fouten := fouten || E'\n- login_hook_owner is niet de vereiste NOLOGIN-rol zonder bypassrls';
  end if;
  -- CREATE ROLE door postgres (CREATEROLE, PG16) laat een permanent, impliciet
  -- ADMIN-lidmaatschap zonder INHERIT/SET achter; dat is onschadelijk. Het
  -- tijdelijke migratielidmaatschap (met INHERIT/SET) moet wél weg zijn.
  if exists (select 1 from pg_auth_members am join pg_roles r on r.oid = am.roleid join pg_roles m on m.oid = am.member
              where r.rolname = 'login_hook_owner' and m.rolname = 'postgres' and (am.inherit_option or am.set_option)) then
    fouten := fouten || E'\n- postgres heeft nog een INHERIT/SET-lidmaatschap van login_hook_owner (tijdelijk migratielidmaatschap niet ingetrokken)';
  end if;

  -- Schema
  if to_regnamespace('login_private') is null then fouten := fouten || E'\n- schema login_private ontbreekt'; end if;
  if has_schema_privilege('anon','login_private','USAGE') or has_schema_privilege('authenticated','login_private','USAGE')
     or has_schema_privilege('service_role','login_private','USAGE') then
    fouten := fouten || E'\n- browser- of service-rol heeft USAGE op login_private';
  end if;
  if not has_schema_privilege('login_gateway','login_private','USAGE') then fouten := fouten || E'\n- login_gateway mist USAGE op login_private'; end if;
  if not has_schema_privilege('login_hook_owner','login_private','USAGE') then fouten := fouten || E'\n- login_hook_owner mist USAGE op login_private'; end if;
  if not has_schema_privilege('supabase_auth_admin','login_private','USAGE') then fouten := fouten || E'\n- supabase_auth_admin mist USAGE op login_private (hook kan helper niet aanroepen)'; end if;
  if not has_schema_privilege('login_hook_owner','public','USAGE') or has_schema_privilege('login_hook_owner','public','CREATE') then fouten := fouten || E'\n- login_hook_owner moet USAGE (en geen CREATE) op public hebben'; end if;
  if has_schema_privilege('login_hook_owner','login_private','CREATE') then fouten := fouten || E'\n- login_hook_owner heeft nog CREATE op login_private'; end if;
  if not has_schema_privilege('supabase_auth_admin','public','USAGE') then fouten := fouten || E'\n- supabase_auth_admin mist USAGE op public (vereist voor Postgres Auth-hook)'; end if;

  -- Tabellen: RLS aan, geen directe rechten behalve login_hook_owner SELECT op bindingen
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='login_private' and c.relkind='r' and c.relname in ('microsoft_identiteiten','oauth_transacties','audit_log') and c.relrowsecurity;
  if v_n <> 3 then fouten := fouten || format(E'\n- verwacht 3 private tabellen met RLS, gevonden %s', v_n); end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='login_private' and c.relkind in ('r','p','v','m','S','f')
       and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_table_privilege('login_gateway',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_table_privilege('supabase_auth_admin',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  ) then fouten := fouten || E'\n- een rol heeft directe tabelrechten in login_private'; end if;
  if not has_table_privilege('login_hook_owner','login_private.microsoft_identiteiten','SELECT')
     or has_table_privilege('login_hook_owner','login_private.microsoft_identiteiten','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_table_privilege('login_hook_owner','login_private.oauth_transacties','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('login_hook_owner','login_private.audit_log','SELECT,INSERT,UPDATE,DELETE') then
    fouten := fouten || E'\n- login_hook_owner heeft meer of minder dan SELECT op microsoft_identiteiten';
  end if;
  if not exists (select 1 from pg_policies where schemaname='login_private' and tablename='microsoft_identiteiten'
                   and policyname='hook owner leest bindingen' and cmd='SELECT' and 'login_hook_owner' = any(roles)) then
    fouten := fouten || E'\n- RLS-selectpolicy voor login_hook_owner ontbreekt';
  end if;
  -- Actuele-standtoets: alleen kolom-SELECT op (id, fonds_id) van profielen en
  -- (fonds_id, actief, entra_tenant_id) van fonds_microsoft_login, met tenantgebonden policies.
  if not has_column_privilege('login_hook_owner','public.profielen','id','SELECT')
     or not has_column_privilege('login_hook_owner','public.profielen','fonds_id','SELECT')
     or has_column_privilege('login_hook_owner','public.profielen','naam','SELECT')
     or has_column_privilege('login_hook_owner','public.profielen','rol','SELECT')
     or has_table_privilege('login_hook_owner','public.profielen','INSERT,UPDATE,DELETE') then
    fouten := fouten || E'\n- login_hook_owner heeft meer of minder dan kolom-SELECT (id, fonds_id) op profielen';
  end if;
  if not has_column_privilege('login_hook_owner','public.fonds_microsoft_login','fonds_id','SELECT')
     or not has_column_privilege('login_hook_owner','public.fonds_microsoft_login','actief','SELECT')
     or not has_column_privilege('login_hook_owner','public.fonds_microsoft_login','entra_tenant_id','SELECT')
     or has_column_privilege('login_hook_owner','public.fonds_microsoft_login','pilotstatus','SELECT')
     or has_table_privilege('login_hook_owner','public.fonds_microsoft_login','INSERT,UPDATE,DELETE') then
    fouten := fouten || E'\n- login_hook_owner heeft meer of minder dan kolom-SELECT (fonds_id, actief, entra_tenant_id) op fonds_microsoft_login';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profielen' and policyname='hook owner leest profiel fonds'
                   and cmd='SELECT' and 'login_hook_owner' = any(roles) and qual ~ 'fonds_id') then
    fouten := fouten || E'\n- tenantgebonden leespolicy voor login_hook_owner op profielen ontbreekt';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='fonds_microsoft_login' and policyname='hook owner leest loginconfig'
                   and cmd='SELECT' and 'login_hook_owner' = any(roles) and qual ~ 'fonds_id') then
    fouten := fouten || E'\n- tenantgebonden leespolicy voor login_hook_owner op fonds_microsoft_login ontbreekt';
  end if;
  if exists (select 1 from pg_policies where 'login_hook_owner' = any(roles) and not (schemaname||'.'||tablename in ('login_private.microsoft_identiteiten','public.profielen','public.fonds_microsoft_login') and cmd='SELECT')) then
    fouten := fouten || E'\n- login_hook_owner heeft een policy buiten de drie toegestane leespolicies';
  end if;
  select count(*) into v_n from pg_policies where schemaname='login_private';
  if v_n <> 1 then fouten := fouten || format(E'\n- verwacht exact 1 policy in login_private, gevonden %s', v_n); end if;

  -- Unieke levende slots
  if not exists (select 1 from pg_indexes where schemaname='login_private' and indexname='microsoft_identiteiten_levend_per_identiteit'
                   and indexdef ilike '%unique%' and indexdef ilike '%(tid, oid)%' and indexdef ilike '%status%') then
    fouten := fouten || E'\n- unieke levende index per identiteit ontbreekt of is onvolledig';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='login_private' and indexname='microsoft_identiteiten_levend_per_account'
                   and indexdef ilike '%unique%' and indexdef ilike '%(user_id)%' and indexdef ilike '%status%') then
    fouten := fouten || E'\n- unieke levende index per account ontbreekt of is onvolledig';
  end if;

  -- Append-only triggers
  select count(*) into v_n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='login_private' and c.relname='audit_log' and not t.tgisinternal and t.tgname in ('trg_login_audit_no_update','trg_login_audit_no_delete');
  if v_n <> 2 then fouten := fouten || E'\n- append-only triggers op login_private.audit_log ontbreken'; end if;

  -- Gatewayfuncties: secdef, gepinde path, eigenaar postgres, execute alleen login_gateway
  foreach f in array v_gateway_functies loop
    select coalesce(array_to_string(p.proconfig, ','), ''), r.rolname into v_cfg, v_owner
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
     where n.nspname='login_private' and p.proname=f and p.prosecdef limit 1;
    if v_owner is null then fouten := fouten || format(E'\n- gatewayfunctie %s ontbreekt of is geen SECURITY DEFINER', f); continue; end if;
    if v_cfg !~ 'search_path=login_private, public, pg_temp$' then fouten := fouten || format(E'\n- %s mist gepinde search_path met pg_temp als laatste', f); end if;
    if v_owner <> 'postgres' then fouten := fouten || format(E'\n- %s heeft eigenaar %s, verwacht postgres', f, v_owner); end if;
  end loop;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='login_private' and has_function_privilege('login_gateway',p.oid,'EXECUTE');
  if v_n <> 13 then fouten := fouten || format(E'\n- login_gateway mag exact 13 functies uitvoeren, gevonden %s', v_n); end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='login_private'
               and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
                    or has_function_privilege('service_role',p.oid,'EXECUTE'))) then
    fouten := fouten || E'\n- browser- of service-rol kan een private functie uitvoeren';
  end if;
  if has_function_privilege('login_gateway','login_private.identiteit_toegestaan(uuid,text,text,text)','EXECUTE')
     or has_function_privilege('login_gateway','login_private.verval_verlopen_reserveringen()','EXECUTE') then
    fouten := fouten || E'\n- login_gateway mag de helper of de interne vervalfunctie niet uitvoeren';
  end if;

  -- Helper: definer, eigenaar login_hook_owner, search_path leeg, execute alleen supabase_auth_admin
  select coalesce(array_to_string(p.proconfig, ','), ''), r.rolname into v_cfg, v_owner
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
   where n.nspname='login_private' and p.proname='identiteit_toegestaan' and p.prosecdef;
  if v_owner is distinct from 'login_hook_owner' then fouten := fouten || format(E'\n- identiteit_toegestaan is geen SECURITY DEFINER van login_hook_owner (eigenaar %s)', coalesce(v_owner,'-')); end if;
  if v_cfg <> 'search_path=""' then fouten := fouten || format(E'\n- identiteit_toegestaan heeft geen lege search_path (%s)', v_cfg); end if;
  if not has_function_privilege('supabase_auth_admin','login_private.identiteit_toegestaan(uuid,text,text,text)','EXECUTE') then
    fouten := fouten || E'\n- supabase_auth_admin mag de helper niet uitvoeren';
  end if;
  if has_function_privilege('anon','login_private.identiteit_toegestaan(uuid,text,text,text)','EXECUTE')
     or has_function_privilege('authenticated','login_private.identiteit_toegestaan(uuid,text,text,text)','EXECUTE')
     or has_function_privilege('service_role','login_private.identiteit_toegestaan(uuid,text,text,text)','EXECUTE') then
    fouten := fouten || E'\n- de helper is voor een browser- of service-rol uitvoerbaar';
  end if;

  -- Hook: SECURITY INVOKER, search_path leeg, execute alleen supabase_auth_admin
  select p.prosecdef::text, coalesce(array_to_string(p.proconfig, ','), '') into v_owner, v_cfg
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='fn_access_token_hook';
  if v_owner is null then fouten := fouten || E'\n- public.fn_access_token_hook ontbreekt';
  else
    if v_owner = 'true' then fouten := fouten || E'\n- fn_access_token_hook is SECURITY DEFINER (moet INVOKER zijn)'; end if;
    if v_cfg <> 'search_path=""' then fouten := fouten || format(E'\n- fn_access_token_hook heeft geen lege search_path (%s)', v_cfg); end if;
    if not has_function_privilege('supabase_auth_admin','public.fn_access_token_hook(jsonb)','EXECUTE') then fouten := fouten || E'\n- supabase_auth_admin mag de hook niet uitvoeren'; end if;
    if has_function_privilege('anon','public.fn_access_token_hook(jsonb)','EXECUTE') or has_function_privilege('authenticated','public.fn_access_token_hook(jsonb)','EXECUTE')
       or has_function_privilege('service_role','public.fn_access_token_hook(jsonb)','EXECUTE') then
      fouten := fouten || E'\n- de hook is voor een browser- of service-rol uitvoerbaar';
    end if;
  end if;

  -- Publieke configtabel
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='fonds_microsoft_login' and c.relrowsecurity) then
    fouten := fouten || E'\n- fonds_microsoft_login ontbreekt of RLS staat uit';
  end if;
  if has_table_privilege('anon','public.fonds_microsoft_login','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.fonds_microsoft_login','INSERT,UPDATE,DELETE')
     or not has_table_privilege('authenticated','public.fonds_microsoft_login','SELECT') then
    fouten := fouten || E'\n- fonds_microsoft_login-grants wijken af van authenticated read-only';
  end if;
  select count(*) into v_n from pg_policies where schemaname='public' and tablename='fonds_microsoft_login';
  if v_n <> 2 or exists (select 1 from pg_policies where schemaname='public' and tablename='fonds_microsoft_login' and cmd <> 'SELECT')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='fonds_microsoft_login' and 'authenticated' = any(roles) and qual ~ 'auth\.uid\(\)') then
    fouten := fouten || E'\n- fonds_microsoft_login: verwacht exact twee leespolicies (authenticated eigen fonds, login_hook_owner) en geen schrijfpolicy';
  end if;
  if exists (select 1 from public.fondsen f left join public.fonds_microsoft_login c on c.fonds_id=f.id where c.fonds_id is null) then
    fouten := fouten || E'\n- niet ieder fonds heeft een Microsoft-loginconfiguratie';
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_fonds_microsoft_login_standaard' and not tgisinternal) then fouten := fouten || E'\n- standaard-uit-trigger voor nieuwe fondsen ontbreekt'; end if;
  if not exists (select 1 from pg_trigger where tgname='trg_fonds_microsoft_login_audit' and not tgisinternal) then fouten := fouten || E'\n- config-audittrigger ontbreekt'; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='fn_fonds_microsoft_login_audit'
               and (not p.prosecdef or coalesce(array_to_string(p.proconfig, ','), '') !~ 'search_path=login_private, public, pg_temp$'
                    or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE'))) then
    fouten := fouten || E'\n- fn_fonds_microsoft_login_audit: geen definer, geen gepinde path of te ruime execute';
  end if;
  if has_function_privilege('anon','public.fn_fonds_microsoft_login_standaard()','EXECUTE') or has_function_privilege('authenticated','public.fn_fonds_microsoft_login_standaard()','EXECUTE') then
    fouten := fouten || E'\n- fn_fonds_microsoft_login_standaard is voor een browserrol uitvoerbaar';
  end if;

  if fouten <> '' then raise exception 'Microsoft-login fase 1B structuur FAALT:%', fouten; end if;
  raise notice 'OK DEEL 1: private schema, 13 gatewayfuncties, helper onder login_hook_owner, INVOKER-hook, configtabel standaard uit.';
end $$;

\echo '== DEEL 2 — GEDRAG (transactie, eindigt op rollback) =='

begin;

-- Lidmaatschappen voor rolwissels; worden met de rollback ongedaan gemaakt.
grant login_gateway to postgres;
grant login_hook_owner to postgres;

do $$
declare
  v_fonds_a uuid := '73350000-0000-4000-8000-00000000000a';
  v_fonds_b uuid := '73350000-0000-4000-8000-00000000000b';
  v_ua uuid := '73350000-0000-4000-8000-0000000000a1';
  v_ub uuid := '73350000-0000-4000-8000-0000000000b1';
  v_uc uuid := '73350000-0000-4000-8000-0000000000c1';
  v_tid text := 'aaaaaaaa-1111-4111-8111-111111111111';
  v_oid_a text := 'bbbbbbbb-2222-4222-8222-22222222222a';
  v_oid_b text := 'bbbbbbbb-2222-4222-8222-22222222222b';
  v_sub_a text := 'sub-A-' || repeat('x', 20);
  v_sub_b text := 'sub-B-' || repeat('y', 20);
  v_id uuid; v_id2 uuid; v_n integer; v_res jsonb; v_hash text;
  v_gebeurt text;
  -- helpers
  ev_oauth jsonb; ev_refresh jsonb; ev_pw jsonb;
begin
  -- ── Seed ────────────────────────────────────────────────────────────────
  insert into public.fondsen (id, naam, slug) values (v_fonds_a, 'Login 1B fonds A', 'login1b-a'), (v_fonds_b, 'Login 1B fonds B', 'login1b-b');
  -- trigger: configrij standaard uit
  select count(*) into v_n from public.fonds_microsoft_login where fonds_id in (v_fonds_a, v_fonds_b) and actief = false and pilotstatus = 'uit';
  assert v_n = 2, 'nieuwe fondsen krijgen Microsoft-login standaard uit';
  -- Voor de gedragsscenario's: beide fondsen actief op dezelfde tenant (gecontroleerde SQL, patroon runbook).
  update public.fonds_microsoft_login set actief = true, entra_tenant_id = v_tid, pilotstatus = 'pilot' where fonds_id in (v_fonds_a, v_fonds_b);
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data) values
    (v_ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'login1b-a@example.test', jsonb_build_object('fonds_id', v_fonds_a::text)),
    (v_ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'login1b-b@example.test', jsonb_build_object('fonds_id', v_fonds_b::text)),
    (v_uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'login1b-c@example.test', jsonb_build_object('fonds_id', v_fonds_a::text));
  assert (select count(*) from public.profielen where id in (v_ua, v_ub, v_uc)) = 3, 'seed: drie profielen';

  ev_pw := jsonb_build_object('user_id', v_ua, 'authentication_method', 'password',
             'claims', jsonb_build_object('sub', v_ua, 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method','password','timestamp',0))));
  ev_oauth := jsonb_build_object('user_id', v_ua, 'authentication_method', 'oauth',
             'claims', jsonb_build_object('sub', v_ua, 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method','oauth','timestamp',0))));
  -- refresh: authentication_method leeg/anders, amr draagt oauth
  ev_refresh := jsonb_build_object('user_id', v_ua, 'authentication_method', 'token_refresh',
             'claims', jsonb_build_object('sub', v_ua, 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method','oauth','timestamp',0))));

  -- ── H1 niet-oauth passeert onaangeroerd ─────────────────────────────────
  assert public.fn_access_token_hook(ev_pw) = ev_pw, 'H1: wachtwoordsessie passeert ongewijzigd';
  assert public.fn_access_token_hook(ev_pw - 'user_id') = (ev_pw - 'user_id'), 'H1b: niet-oauth zonder user_id raakt geen database';

  -- ── H2 oauth zonder OAuth-identiteit ────────────────────────────────────
  v_res := public.fn_access_token_hook(ev_oauth);
  assert (v_res->'error'->>'http_code') = '403', 'H2: oauth zonder identiteit → 403';
  assert v_res::text !~* 'example\.test|sub-A|sub-B', 'H2: geen identiteitsgegevens in het foutobject';

  -- ── H3 azure-identiteit zonder binding ──────────────────────────────────
  insert into auth.identities (user_id, provider, provider_id, identity_data)
  values (v_ua, 'azure', v_sub_b, jsonb_build_object('sub', v_sub_b, 'provider_id', v_sub_b, 'custom_claims', jsonb_build_object('tid', v_tid, 'oid', v_oid_b)));
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H3: identiteit zonder binding → 403';

  -- ── H4 pending voor A, identiteit B ─────────────────────────────────────
  set local role login_gateway;
  select r.id into v_id from login_private.reserveer_identiteit(v_fonds_a, v_ua, v_tid, v_oid_a, v_sub_a, 'corr-h4') r; assert v_id is not null, 'reservering verwacht';
  reset role;
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H4: pending voor A staat identiteit B niet toe';
  set local role login_gateway;
  perform login_private.markeer_mislukt(v_id, v_ua, 'test_opruimen');
  reset role;

  -- ── H5 pending voor B → toegestaan; refresh eveneens ────────────────────
  set local role login_gateway;
  select r.id into v_id from login_private.reserveer_identiteit(v_fonds_a, v_ua, v_tid, v_oid_b, v_sub_b, 'corr-h5') r; assert v_id is not null, 'reservering verwacht';
  reset role;
  assert public.fn_access_token_hook(ev_oauth) = ev_oauth, 'H5: geldige pending voor exact deze identiteit → toegestaan';
  assert public.fn_access_token_hook(ev_refresh) = ev_refresh, 'H5b: refresh (amr oauth) met geldige pending → toegestaan';

  -- ── H6 verlopen pending → 403 ───────────────────────────────────────────
  update login_private.microsoft_identiteiten set pending_verloopt_op = now() - interval '1 second' where id = v_id;
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H6: verlopen pending → 403';
  update login_private.microsoft_identiteiten set pending_verloopt_op = now() + interval '10 minutes' where id = v_id;

  -- ── H7 activeren: verkeerde sub → onbekend; juiste → active; hook staat toe ──
  set local role login_gateway;
  begin
    perform login_private.activeer_identiteit(v_id, v_ua, v_sub_a);
    raise exception 'H7: activeren met afwijkende sub had moeten falen';
  exception when no_data_found then null; end;
  begin
    perform login_private.activeer_identiteit(v_id, v_ub, v_sub_b);
    raise exception 'H7: activeren door andere gebruiker had moeten falen';
  exception when no_data_found then null; end;
  assert login_private.activeer_identiteit(v_id, v_ua, v_sub_b), 'H7: activeren';
  assert login_private.activeer_identiteit(v_id, v_ua, v_sub_b), 'H7: activeren is idempotent';
  reset role;
  assert (select status from login_private.microsoft_identiteiten where id = v_id) = 'active', 'H7: status active';
  assert public.fn_access_token_hook(ev_oauth) = ev_oauth, 'H7: active → toegestaan';
  assert public.fn_access_token_hook(ev_refresh) = ev_refresh, 'H7b: refresh bij active → toegestaan';

  -- ── H8 mismatch en ontbrekende claims → 403 ─────────────────────────────
  update auth.identities set identity_data = jsonb_set(identity_data, '{custom_claims,tid}', to_jsonb('cccccccc-3333-4333-8333-333333333333'::text)) where user_id = v_ua and provider = 'azure';
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H8a: tid wijkt af → 403';
  update auth.identities set identity_data = jsonb_set(identity_data, '{custom_claims,tid}', to_jsonb(v_tid)) where user_id = v_ua and provider = 'azure';
  update auth.identities set identity_data = jsonb_set(identity_data, '{custom_claims,oid}', to_jsonb(v_oid_a)) where user_id = v_ua and provider = 'azure';
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H8b: oid wijkt af → 403';
  update auth.identities set identity_data = (identity_data #- '{custom_claims,oid}') where user_id = v_ua and provider = 'azure';
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H8c: oid ontbreekt → 403';
  update auth.identities set identity_data = jsonb_set(identity_data, '{custom_claims,oid}', to_jsonb(v_oid_b)) where user_id = v_ua and provider = 'azure';
  update auth.identities set identity_data = (identity_data - 'custom_claims') where user_id = v_ua and provider = 'azure';
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H8d: custom_claims ontbreekt → 403';
  update auth.identities set identity_data = identity_data || jsonb_build_object('custom_claims', jsonb_build_object('tid', v_tid, 'oid', v_oid_b)) where user_id = v_ua and provider = 'azure';
  update auth.identities set provider_id = v_sub_a where user_id = v_ua and provider = 'azure';
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H8e: sub (provider_id) wijkt af → 403';
  update auth.identities set provider_id = v_sub_b where user_id = v_ua and provider = 'azure';
  assert public.fn_access_token_hook(ev_oauth) = ev_oauth, 'H8: hersteld → toegestaan';

  -- ── H9 twee OAuth-identiteiten / andere provider → 403 ──────────────────
  insert into auth.identities (user_id, provider, provider_id, identity_data) values (v_ua, 'google', 'google-sub', jsonb_build_object('sub','google-sub'));
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H9a: twee OAuth-identiteiten → 403';
  delete from auth.identities where user_id = v_ua and provider = 'azure';
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H9b: alleen google-identiteit → 403 (ook met actieve azure-binding)';
  delete from auth.identities where user_id = v_ua and provider = 'google';
  -- e-mail-identiteit telt niet mee als OAuth
  insert into auth.identities (user_id, provider, provider_id, identity_data) values (v_ua, 'email', v_ua::text, jsonb_build_object('sub', v_ua::text));
  insert into auth.identities (user_id, provider, provider_id, identity_data)
  values (v_ua, 'azure', v_sub_b, jsonb_build_object('sub', v_sub_b, 'provider_id', v_sub_b, 'custom_claims', jsonb_build_object('tid', v_tid, 'oid', v_oid_b)));
  assert public.fn_access_token_hook(ev_oauth) = ev_oauth, 'H9c: e-mail + azure = één OAuth-identiteit → toegestaan';

  -- ── H10 revoking / revoked / failed → 403; overgangen ───────────────────
  set local role login_gateway;
  begin
    perform login_private.markeer_mislukt(v_id, v_ua, 'x');
    raise exception 'H10: markeer_mislukt op active had moeten falen';
  exception when check_violation then null; end;
  begin
    perform login_private.voltooi_intrekking(v_id, v_ua, 'corr');
    raise exception 'H10: voltooi_intrekking op active had moeten falen';
  exception when check_violation then null; end;
  begin
    perform login_private.start_intrekking(v_fonds_b, v_ua, v_ua, 'corr');
    raise exception 'H10: intrekking onder verkeerd fonds had moeten falen';
  exception when no_data_found then null; end;
  v_id2 := login_private.start_intrekking(v_fonds_a, v_ua, v_ua, 'corr-h10');
  assert v_id2 = v_id, 'H10: start_intrekking geeft de binding terug';
  assert login_private.start_intrekking(v_fonds_a, v_ua, v_ua, 'corr-h10') = v_id, 'H10: start_intrekking is idempotent';
  reset role;
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H10a: revoking → 403';
  assert (public.fn_access_token_hook(ev_refresh)->'error'->>'http_code') = '403', 'H10a: refresh bij revoking → 403';
  set local role login_gateway;
  perform login_private.voltooi_intrekking(v_id, v_ua, 'corr-h10');
  perform login_private.voltooi_intrekking(v_id, v_ua, 'corr-h10');   -- idempotent
  reset role;
  assert (select status from login_private.microsoft_identiteiten where id = v_id) = 'revoked', 'H10: revoked';
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H10b: revoked → 403';
  set local role login_gateway;
  assert (select count(*) from login_private.zoek_identiteit(v_tid, v_oid_b)) = 0, 'H10: zoek_identiteit ziet geen revoked binding';
  assert (select count(*) from login_private.levende_binding(v_ua)) = 0, 'H10: geen levende binding meer';
  -- failed → 403
  select r.id into v_id2 from login_private.reserveer_identiteit(v_fonds_a, v_ua, v_tid, v_oid_b, v_sub_b, 'corr-h10c') r; assert v_id2 is not null, 'reservering verwacht';
  perform login_private.markeer_mislukt(v_id2, v_ua, 'supabase_link');
  reset role;
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H10c: failed → 403';

  -- ── H11 helperfout → fail-closed ────────────────────────────────────────
  set local role login_gateway;
  select r.id into v_id from login_private.reserveer_identiteit(v_fonds_a, v_ua, v_tid, v_oid_b, v_sub_b, 'corr-h11') r; assert v_id is not null, 'reservering verwacht';
  perform login_private.activeer_identiteit(v_id, v_ua, v_sub_b);
  reset role;
  assert public.fn_access_token_hook(ev_oauth) = ev_oauth, 'H11: vooraf toegestaan';
  -- De stub leeft alleen in een subtransactie (inner block + bewuste raise), zodat de
  -- echte helper daarna weer geldt voor de vervolgscenario's.
  begin
    grant create on schema login_private to login_hook_owner;
    set local role login_hook_owner;
    create or replace function login_private.identiteit_toegestaan(p_user uuid, p_sub text, p_tid text, p_oid text)
    returns boolean language plpgsql security definer set search_path = '' as $f$ begin raise exception 'kunstmatige helperfout'; end $f$;
    reset role;
    v_res := public.fn_access_token_hook(ev_oauth);
    raise exception using errcode = 'P0333', message = 'stub_rollback';
  exception when sqlstate 'P0333' then null; end;
  assert (v_res->'error'->>'http_code') = '403', 'H11: helperfout → 403 (fail-closed)';
  assert v_res::text !~ 'kunstmatige', 'H11: interne foutmelding lekt niet';
  assert public.fn_access_token_hook(ev_oauth) = ev_oauth, 'H11b: echte helper hersteld → toegestaan';

  -- ── H12 fondsmismatch bij reserveren ────────────────────────────────────
  set local role login_gateway;
  assert (select r.categorie from login_private.reserveer_identiteit(v_fonds_a, v_ub, v_tid, 'eeeeeeee-5555-4555-8555-555555555555', 'sub-E', 'corr-h12') r) = 'fonds_mismatch',
    'H12: reserveren onder een ander fonds dan het profiel wordt geweigerd';
  -- ── H13 cross-tenant en dubbele binding onmogelijk ──────────────────────
  assert (select r.categorie from login_private.reserveer_identiteit(v_fonds_b, v_ub, v_tid, v_oid_b, 'sub-X', 'corr-h13a') r) = 'binding_conflict',
    'H13a: dezelfde tid+oid voor een ander account/fonds wordt geweigerd';
  assert (select r.categorie from login_private.reserveer_identiteit(v_fonds_a, v_ua, v_tid, 'ffffffff-6666-4666-8666-666666666666', 'sub-F', 'corr-h13b') r) = 'binding_conflict',
    'H13b: tweede levende identiteit voor hetzelfde account wordt geweigerd';
  reset role;
  assert (select count(*) from login_private.audit_log where foutcategorie = 'binding_conflict' and correlatie_id in ('corr-h13a','corr-h13b')) = 2, 'H13: conflicten gelogd';
  assert (select count(*) from login_private.audit_log where foutcategorie = 'fonds_mismatch' and correlatie_id = 'corr-h12') = 1, 'H12: fondsmismatch gelogd';
  assert (select count(*) from login_private.microsoft_identiteiten where user_id = v_ub and status in ('pending','active','revoking')) = 0, 'H13: fonds B kreeg geen binding op de identiteit van A';

  -- ── H14 verlopen reservering wordt vrijgegeven ──────────────────────────
  set local role login_gateway;
  perform login_private.start_intrekking(v_fonds_a, v_ua, v_ua, 'corr-h14');
  perform login_private.voltooi_intrekking(v_id, v_ua, 'corr-h14');
  select r.id into v_id from login_private.reserveer_identiteit(v_fonds_a, v_ua, v_tid, v_oid_b, v_sub_b, 'corr-h14a') r; assert v_id is not null, 'reservering verwacht';
  reset role;
  update login_private.microsoft_identiteiten set pending_verloopt_op = now() - interval '1 second' where id = v_id;
  set local role login_gateway;
  select r.id into v_id2 from login_private.reserveer_identiteit(v_fonds_a, v_uc, v_tid, v_oid_b, v_sub_b, 'corr-h14b') r; assert v_id2 is not null, 'reservering verwacht';
  reset role;
  assert (select status || ':' || foutcategorie from login_private.microsoft_identiteiten where id = v_id) = 'failed:pending_verlopen', 'H14: verlopen pending → failed';
  assert (select status from login_private.microsoft_identiteiten where id = v_id2) = 'pending', 'H14: nieuwe reservering door ander account geslaagd';
  -- herstel: identiteit bestaat (sub gelijk) → activeren ook na verval
  update login_private.microsoft_identiteiten set pending_verloopt_op = now() - interval '1 second' where id = v_id2;
  set local role login_gateway;
  begin
    perform login_private.activeer_identiteit(v_id2, v_uc, v_sub_b);
    raise exception 'H14: gewoon activeren na verval had moeten falen';
  exception when check_violation then null; end;
  assert login_private.herstel_koppeling(v_id2, v_uc, v_sub_b), 'H14: herstel activeert een verlopen pending';
  begin
    perform login_private.herstel_koppeling(v_id2, v_uc, v_sub_a);
    raise exception 'H14: herstel met andere sub had moeten falen';
  exception when no_data_found then null; end;
  reset role;

  -- ── H15 transacties eenmalig ────────────────────────────────────────────
  set local role login_gateway;
  perform login_private.maak_transactie('hash-1', v_fonds_a, null, 'inloggen', now() + interval '10 minutes', 1, 'iv', 'tag', 'cipher', 'aad');
  perform login_private.maak_transactie('hash-2', v_fonds_a, v_ua, 'koppelen', now() - interval '1 second', 1, 'iv', 'tag', 'cipher', 'aad');
  assert (select count(*) from login_private.consumeer_transactie('hash-1')) = 1, 'H15: eerste consumptie levert de transactie';
  assert (select count(*) from login_private.consumeer_transactie('hash-1')) = 0, 'H15: replay levert niets';
  assert (select count(*) from login_private.consumeer_transactie('hash-2')) = 0, 'H15: verlopen transactie levert niets';
  assert (select count(*) from login_private.consumeer_transactie('hash-onbekend')) = 0, 'H15: onbekende state levert niets';
  begin
    perform login_private.maak_transactie('hash-3', v_fonds_a, null, 'koppelen', now() + interval '1 minute', 1, 'iv', 'tag', 'cipher', 'aad');
    raise exception 'H15: koppelen zonder user_id had moeten falen';
  exception when check_violation then null; end;
  reset role;

  -- ── H16 audit append-only ───────────────────────────────────────────────
  begin
    update login_private.audit_log set gebeurtenis = 'x' where correlatie_id = 'corr-h14b';
    raise exception 'H16: update op audit_log had moeten falen';
  exception when insufficient_privilege then null; end;
  begin
    delete from login_private.audit_log where correlatie_id = 'corr-h14b';
    raise exception 'H16: delete op audit_log had moeten falen';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from login_private.audit_log where gebeurtenis in ('koppelen.gereserveerd','koppelen.geactiveerd','ontkoppelen.gestart','ontkoppelen.voltooid','koppelen.mislukt','koppelen.hersteld')) >= 10, 'H16: overgangen gelogd';
  assert not exists (select 1 from login_private.audit_log where foutcategorie ~* 'example\.test' or identiteit_hash ~* 'sub-|bbbbbbbb'), 'H16: audit is inhoudsvrij (hash, geen ruwe identiteit of e-mail)';
  v_hash := encode(extensions.digest(v_tid || ':' || v_oid_b, 'sha256'), 'hex');
  assert exists (select 1 from login_private.audit_log where identiteit_hash = v_hash), 'H16: identiteitshash = sha256(tid:oid)';

  -- ── H17 rolgrenzen ──────────────────────────────────────────────────────
  set local role login_gateway;
  begin
    perform count(*) from login_private.microsoft_identiteiten;
    raise exception 'H17: login_gateway kon de bindingstabel lezen';
  exception when insufficient_privilege then null; end;
  begin
    perform login_private.identiteit_toegestaan(v_ua, v_sub_b, v_tid, v_oid_b);
    raise exception 'H17: login_gateway kon de helper uitvoeren';
  exception when insufficient_privilege then null; end;
  begin
    perform public.fn_access_token_hook(ev_pw);
    raise exception 'H17: login_gateway kon de hook uitvoeren';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from login_private.lees_config(v_fonds_a)) = 1, 'H17: login_gateway leest config';
  reset role;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"73350000-0000-4000-8000-0000000000a1","role":"authenticated"}';
  begin
    perform login_private.lees_config(v_fonds_a);
    raise exception 'H17: authenticated kon een gatewayfunctie uitvoeren';
  exception when insufficient_privilege then null; end;
  begin
    perform public.fn_access_token_hook(ev_pw);
    raise exception 'H17: authenticated kon de hook uitvoeren';
  exception when insufficient_privilege then null; end;
  -- configtabel: eigen fonds lezen, ander fonds niet, niet schrijven
  assert (select count(*) from public.fonds_microsoft_login where fonds_id in (v_fonds_a, v_fonds_b)) = 1, 'H17: authenticated ziet alleen eigen fondsconfig';
  assert (select fonds_id from public.fonds_microsoft_login where fonds_id in (v_fonds_a, v_fonds_b)) = v_fonds_a, 'H17: … en dat is het eigen fonds';
  begin
    update public.fonds_microsoft_login set actief = true, entra_tenant_id = v_tid where fonds_id = v_fonds_a;
    raise exception 'H17: authenticated kon de config bijwerken';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role service_role;
  begin
    perform count(*) from login_private.microsoft_identiteiten;
    raise exception 'H17: service_role kon de bindingstabel lezen';
  exception when insufficient_privilege then null; end;
  begin
    perform login_private.lees_config(v_fonds_a);
    raise exception 'H17: service_role kon een gatewayfunctie uitvoeren';
  exception when insufficient_privilege then null; end;
  reset role;
  -- login_hook_owner: mag via de policy lezen, niet schrijven
  set local role login_hook_owner;
  assert (select count(*) from login_private.microsoft_identiteiten) >= 1, 'H17: login_hook_owner ziet bindingen via de policy';
  begin
    insert into login_private.microsoft_identiteiten (fonds_id, user_id, tid, oid, sub, status, gekoppeld_door, correlatie_id)
    values (v_fonds_a, v_ua, 'x', 'y', 'z', 'active', v_ua, 'c');
    raise exception 'H17: login_hook_owner kon een binding invoegen';
  exception when insufficient_privilege then null; end;
  reset role;

  -- ── H18 config: constraint en audit (fonds B) ─────────────────────────
  update public.fonds_microsoft_login set actief = false, entra_tenant_id = null, pilotstatus = 'uit' where fonds_id = v_fonds_b;
  begin
    update public.fonds_microsoft_login set actief = true where fonds_id = v_fonds_b;
    raise exception 'H18: actief zonder tenant had moeten falen';
  exception when check_violation then null; end;
  update public.fonds_microsoft_login set actief = true, entra_tenant_id = v_tid, pilotstatus = 'pilot' where fonds_id = v_fonds_b;
  select foutcategorie into v_gebeurt from login_private.audit_log where fonds_id = v_fonds_b and gebeurtenis = 'config.gewijzigd' order by aangemaakt desc limit 1;
  assert v_gebeurt = 'actief=true;pilotstatus=pilot;tenant_gezet=true', format('H18: configwijziging gelogd (%s)', v_gebeurt);
  assert not exists (select 1 from login_private.audit_log where foutcategorie ~ v_tid), 'H18: tenant-id zelf niet in de audit';
  set local role login_gateway;
  assert (select actief from login_private.lees_config(v_fonds_b)) = true, 'H18: gateway leest de geactiveerde config';
  reset role;

  -- ── H19–H24 actuele stand: fondsverplaatsing, flag uit, tenant gewijzigd, herstel ──
  -- Uitgangspunt: uC heeft een active binding (v_id2) op tid/oid_b/sub_b; geef uC de identiteit.
  delete from auth.identities where user_id = v_ua and provider = 'azure';
  insert into auth.identities (user_id, provider, provider_id, identity_data)
  values (v_uc, 'azure', v_sub_b, jsonb_build_object('sub', v_sub_b, 'provider_id', v_sub_b, 'custom_claims', jsonb_build_object('tid', v_tid, 'oid', v_oid_b)));
  ev_oauth := jsonb_set(ev_oauth, '{user_id}', to_jsonb(v_uc::text));
  ev_refresh := jsonb_set(ev_refresh, '{user_id}', to_jsonb(v_uc::text));
  ev_pw := jsonb_set(ev_pw, '{user_id}', to_jsonb(v_uc::text));
  assert public.fn_access_token_hook(ev_oauth) = ev_oauth, 'H19: actieve correcte binding → toegestaan';
  assert public.fn_access_token_hook(ev_refresh) = ev_refresh, 'H19: refresh → toegestaan';

  -- H20 profiel na binding naar ander fonds verplaatst → 403 (service_role, bevriezingstrigger laat die vrij)
  set local role service_role;
  update public.profielen set fonds_id = v_fonds_b where id = v_uc;
  reset role;
  assert (select fonds_id from public.profielen where id = v_uc) = v_fonds_b, 'H20: seed — profiel verplaatst';
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H20: profiel naar ander fonds → 403';
  assert (public.fn_access_token_hook(ev_refresh)->'error'->>'http_code') = '403', 'H20: refresh na fondsverplaatsing → 403';
  assert public.fn_access_token_hook(ev_pw) = ev_pw, 'H20: wachtwoordsessie onaangeroerd';
  set local role service_role;
  update public.profielen set fonds_id = v_fonds_a where id = v_uc;
  reset role;
  assert public.fn_access_token_hook(ev_oauth) = ev_oauth, 'H20: profiel terug → toegestaan';

  -- H21 fondsflag uit → initiële uitgifte én refresh 403; binding blijft bestaan; reserveren → login_uit
  update public.fonds_microsoft_login set actief = false where fonds_id = v_fonds_a;
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H21: flag uit → initiële uitgifte 403';
  assert (public.fn_access_token_hook(ev_refresh)->'error'->>'http_code') = '403', 'H21: flag uit → refresh 403';
  assert public.fn_access_token_hook(ev_pw) = ev_pw, 'H21: wachtwoordsessie onaangeroerd';
  assert (select status from login_private.microsoft_identiteiten where id = v_id2) = 'active', 'H21: binding blijft bestaan bij flag uit';
  set local role login_gateway;
  assert (select r.categorie from login_private.reserveer_identiteit(v_fonds_a, v_ua, v_tid, '99999999-9999-4999-8999-999999999999', 'sub-N', 'corr-h21') r) = 'login_uit', 'H21: reserveren bij flag uit → login_uit';
  reset role;
  assert (select count(*) from login_private.audit_log where foutcategorie = 'login_uit' and correlatie_id = 'corr-h21') = 1, 'H21: login_uit gelogd';
  update public.fonds_microsoft_login set actief = true where fonds_id = v_fonds_a;
  assert public.fn_access_token_hook(ev_oauth) = ev_oauth, 'H21: flag weer aan → toegestaan';

  -- H22 geconfigureerde tenant gewijzigd → 403; reserveren → tenant_mismatch
  update public.fonds_microsoft_login set entra_tenant_id = '77777777-7777-4777-8777-777777777777' where fonds_id = v_fonds_a;
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H22: andere geconfigureerde tenant → 403';
  assert (public.fn_access_token_hook(ev_refresh)->'error'->>'http_code') = '403', 'H22: refresh bij andere tenant → 403';
  assert public.fn_access_token_hook(ev_pw) = ev_pw, 'H22: wachtwoordsessie onaangeroerd';
  set local role login_gateway;
  assert (select r.categorie from login_private.reserveer_identiteit(v_fonds_a, v_ua, v_tid, '88888888-8888-4888-8888-888888888888', 'sub-M', 'corr-h22') r) = 'tenant_mismatch', 'H22: reserveren met afwijkende tenant → tenant_mismatch';
  reset role;
  -- binding-tid afwijkend van config (config hersteld, binding gemanipuleerd) → 403
  update public.fonds_microsoft_login set entra_tenant_id = v_tid where fonds_id = v_fonds_a;
  update login_private.microsoft_identiteiten set tid = '66666666-6666-4666-8666-666666666666' where id = v_id2;
  update auth.identities set identity_data = jsonb_set(identity_data, '{custom_claims,tid}', to_jsonb('66666666-6666-4666-8666-666666666666'::text)) where user_id = v_uc and provider = 'azure';
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H22b: binding-tid ≠ geconfigureerde tenant → 403 (ook al matcht de identiteit de binding)';
  update login_private.microsoft_identiteiten set tid = v_tid where id = v_id2;
  update auth.identities set identity_data = jsonb_set(identity_data, '{custom_claims,tid}', to_jsonb(v_tid)) where user_id = v_uc and provider = 'azure';

  -- H23 fondsconfiguratie ontbreekt geheel → 403
  delete from public.fonds_microsoft_login where fonds_id = v_fonds_a;
  assert (public.fn_access_token_hook(ev_oauth)->'error'->>'http_code') = '403', 'H23: ontbrekende fondsconfiguratie → 403';
  insert into public.fonds_microsoft_login (fonds_id, actief, entra_tenant_id, pilotstatus) values (v_fonds_a, true, v_tid, 'pilot');

  -- H24 alles hersteld → toegestaan; wachtwoord ongewijzigd
  assert public.fn_access_token_hook(ev_oauth) = ev_oauth, 'H24: flag/tenant/fonds hersteld → toegestaan';
  assert public.fn_access_token_hook(ev_refresh) = ev_refresh, 'H24: refresh hersteld → toegestaan';
  assert public.fn_access_token_hook(ev_pw) = ev_pw, 'H24: wachtwoordsessie onaangeroerd';

  raise notice 'OK DEEL 2: hook toetst de exacte identiteit fail-closed, toestandsmodel en rolgrenzen kloppen.';
end $$;

rollback;
