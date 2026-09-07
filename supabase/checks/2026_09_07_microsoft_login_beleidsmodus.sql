-- ============================================================================
--  Gedragssuite Microsoft-loginbeleid fase 1C (#344, PR-A, besluit 0212) — hoort
--  bij supabase/migrations/2026_09_07_microsoft_login_beleidsmodus.sql.
--
--  WAT DEZE SUITE BEWIJST
--    DEEL 1 — STRUCTUUR: getypeerde modus met spiegelconstraint op `actief`,
--                        `pilotstatus` weg, twee nieuwe private tabellen met RLS
--                        en zonder enig recht voor anon/authenticated/service_role/
--                        login_gateway, elf nieuwe gatewayfuncties met EXECUTE
--                        uitsluitend voor login_gateway (24 in totaal), de tweede
--                        hookhelper onder login_hook_owner met search_path '' en
--                        EXECUTE alleen voor supabase_auth_admin, en exact de
--                        kolomrechten die de helper nodig heeft.
--    DEEL 2 — GEDRAG:    modi uit/optioneel/verplicht in de hook (wachtwoord,
--                        magic link, herstel én refresh); break-glass werkt alleen
--                        mét geverifieerde MFA-factor en is niet zelf toe te kennen;
--                        de beperkte koppel-/herstelsessie is eenmalig, kort en
--                        sluit bij activering; persoonlijk ontkoppelen is in
--                        `verplicht` server-side dicht; beheerintrekking en
--                        vrijgave; activering faalt gesloten zonder dekking of
--                        break-glasspad en hertoetst binnen de schrijftransactie
--                        (race); rolgrenzen; audit inhoudsvrij.
--
--  Zelf-seedend en volledig terugdraaiend: DEEL 2 draait in één transactie die
--  eindigt op `rollback`. Er blijft niets achter.
--
--  Draaien:  psql "$DB" -v ON_ERROR_STOP=1 -f supabase/checks/2026_09_07_microsoft_login_beleidsmodus.sql
--  psql exit 0 + "OK"-notices = groen; elke "FAALT" → raise → non-zero exit.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw, afbraak en catalogusmetadata; per scenario wordt met
--      `set local role` naar login_gateway, authenticated of service_role
--      geschakeld (lidmaatschap binnen de transactie verleend en teruggedraaid).
--      Dat is hier de juiste keuze: de vraag "mag deze rol dit?" moet ALS die rol
--      worden gesteld — een telling als postgres zou de rolgrenzen (M15) altijd
--      groen tonen, en de gatewayfuncties draaien in productie uitsluitend als
--      login_gateway. De hook zelf wordt als postgres aangeroepen: de Supabase-rol
--      postgres kan supabase_auth_admin niet aannemen (gereserveerd lidmaatschap)
--      en de hook is SECURITY INVOKER, dus postgres leest dezelfde auth-tabellen.
--      Dát supabase_auth_admin de hook en beide helpers mag uitvoeren, wordt in
--      DEEL 1 uit de catalogus bewezen in plaats van uit een aanroep.
-- ----------------------------------------------------------------------------

\echo '== DEEL 1 — STRUCTUUR =='

do $$
declare
  fouten text := '';
  v_n integer;
  v_nieuw text[] := array[
    'activering_preflight','zet_modus','dekkingsrapport','beheer_intrekking',
    'verleen_break_glass','trek_break_glass_in','maak_uitnodiging','activeer_uitnodiging',
    'trek_uitnodiging_in','sessiebeleid'];
  f text;
begin
  -- ── Configuratietabel: modus is de bron, actief de spiegel ───────────────
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='fonds_microsoft_login' and column_name='modus') then
    fouten := fouten || E'\n- kolom modus ontbreekt op fonds_microsoft_login';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='fonds_microsoft_login' and column_name='pilotstatus') then
    fouten := fouten || E'\n- pilotstatus staat er nog (vervangen door modus)';
  end if;
  if not exists (select 1 from pg_constraint where conname='fonds_microsoft_login_modus_geldig') then
    fouten := fouten || E'\n- CHECK op de toegestane modi ontbreekt';
  end if;
  if not exists (select 1 from pg_constraint where conname='fonds_microsoft_login_modus_spiegelt_actief') then
    fouten := fouten || E'\n- spiegelconstraint actief = (modus <> ''uit'') ontbreekt';
  end if;

  -- ── Nieuwe private tabellen ──────────────────────────────────────────────
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='login_private' and c.relkind='r'
     and c.relname in ('break_glass','herkoppel_uitnodigingen') and c.relrowsecurity;
  if v_n <> 2 then fouten := fouten || format(E'\n- verwacht 2 nieuwe private tabellen met RLS, gevonden %s', v_n); end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='login_private' and c.relname in ('break_glass','herkoppel_uitnodigingen')
       and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_table_privilege('login_gateway',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_table_privilege('supabase_auth_admin',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  ) then fouten := fouten || E'\n- een rol heeft directe tabelrechten op break_glass of herkoppel_uitnodigingen'; end if;

  -- login_hook_owner: uitsluitend de kolommen die de beslissing dragen.
  if not has_column_privilege('login_hook_owner','login_private.break_glass','user_id','SELECT')
     or not has_column_privilege('login_hook_owner','login_private.break_glass','geldig_tot','SELECT')
     or has_column_privilege('login_hook_owner','login_private.break_glass','reden_categorie','SELECT')
     or has_column_privilege('login_hook_owner','login_private.break_glass','correlatie_id','SELECT') then
    fouten := fouten || E'\n- kolomrechten van login_hook_owner op break_glass wijken af';
  end if;
  if not has_column_privilege('login_hook_owner','login_private.herkoppel_uitnodigingen','venster_tot','SELECT')
     or has_column_privilege('login_hook_owner','login_private.herkoppel_uitnodigingen','token_hash','SELECT') then
    fouten := fouten || E'\n- login_hook_owner mag de tokenhash lezen of mist venster_tot';
  end if;
  if not has_column_privilege('login_hook_owner','public.fonds_microsoft_login','modus','SELECT') then
    fouten := fouten || E'\n- login_hook_owner mist SELECT op fonds_microsoft_login.modus';
  end if;
  if not exists (select 1 from pg_policies where schemaname='login_private' and tablename='break_glass'
                   and cmd='SELECT' and 'login_hook_owner' = any(roles))
     or not exists (select 1 from pg_policies where schemaname='login_private' and tablename='herkoppel_uitnodigingen'
                   and cmd='SELECT' and 'login_hook_owner' = any(roles)) then
    fouten := fouten || E'\n- leespolicy voor login_hook_owner ontbreekt op een van de nieuwe tabellen';
  end if;
  if exists (select 1 from pg_policies where schemaname='login_private'
              and tablename in ('break_glass','herkoppel_uitnodigingen') and cmd <> 'SELECT') then
    fouten := fouten || E'\n- er staat een schrijfpolicy op een van de nieuwe private tabellen';
  end if;

  -- ── Gatewayfuncties: alleen login_gateway, gepinde search_path ───────────
  foreach f in array v_nieuw loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='login_private' and p.proname=f) then
      fouten := fouten || format(E'\n- gatewayfunctie %s ontbreekt', f);
      continue;
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='login_private' and p.proname=f
                  and (not p.prosecdef
                       or coalesce(array_to_string(p.proconfig, ','), '') !~ 'search_path='
                       or has_function_privilege('anon',p.oid,'EXECUTE')
                       or has_function_privilege('authenticated',p.oid,'EXECUTE')
                       or has_function_privilege('service_role',p.oid,'EXECUTE')
                       or not has_function_privilege('login_gateway',p.oid,'EXECUTE'))) then
      fouten := fouten || format(E'\n- %s: geen definer, geen gepinde search_path, of verkeerde EXECUTE-set', f);
    end if;
  end loop;

  -- Totaal: 24 gatewayfuncties (13 T1 + tel_startpoging + 10 uit fase 1C).
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='login_private' and has_function_privilege('login_gateway', p.oid, 'EXECUTE');
  if v_n <> 24 then fouten := fouten || format(E'\n- login_gateway mag %s functies uitvoeren, verwacht 24', v_n); end if;

  -- ── Hookhelper voor het wachtwoordpad ────────────────────────────────────
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles o on o.oid=p.proowner
     where n.nspname='login_private' and p.proname='wachtwoordlogin_toegestaan'
       and o.rolname='login_hook_owner' and p.prosecdef
       and coalesce(array_to_string(p.proconfig, ','), '') ~ 'search_path=""?$'
       and has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
       and not has_function_privilege('anon', p.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and not has_function_privilege('service_role', p.oid, 'EXECUTE')
       and not has_function_privilege('login_gateway', p.oid, 'EXECUTE')) then
    fouten := fouten || E'\n- wachtwoordlogin_toegestaan: verkeerde eigenaar, geen definer, ongepind pad of te ruime EXECUTE';
  end if;

  -- ── Hook blijft SECURITY INVOKER met leeg pad ────────────────────────────
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='fn_access_token_hook'
                    and not p.prosecdef
                    and coalesce(array_to_string(p.proconfig, ','), '') ~ 'search_path=""?$') then
    fouten := fouten || E'\n- fn_access_token_hook is geen SECURITY INVOKER met leeg search_path';
  end if;

  if fouten <> '' then raise exception 'Microsoft-loginbeleid fase 1C structuur FAALT:%', fouten; end if;
  raise notice 'OK DEEL 1: modus + spiegelconstraint, twee private tabellen, 24 gateway-executes, tweede hookhelper onder login_hook_owner.';
end $$;

\echo '== DEEL 2 — GEDRAG (transactie, eindigt op rollback) =='

begin;

grant login_gateway to postgres;
grant login_hook_owner to postgres;

do $$
declare
  v_fonds uuid := '73440000-0000-4000-8000-00000000000a';
  v_fonds2 uuid := '73440000-0000-4000-8000-00000000000b';
  v_u1 uuid := '73440000-0000-4000-8000-0000000000a1';   -- gewone bestuurder
  v_u2 uuid := '73440000-0000-4000-8000-0000000000a2';   -- break-glassaccount
  v_u3 uuid := '73440000-0000-4000-8000-0000000000a3';   -- tweede bestuurder
  v_v1 uuid := '73440000-0000-4000-8000-0000000000b1';   -- gebruiker ander fonds
  v_tid text := 'aaaaaaaa-1111-4111-8111-111111111111';
  v_oid1 text := 'bbbbbbbb-2222-4222-8222-2222222222a1';
  v_oid2 text := 'bbbbbbbb-2222-4222-8222-2222222222a2';
  v_oid3 text := 'bbbbbbbb-2222-4222-8222-2222222222a3';
  v_sub1 text := 'sub-1-' || repeat('x', 20);
  v_sub2 text := 'sub-2-' || repeat('y', 20);
  v_sub3 text := 'sub-3-' || repeat('z', 20);
  v_token text := 'geheim-token-voor-de-suite';
  v_hash text;
  v_hash2 text;
  v_id uuid; v_n integer; v_cat text; v_res jsonb; v_user uuid; v_venster timestamptz;
  v_pre record; v_beleid record;
  ev_pw jsonb; ev_pw2 jsonb; ev_magic jsonb; ev_recovery jsonb; ev_oauth1 jsonb; ev_refresh1 jsonb;
begin
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_hash2 := encode(extensions.digest('tweede-token', 'sha256'), 'hex');

  -- ── Seed ────────────────────────────────────────────────────────────────
  insert into public.fondsen (id, naam, slug) values
    (v_fonds, 'Beleid 1C fonds A', 'beleid1c-a'), (v_fonds2, 'Beleid 1C fonds B', 'beleid1c-b');

  -- M1 — nieuw fonds staat standaard op `uit` (trigger uit fase 1B, nu getypeerd)
  select count(*) into v_n from public.fonds_microsoft_login
   where fonds_id in (v_fonds, v_fonds2) and modus = 'uit' and actief = false;
  assert v_n = 2, 'M1: een nieuw fonds krijgt modus uit';

  -- M2 — de spiegelconstraint laat geen drift toe
  begin
    update public.fonds_microsoft_login set actief = true where fonds_id = v_fonds;
    assert false, 'M2: actief=true zonder modus had moeten falen';
  exception when check_violation then null;
  end;

  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data) values
    (v_u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'beleid1c-1@example.test', jsonb_build_object('fonds_id', v_fonds::text)),
    (v_u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'beleid1c-2@example.test', jsonb_build_object('fonds_id', v_fonds::text)),
    (v_u3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'beleid1c-3@example.test', jsonb_build_object('fonds_id', v_fonds::text)),
    (v_v1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'beleid1c-v@example.test', jsonb_build_object('fonds_id', v_fonds2::text));
  assert (select count(*) from public.profielen where id in (v_u1, v_u2, v_u3, v_v1)) = 4, 'seed: vier profielen';

  ev_pw := jsonb_build_object('user_id', v_u1, 'authentication_method', 'password',
             'claims', jsonb_build_object('sub', v_u1, 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method','password','timestamp',0))));
  ev_pw2 := jsonb_build_object('user_id', v_u2, 'authentication_method', 'password',
             'claims', jsonb_build_object('sub', v_u2, 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method','password','timestamp',0))));
  ev_magic := jsonb_build_object('user_id', v_u1, 'authentication_method', 'magiclink',
             'claims', jsonb_build_object('sub', v_u1, 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method','magiclink','timestamp',0))));
  ev_recovery := jsonb_build_object('user_id', v_u1, 'authentication_method', 'recovery',
             'claims', jsonb_build_object('sub', v_u1, 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method','recovery','timestamp',0))));
  ev_oauth1 := jsonb_build_object('user_id', v_u1, 'authentication_method', 'oauth',
             'claims', jsonb_build_object('sub', v_u1, 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method','oauth','timestamp',0))));
  ev_refresh1 := jsonb_build_object('user_id', v_u1, 'authentication_method', 'token_refresh',
             'claims', jsonb_build_object('sub', v_u1, 'role', 'authenticated', 'amr', jsonb_build_array(jsonb_build_object('method','oauth','timestamp',0))));

  -- M3 — modus `uit`: wachtwoord onaangeroerd, Microsoft dicht
  assert public.fn_access_token_hook(ev_pw) = ev_pw, 'M3: wachtwoord passeert in modus uit';
  assert (public.fn_access_token_hook(ev_oauth1)->'error'->>'http_code') = '403', 'M3: oauth zonder binding → 403';

  -- ── M4 — zet_modus: tenant verplicht, daarna optioneel ───────────────────
  set local role login_gateway;
  select login_private.zet_modus(v_fonds, 'optioneel', v_u2, 'corr-m4a') into v_cat;
  assert v_cat = 'tenant_ontbreekt', 'M4: zonder tenant geen actieve modus';
  select login_private.zet_modus(v_fonds, 'onzin', v_u2, 'corr-m4b') into v_cat;
  assert v_cat = 'ongeldige_modus', 'M4: onbekende modus wordt geweigerd';
  reset role;
  update public.fonds_microsoft_login set entra_tenant_id = v_tid where fonds_id in (v_fonds, v_fonds2);
  set local role login_gateway;
  select login_private.zet_modus(v_fonds, 'optioneel', v_u2, 'corr-m4c') into v_cat;
  assert v_cat is null, 'M4: optioneel met tenant slaagt';
  reset role;
  select modus, actief into v_beleid from public.fonds_microsoft_login where fonds_id = v_fonds;
  assert v_beleid.modus = 'optioneel' and v_beleid.actief, 'M4: modus en spiegel bijgewerkt';
  assert public.fn_access_token_hook(ev_pw) = ev_pw, 'M4: wachtwoord blijft open in optioneel';

  -- ── M5 — activering faalt gesloten ───────────────────────────────────────
  set local role login_gateway;
  select * into v_pre from login_private.activering_preflight(v_fonds);
  assert not v_pre.gereed and v_pre.categorie = 'breakglass_ontbreekt', 'M5: zonder noodtoegang geen activering';
  select login_private.zet_modus(v_fonds, 'verplicht', v_u2, 'corr-m5a') into v_cat;
  assert v_cat = 'breakglass_ontbreekt', 'M5: zet_modus weigert zonder break-glass';
  reset role;
  assert (select modus from public.fonds_microsoft_login where fonds_id = v_fonds) = 'optioneel',
    'M5: een geweigerde activering laat de modus ongemoeid';

  -- break-glass zonder MFA telt niet mee
  set local role login_gateway;
  select r.id, r.categorie into v_id, v_cat
    from login_private.verleen_break_glass(v_fonds, v_u2, 'entra_storing', v_u2, 3600, 'corr-m5b') r;
  assert v_cat = 'zelf_toekennen' and v_id is null, 'M5: break-glass is niet zelf toe te kennen';
  select r.id, r.categorie into v_id, v_cat
    from login_private.verleen_break_glass(v_fonds, v_v1, 'entra_storing', v_u1, 3600, 'corr-m5c') r;
  assert v_cat = 'fonds_mismatch' and v_id is null, 'M5: break-glass voor een ander fonds wordt geweigerd';
  select r.id, r.categorie into v_id, v_cat
    from login_private.verleen_break_glass(v_fonds, v_u2, 'entra_storing', v_u1, 3600, 'corr-m5d') r;
  assert v_cat is null and v_id is not null, 'M5: break-glass verleend';
  select * into v_pre from login_private.activering_preflight(v_fonds);
  assert v_pre.categorie = 'breakglass_ontbreekt', 'M5: break-glass zonder geverifieerde MFA-factor telt niet';
  reset role;

  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), v_u2, 'suite-totp', 'totp', 'verified', now(), now());

  set local role login_gateway;
  select * into v_pre from login_private.activering_preflight(v_fonds);
  assert v_pre.categorie = 'dekking_onvolledig' and v_pre.ongedekte_accounts = 2 and v_pre.breakglass_accounts = 1,
    format('M5: nu blokkeert alleen de dekking (categorie=%s, ongedekt=%s)', v_pre.categorie, v_pre.ongedekte_accounts);
  reset role;

  -- ── M6 — dekking compleet maken en activeren ─────────────────────────────
  set local role login_gateway;
  select r.id into v_id from login_private.reserveer_identiteit(v_fonds, v_u1, v_tid, v_oid1, v_sub1, 'corr-m6a') r;
  perform login_private.activeer_identiteit(v_id, v_u1, v_sub1);
  select r.id into v_id from login_private.reserveer_identiteit(v_fonds, v_u3, v_tid, v_oid3, v_sub3, 'corr-m6b') r;
  perform login_private.activeer_identiteit(v_id, v_u3, v_sub3);
  select * into v_pre from login_private.activering_preflight(v_fonds);
  assert v_pre.gereed and v_pre.categorie is null, 'M6: preflight groen na volledige dekking';
  select login_private.zet_modus(v_fonds, 'verplicht', v_u2, 'corr-m6c') into v_cat;
  assert v_cat is null, 'M6: activering geslaagd';
  reset role;

  -- ── M7 — het wachtwoordpad is nu dicht, behalve voor break-glass ─────────
  v_res := public.fn_access_token_hook(ev_pw);
  assert (v_res->'error'->>'http_code') = '403', 'M7: wachtwoordlogin geweigerd in verplicht';
  assert v_res::text !~* ('example\.test|sub-1|' || v_oid1), 'M7: geen accountgegevens in de weigering';
  assert (public.fn_access_token_hook(ev_magic)->'error'->>'http_code') = '403', 'M7: magic link eveneens geweigerd';
  assert (public.fn_access_token_hook(ev_recovery)->'error'->>'http_code') = '403', 'M7: herstelpad eveneens geweigerd';
  assert public.fn_access_token_hook(ev_pw2) = ev_pw2, 'M7: break-glassaccount met geverifieerde MFA mag wél';

  -- MFA-factor terug naar unverified → uitzondering werkt niet meer
  update auth.mfa_factors set status = 'unverified' where user_id = v_u2;
  assert (public.fn_access_token_hook(ev_pw2)->'error'->>'http_code') = '403', 'M7: break-glass zonder geverifieerde MFA → 403';
  update auth.mfa_factors set status = 'verified' where user_id = v_u2;

  -- Het Microsoft-pad blijft ongewijzigd werken
  insert into auth.identities (user_id, provider, provider_id, identity_data)
  values (v_u1, 'azure', v_sub1, jsonb_build_object('sub', v_sub1, 'provider_id', v_sub1,
          'custom_claims', jsonb_build_object('tid', v_tid, 'oid', v_oid1)));
  assert public.fn_access_token_hook(ev_oauth1) = ev_oauth1, 'M7: actieve binding blijft toegestaan in verplicht';
  assert public.fn_access_token_hook(ev_refresh1) = ev_refresh1, 'M7: ook de refresh';

  -- ── M8 — persoonlijk ontkoppelen is server-side dicht ────────────────────
  set local role login_gateway;
  select r.id, r.categorie into v_id, v_cat from login_private.start_intrekking(v_fonds, v_u1, v_u1, 'corr-m8') r;
  assert v_cat = 'ontkoppelen_verplicht' and v_id is null, 'M8: persoonlijk ontkoppelen wordt geweigerd';
  reset role;
  select count(*) into v_n from login_private.audit_log
   where fonds_id = v_fonds and user_id = v_u1 and gebeurtenis = 'ontkoppelen.geweigerd' and foutcategorie = 'ontkoppelen_verplicht';
  assert v_n = 1, 'M8: de weigering staat in de audit';

  -- ── M9 — beheerintrekking ────────────────────────────────────────────────
  set local role login_gateway;
  select r.id, r.categorie into v_id, v_cat from login_private.beheer_intrekking(v_fonds, v_v1, v_u2, false, 'corr-m9a') r;
  assert v_cat = 'fonds_mismatch', 'M9: een doel buiten het fonds wordt geweigerd';
  select r.id, r.categorie into v_id, v_cat from login_private.beheer_intrekking(v_fonds, v_u3, v_u2, false, 'corr-m9b') r;
  assert v_cat is null and v_id is not null, 'M9: beheerintrekking gestart';
  reset role;
  assert (select status from login_private.microsoft_identiteiten where id = v_id) = 'revoking', 'M9: binding staat op revoking';
  set local role login_gateway;
  select r.id, r.categorie into v_id, v_cat from login_private.beheer_intrekking(v_fonds, v_u3, v_u2, true, 'corr-m9c') r;
  assert v_cat is null, 'M9: vrijgeven slaagt';
  reset role;
  assert (select status from login_private.microsoft_identiteiten where id = v_id) = 'revoked', 'M9: binding vrijgegeven';

  -- ── M10 — beperkte koppel-/herstelsessie ─────────────────────────────────
  set local role login_gateway;
  select login_private.maak_uitnodiging(v_fonds, v_u3, 'niet-hex', 3600, v_u2, 'corr-m10a') into v_cat;
  assert v_cat = 'ongeldig_token', 'M10: alleen een hash wordt geaccepteerd';
  select login_private.maak_uitnodiging(v_fonds, v_v1, v_hash, 3600, v_u2, 'corr-m10b') into v_cat;
  assert v_cat = 'fonds_mismatch', 'M10: uitnodiging buiten het fonds wordt geweigerd';
  select login_private.maak_uitnodiging(v_fonds, v_u3, v_hash, 3600, v_u2, 'corr-m10c') into v_cat;
  assert v_cat is null, 'M10: uitnodiging uitgegeven';
  reset role;

  -- Vóór activering verandert er niets aan het wachtwoordpad.
  assert (public.fn_access_token_hook(
            jsonb_set(ev_pw, '{user_id}', to_jsonb(v_u3))
          )->'error'->>'http_code') = '403', 'M10: een niet-geactiveerde uitnodiging opent niets';

  set local role login_gateway;
  select r.user_id, r.venster_tot, r.categorie into v_user, v_venster, v_cat
    from login_private.activeer_uitnodiging(v_hash, v_fonds, 900, 'corr-m10d') r;
  assert v_cat is null and v_user = v_u3 and v_venster > now(), 'M10: venster geopend voor het juiste account';
  select r.categorie into v_cat from login_private.activeer_uitnodiging(v_hash, v_fonds, 900, 'corr-m10e') r;
  assert v_cat = 'uitnodiging_ongeldig', 'M10: het token is eenmalig';
  reset role;

  assert public.fn_access_token_hook(jsonb_set(ev_pw, '{user_id}', to_jsonb(v_u3))) =
         jsonb_set(ev_pw, '{user_id}', to_jsonb(v_u3)), 'M10: binnen het venster mag dit ene account met wachtwoord aanmelden';

  -- Ontkoppelen mag binnen het venster (de oude identiteit moet los kunnen).
  set local role login_gateway;
  select r.id into v_id from login_private.reserveer_identiteit(v_fonds, v_u3, v_tid, v_oid3, v_sub3, 'corr-m10f') r;
  perform login_private.activeer_identiteit(v_id, v_u3, v_sub3);
  reset role;

  -- Activering sluit het venster onmiddellijk.
  select count(*) into v_n from login_private.herkoppel_uitnodigingen
   where token_hash = v_hash and voltooid_op is not null;
  assert v_n = 1, 'M10: het venster sluit zodra de binding actief is';
  assert (public.fn_access_token_hook(jsonb_set(ev_pw, '{user_id}', to_jsonb(v_u3)))->'error'->>'http_code') = '403',
    'M10: na koppeling is het wachtwoordpad weer dicht';

  -- ── M11 — venster verlopen ───────────────────────────────────────────────
  set local role login_gateway;
  select login_private.maak_uitnodiging(v_fonds, v_u1, v_hash2, 3600, v_u2, 'corr-m11a') into v_cat;
  assert v_cat is null, 'M11: tweede uitnodiging uitgegeven';
  perform login_private.activeer_uitnodiging(v_hash2, v_fonds, 900, 'corr-m11b');
  reset role;
  assert public.fn_access_token_hook(ev_pw) = ev_pw, 'M11: venster open';
  update login_private.herkoppel_uitnodigingen set venster_tot = now() - interval '1 second'
   where token_hash = v_hash2;
  assert (public.fn_access_token_hook(ev_pw)->'error'->>'http_code') = '403', 'M11: verlopen venster sluit het wachtwoordpad';

  -- ── M12 — break-glass intrekken ──────────────────────────────────────────
  select g.id into v_id from login_private.break_glass g where g.user_id = v_u2 and g.ingetrokken_op is null;
  set local role login_gateway;
  select login_private.trek_break_glass_in(v_id, v_fonds, v_u1, 'corr-m12') into v_cat;
  assert v_cat is null, 'M12: intrekken slaagt';
  select login_private.trek_break_glass_in(v_id, v_fonds, v_u1, 'corr-m12b') into v_cat;
  assert v_cat is null, 'M12: intrekken is idempotent';
  reset role;
  assert (public.fn_access_token_hook(ev_pw2)->'error'->>'http_code') = '403', 'M12: na intrekking geen noodtoegang meer';

  -- ── M13 — race: dekking valt weg tussen preflight en omslag ──────────────
  set local role login_gateway;
  select login_private.zet_modus(v_fonds, 'optioneel', v_u2, 'corr-m13a') into v_cat;
  assert v_cat is null, 'M13: terug naar optioneel';
  select r.id, r.categorie into v_id, v_cat from login_private.beheer_intrekking(v_fonds, v_u1, v_u2, true, 'corr-m13b') r;
  assert v_cat is null, 'M13: binding van u1 vrijgegeven';
  select login_private.zet_modus(v_fonds, 'verplicht', v_u2, 'corr-m13c') into v_cat;
  assert v_cat in ('dekking_onvolledig','breakglass_ontbreekt'),
    format('M13: de omslag hertoetst binnen de schrijftransactie (kreeg %s)', coalesce(v_cat,'null'));
  reset role;
  assert (select modus from public.fonds_microsoft_login where fonds_id = v_fonds) = 'optioneel',
    'M13: de modus is niet omgeslagen';
  select count(*) into v_n from login_private.audit_log
   where fonds_id = v_fonds and gebeurtenis = 'beleid.activering_geweigerd';
  assert v_n >= 2, 'M13: elke geweigerde activering staat in de audit';

  -- ── M14 — sessiebeleid ───────────────────────────────────────────────────
  set local role login_gateway;
  select * into v_beleid from login_private.sessiebeleid(v_u3);
  assert v_beleid.fonds_id = v_fonds and v_beleid.modus = 'optioneel'
     and v_beleid.binding_status = 'active' and not v_beleid.break_glass and not v_beleid.link_only,
     'M14: sessiebeleid levert de actuele stand';
  select count(*) into v_n from login_private.sessiebeleid('73440000-0000-4000-8000-0000000000ff');
  assert v_n = 0, 'M14: een account zonder profiel levert geen beleidsrij';
  reset role;

  -- ── M15 — rolgrenzen ─────────────────────────────────────────────────────
  set local role authenticated;
  begin
    perform login_private.zet_modus(v_fonds, 'uit', v_u2, 'corr-m15');
    assert false, 'M15: authenticated mag zet_modus niet uitvoeren';
  exception when insufficient_privilege or undefined_function or invalid_schema_name then null;
  end;
  reset role;
  set local role service_role;
  begin
    perform login_private.sessiebeleid(v_u1);
    assert false, 'M15: service_role mag sessiebeleid niet uitvoeren';
  exception when insufficient_privilege or undefined_function or invalid_schema_name then null;
  end;
  reset role;

  -- ── M16 — audit is inhoudsvrij ───────────────────────────────────────────
  select count(*) into v_n from login_private.audit_log
   where fonds_id in (v_fonds, v_fonds2)
     and (foutcategorie ilike '%@%' or coalesce(foutcategorie,'') like '%' || v_sub1 || '%'
          or coalesce(identiteit_hash,'') like '%' || v_oid1 || '%' or gebeurtenis ilike '%@%');
  assert v_n = 0, 'M16: geen e-mail, sub of ruwe oid in de audit';
  select count(*) into v_n from login_private.audit_log
   where fonds_id = v_fonds and gebeurtenis in
     ('beleid.gewijzigd','beleid.activering_geweigerd','breakglass.verleend','breakglass.geweigerd',
      'breakglass.ingetrokken','herkoppelen.uitgenodigd','herkoppelen.venster_geopend',
      'beheer.ingetrokken','beheer.vrijgegeven','ontkoppelen.geweigerd');
  assert v_n >= 10, format('M16: alle beleidsgebeurtenissen worden vastgelegd (gevonden %s)', v_n);

  -- ── M17 — terug naar uit ─────────────────────────────────────────────────
  set local role login_gateway;
  select login_private.zet_modus(v_fonds, 'uit', v_u2, 'corr-m17') into v_cat;
  assert v_cat is null, 'M17: terug naar uit';
  reset role;
  assert (select not actief from public.fonds_microsoft_login where fonds_id = v_fonds), 'M17: spiegel volgt';
  assert public.fn_access_token_hook(ev_pw) = ev_pw, 'M17: wachtwoord weer open';
  assert (public.fn_access_token_hook(ev_oauth1)->'error'->>'http_code') = '403', 'M17: Microsoft dicht in modus uit';

  raise notice 'OK DEEL 2: drie modi afgedwongen in de hook, break-glass MFA-plichtig, koppel-/herstelsessie eenmalig en kort, activering fail-closed met hertoetsing.';
end $$;

rollback;
