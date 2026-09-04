-- ============================================================================
--  Gedragssuite AI-gateway T2 (#311, M365 fase 2B) — hoort bij
--  supabase/migrations/2026_09_04_ai_gateway_configuratie.sql.
--
--  WAT DEZE SUITE BEWIJST
--    DEEL 1 — STRUCTUUR: minimale loginrol ai_gateway (exact 4 executes, nul
--                        tabelrechten), privaat schema zonder browser-/service-
--                        toegang, gepinde search_path, RLS aan, append-only,
--                        publieke triggerfunctie voor niemand uitvoerbaar,
--                        backfill ×4 per fonds.
--    DEEL 2 — GEDRAG:    * nieuw fonds (óók via service_role) krijgt vier rijen;
--                        * profiel van fonds A is niet aan fonds B te koppelen;
--                        * eigen profiel wél; versie stijgt; wijziging gelogd;
--                        * default kan nooit naar een klantprofiel wijzen;
--                        * lees_config: ok / config_ontbreekt / config_inactief /
--                          profiel_inactief / model_niet_toegestaan / onbekende
--                          taakgroep; secret_ref komt alleen bij ai_gateway;
--                        * ai_gateway kan geen tabel lezen; authenticated en
--                          service_role kunnen geen functie uitvoeren;
--                        * schrijf_log schrijft; UPDATE/DELETE geblokkeerd;
--                        * onvolledige default laat fondscreatie FALEN (R6).
--
--  Zelf-seedend en volledig terugdraaiend: DEEL 2 draait in één transactie die
--  eindigt op `rollback`. Er blijft niets achter.
--
--  Draaien:  psql "$DB" -v ON_ERROR_STOP=1 -f supabase/checks/2026_09_04_ai_gateway.sql
--  psql exit 0 + de "OK #"-notices = groen; elke "FAALT" → raise → non-zero exit.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ROL: postgres voor opbouw, afbraak en catalogusmetadata; per scenario wordt
--      met `set local role` naar ai_gateway, authenticated of service_role
--      geschakeld — de meting gebeurt onder de werkelijke rol. Het lidmaatschap
--      van ai_gateway wordt binnen de DEEL 2-transactie verleend en teruggedraaid.
-- ----------------------------------------------------------------------------

\echo '== DEEL 1 — STRUCTUUR =='

do $$
declare
  fouten text := '';
  v_n integer;
begin
  -- 1a. Minimale loginrol.
  if not exists (
    select 1 from pg_roles
    where rolname = 'ai_gateway' and rolcanlogin and not rolinherit and not rolsuper
      and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls
      and rolconnlimit between 1 and 5
  ) then
    fouten := fouten || E'\n- ai_gateway is niet de vereiste minimale loginrol';
  end if;

  -- 1b. Schema-toegang.
  if not has_schema_privilege('ai_gateway', 'ai_gateway_private', 'USAGE') then
    fouten := fouten || E'\n- ai_gateway mist USAGE op ai_gateway_private';
  end if;
  if has_schema_privilege('anon', 'ai_gateway_private', 'USAGE')
     or has_schema_privilege('authenticated', 'ai_gateway_private', 'USAGE')
     or has_schema_privilege('service_role', 'ai_gateway_private', 'USAGE') then
    fouten := fouten || E'\n- anon/authenticated/service_role heeft USAGE op ai_gateway_private';
  end if;

  -- 1c. Vijf tabellen, RLS aan, geen policies, geen rechten voor wie dan ook.
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'ai_gateway_private' and c.relkind = 'r';
  if v_n <> 5 then
    fouten := fouten || format(E'\n- verwacht 5 tabellen in ai_gateway_private, gevonden %s', v_n);
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ai_gateway_private' and c.relkind = 'r' and not c.relrowsecurity
  ) then
    fouten := fouten || E'\n- een tabel in ai_gateway_private heeft RLS uit';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'ai_gateway_private') then
    fouten := fouten || E'\n- ai_gateway_private heeft een policy (deny-by-default vereist géén policy)';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ai_gateway_private' and c.relkind in ('r','p','v','m','S','f')
      and (has_table_privilege('ai_gateway', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  ) then
    fouten := fouten || E'\n- een rol heeft directe tabelrechten in ai_gateway_private';
  end if;

  -- 1d. Exact vier SECURITY DEFINER-functies, gepinde search_path, exact vier executes voor ai_gateway.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'ai_gateway_private' and p.prosecdef;
  if v_n <> 4 then
    fouten := fouten || format(E'\n- verwacht 4 SECURITY DEFINER-functies, gevonden %s', v_n);
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ai_gateway_private' and p.prosecdef
      and not coalesce(array_to_string(p.proconfig, ',') ~ 'search_path=ai_gateway_private, public, pg_temp$', false)
  ) then
    fouten := fouten || E'\n- SECURITY DEFINER zonder gepinde search_path (…, pg_temp als laatste)';
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'ai_gateway_private' and has_function_privilege('ai_gateway', p.oid, 'EXECUTE');
  if v_n <> 4 then
    fouten := fouten || format(E'\n- ai_gateway mag exact 4 functies uitvoeren, gevonden %s', v_n);
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ai_gateway_private'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ) then
    fouten := fouten || E'\n- browser- of servicerol kan een functie in ai_gateway_private uitvoeren';
  end if;

  -- 1e. Publieke triggerfunctie: bestaat, SECURITY DEFINER, voor niemand uitvoerbaar; trigger staat.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_fonds_ai_configuratie_standaard' and p.prosecdef
  ) then
    fouten := fouten || E'\n- public.fn_fonds_ai_configuratie_standaard ontbreekt of is geen SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'public.fn_fonds_ai_configuratie_standaard()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fn_fonds_ai_configuratie_standaard()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.fn_fonds_ai_configuratie_standaard()', 'EXECUTE') then
    fouten := fouten || E'\n- fn_fonds_ai_configuratie_standaard is uitvoerbaar door een applicatierol';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_fonds_ai_configuratie_standaard' and not tgisinternal) then
    fouten := fouten || E'\n- trigger trg_fonds_ai_configuratie_standaard op public.fondsen ontbreekt';
  end if;

  -- 1f. Append-only triggers op beide logtabellen.
  if (select count(*) from pg_trigger where tgname in ('trg_gateway_log_append_only','trg_fonds_configuratie_log_append_only') and not tgisinternal) <> 2 then
    fouten := fouten || E'\n- append-only trigger op gateway_log of fonds_configuratie_log ontbreekt';
  end if;

  -- 1g. Backfill: vier actieve rijen per fonds; vier defaults op actieve platformprofielen.
  if exists (
    select 1 from public.fondsen f
    where (select count(*) from ai_gateway_private.fonds_configuratie c where c.fonds_id = f.id and c.actief) <> 4
  ) then
    fouten := fouten || E'\n- niet ieder fonds heeft exact vier actieve configuratieregels';
  end if;
  select count(*) into v_n from ai_gateway_private.taakgroep_default d
    join ai_gateway_private.provider_profiel p on p.id = d.profiel_id
   where p.actief and p.eigenaar_fonds_id is null;
  if v_n <> 4 then
    fouten := fouten || format(E'\n- verwacht 4 defaults op actieve platformprofielen, gevonden %s', v_n);
  end if;
  -- 1h. Geen key of URL in de referentiekolommen (alleen sleutelnamen).
  if exists (
    select 1 from ai_gateway_private.provider_profiel
    where secret_ref !~ '^[A-Z][A-Z0-9_]{2,63}$'
       or (endpoint_ref is not null and endpoint_ref !~ '^[A-Z][A-Z0-9_]{2,63}$')
       or secret_ref ~* 'sk-|https?://' or coalesce(endpoint_ref,'') ~* 'https?://'
  ) then
    fouten := fouten || E'\n- provider_profiel bevat iets dat op een key of URL lijkt i.p.v. een sleutelnaam';
  end if;

  if fouten <> '' then raise exception E'FAALT DEEL 1:\n%', fouten; end if;
  raise notice 'OK #1: rol, schema, 5 tabellen deny-by-default, 4 functies, triggers, backfill ×4.';
end $$;

\echo '== DEEL 2 — GEDRAG =='

begin;

-- De Supabase-`postgres`-rol is geen superuser: `set local role ai_gateway` mag
-- alleen als lid. Het lidmaatschap wordt hier TRANSACTIONEEL verleend (postgres
-- heeft als aanmaker ADMIN OPTION op de rol) en verdwijnt met de `rollback`
-- onderaan; er blijft geen lidmaatschap achter.
grant ai_gateway to postgres;

-- ── Seed ────────────────────────────────────────────────────────────────────
-- Twee fondsen; de fondstrigger maakt hun configuratie (dat is meteen test 2a).
insert into public.fondsen (id, naam, slug) values
  ('a1111111-1111-1111-1111-1111111111a1','Gateway testfonds A','xgw-a');

-- 2a. Nieuw fonds via service_role (het werkelijke creatiepad) krijgt vier rijen.
do $$
declare v_n integer;
begin
  set local role service_role;
  insert into public.fondsen (id, naam, slug) values
    ('a2222222-2222-2222-2222-2222222222a2','Gateway testfonds B','xgw-b');
  reset role;
  select count(*) into v_n from ai_gateway_private.fonds_configuratie
   where fonds_id = 'a2222222-2222-2222-2222-2222222222a2' and actief;
  if v_n <> 4 then raise exception 'FAALT #2a: nieuw fonds via service_role kreeg % i.p.v. 4 rijen', v_n; end if;
  select count(*) into v_n from ai_gateway_private.fonds_configuratie
   where fonds_id = 'a1111111-1111-1111-1111-1111111111a1' and actief;
  if v_n <> 4 then raise exception 'FAALT #2a: nieuw fonds via postgres kreeg % i.p.v. 4 rijen', v_n; end if;
  if (select count(*) from ai_gateway_private.fonds_configuratie_log
       where fonds_id = 'a2222222-2222-2222-2222-2222222222a2' and actie = 'insert') <> 4 then
    raise exception 'FAALT #2a: de vier standaardregels zijn niet gelogd';
  end if;
  raise notice 'OK #2a: nieuw fonds krijgt vier expliciete regels, transactioneel en gelogd — ook via service_role.';
end $$;

-- 2b. Profiel van fonds A is niet aan fonds B te koppelen.
insert into ai_gateway_private.provider_profiel (id, eigenaar_fonds_id, provider, secret_ref, reden)
values ('xgw-klant-a', 'a1111111-1111-1111-1111-1111111111a1', 'openai', 'XGW_KLANT_A_KEY', 'testprofiel klant A');
do $$
begin
  begin
    update ai_gateway_private.fonds_configuratie
       set profiel_id = 'xgw-klant-a', provider = 'openai', model = 'claude-opus-4-8',
           reden = 'poging tot koppeling aan andermans profiel'
     where fonds_id = 'a2222222-2222-2222-2222-2222222222a2' and taakgroep = 'generatie';
    raise exception 'FAALT #2b: fonds B kon het profiel van fonds A selecteren';
  exception
    when raise_exception then
      if sqlerrm like 'FAALT%' then raise; end if;
      if sqlerrm not like '%ander fonds%' then raise exception 'FAALT #2b: onverwachte fout: %', sqlerrm; end if;
    when foreign_key_violation then
      raise exception 'FAALT #2b: de FK sloeg eerder toe dan de eigenaarstoets (%)', sqlerrm;
  end;
  raise notice 'OK #2b: profiel van fonds A is niet aan fonds B te koppelen.';
end $$;

-- 2c. Eigen profiel wél; versie stijgt; wijziging gelogd; provider moet consistent zijn.
-- (openai/gpt staat niet op de DB-allowlist; het profiel wijst daarom naar anthropic.)
update ai_gateway_private.provider_profiel set provider = 'anthropic', secret_ref = 'XGW_KLANT_A_KEY'
 where id = 'xgw-klant-a';
do $$
declare v_versie integer;
begin
  update ai_gateway_private.fonds_configuratie
     set profiel_id = 'xgw-klant-a', provider = 'anthropic', model = 'claude-sonnet-4-6',
         reden = 'klant A kiest eigen profiel (test 2c)'
   where fonds_id = 'a1111111-1111-1111-1111-1111111111a1' and taakgroep = 'generatie';
  select versie into v_versie from ai_gateway_private.fonds_configuratie
   where fonds_id = 'a1111111-1111-1111-1111-1111111111a1' and taakgroep = 'generatie';
  if v_versie <> 2 then raise exception 'FAALT #2c: versie is % i.p.v. 2', v_versie; end if;
  if not exists (
    select 1 from ai_gateway_private.fonds_configuratie_log
    where fonds_id = 'a1111111-1111-1111-1111-1111111111a1' and taakgroep = 'generatie'
      and actie = 'update' and nieuw->>'profiel_id' = 'xgw-klant-a' and oud->>'profiel_id' = 'platform-anthropic'
  ) then
    raise exception 'FAALT #2c: de wijziging is niet met oud/nieuw gelogd';
  end if;
  -- Een update zonder reden is niet auditbaar.
  begin
    update ai_gateway_private.fonds_configuratie set model = 'claude-opus-4-8', reden = null
     where fonds_id = 'a1111111-1111-1111-1111-1111111111a1' and taakgroep = 'generatie';
    raise exception 'FAALT #2c: update zonder reden werd toegestaan';
  exception when raise_exception then
    if sqlerrm like 'FAALT%' then raise; end if;
  end;
  -- Provider moet bij het profiel passen.
  begin
    update ai_gateway_private.fonds_configuratie set provider = 'mistral', model = 'mistral-embed', reden = 'inconsistente provider (test)'
     where fonds_id = 'a1111111-1111-1111-1111-1111111111a1' and taakgroep = 'generatie';
    raise exception 'FAALT #2c: provider afwijkend van profiel werd toegestaan';
  exception when raise_exception then
    if sqlerrm like 'FAALT%' then raise; end if;
  end;
  raise notice 'OK #2c: eigen profiel selecteerbaar, versie 2, oud/nieuw gelogd; reden en providerconsistentie afgedwongen.';
end $$;

-- 2d. De defaulttabel accepteert nooit een klantprofiel.
do $$
begin
  begin
    update ai_gateway_private.taakgroep_default set profiel_id = 'xgw-klant-a', provider = 'anthropic'
     where taakgroep = 'hulp_snel';
    raise exception 'FAALT #2d: default kon naar een klantprofiel wijzen';
  exception when raise_exception then
    if sqlerrm like 'FAALT%' then raise; end if;
    if sqlerrm not like '%platformprofiel%' then raise exception 'FAALT #2d: onverwachte fout: %', sqlerrm; end if;
  end;
  raise notice 'OK #2d: default wijst uitsluitend naar platformprofielen.';
end $$;

-- 2e. lees_config onder de gateway-rol: alle uitkomsten fail-closed en herkenbaar.
do $$
declare v jsonb;
begin
  set local role ai_gateway;
  v := ai_gateway_private.lees_config('a2222222-2222-2222-2222-2222222222a2', 'generatie');
  if (v->>'ok')::boolean is not true or v->>'model' <> 'claude-opus-4-8' or v->>'secret_ref' <> 'ANTHROPIC_API_KEY'
     or v->>'profiel_id' <> 'platform-anthropic' or (v->>'versie')::int <> 1 then
    raise exception 'FAALT #2e: normale resolutie levert onverwacht resultaat: %', v;
  end if;
  v := ai_gateway_private.lees_config('a1111111-1111-1111-1111-1111111111a1', 'generatie');
  if (v->>'ok')::boolean is not true or v->>'profiel_id' <> 'xgw-klant-a' or v->>'secret_ref' <> 'XGW_KLANT_A_KEY'
     or v->>'eigenaar_fonds_id' <> 'a1111111-1111-1111-1111-1111111111a1' then
    raise exception 'FAALT #2e: eigen profiel resolveert niet: %', v;
  end if;
  v := ai_gateway_private.lees_config('00000000-0000-0000-0000-00000000dead', 'generatie');
  if (v->>'ok')::boolean is not false or v->>'reden' <> 'config_ontbreekt' then
    raise exception 'FAALT #2e: onbekend fonds gaf geen config_ontbreekt: %', v;
  end if;
  v := ai_gateway_private.lees_config('a2222222-2222-2222-2222-2222222222a2', 'bestaat_niet');
  if (v->>'ok')::boolean is not false or v->>'reden' <> 'taakgroep_onbekend' then
    raise exception 'FAALT #2e: onbekende taakgroep gaf geen taakgroep_onbekend: %', v;
  end if;
  v := ai_gateway_private.lees_config(null, 'generatie');
  if (v->>'ok')::boolean is not false or v->>'reden' <> 'fonds_ontbreekt' then
    raise exception 'FAALT #2e: null-fonds gaf geen fonds_ontbreekt: %', v;
  end if;
  reset role;

  update ai_gateway_private.fonds_configuratie set actief = false, reden = 'inactief gezet (test 2e)'
   where fonds_id = 'a2222222-2222-2222-2222-2222222222a2' and taakgroep = 'concept';
  update ai_gateway_private.provider_profiel set actief = false where id = 'xgw-klant-a';
  update public.ai_model_allowlist set actief = false where provider = 'anthropic' and model = 'claude-haiku-4-5-20251001';

  set local role ai_gateway;
  v := ai_gateway_private.lees_platform_profiel('anthropic');
  if v->>'profiel_id' <> 'platform-anthropic' then raise exception 'FAALT #2e: klantprofiel lekt als platformprofiel: %', v; end if;
  v := ai_gateway_private.lees_config('a2222222-2222-2222-2222-2222222222a2', 'concept');
  if v->>'reden' <> 'config_inactief' then raise exception 'FAALT #2e: inactieve configuratie: %', v; end if;
  v := ai_gateway_private.lees_config('a1111111-1111-1111-1111-1111111111a1', 'generatie');
  if v->>'reden' <> 'profiel_inactief' then raise exception 'FAALT #2e: inactief profiel: %', v; end if;
  v := ai_gateway_private.lees_config('a2222222-2222-2222-2222-2222222222a2', 'hulp_snel');
  if v->>'reden' <> 'model_niet_toegestaan' then raise exception 'FAALT #2e: gedeactiveerd allowlistmodel: %', v; end if;
  if v ? 'secret_ref' then raise exception 'FAALT #2e: een weigering lekt secret_ref'; end if;
  -- Platformprofiel per provider (platformbrede taken): alleen platform, alleen actief.
  v := ai_gateway_private.lees_platform_profiel('openai');
  if (v->>'ok')::boolean is not true or v->>'profiel_id' <> 'platform-openai' or v->>'secret_ref' <> 'OPENAI_API_KEY' then
    raise exception 'FAALT #2e: platformprofiel openai resolveert niet: %', v;
  end if;
  v := ai_gateway_private.lees_platform_profiel('gemini');
  if v->>'reden' <> 'provider_onbekend' then raise exception 'FAALT #2e: onbekende provider: %', v; end if;
  reset role;
  raise notice 'OK #2e: lees_config resolveert correct en faalt gesloten op ontbrekend/inactief/onbekend/niet-toegestaan.';
end $$;

-- 2f. Rolgrenzen: ai_gateway leest geen tabel; authenticated/service_role voeren geen functie uit.
do $$
declare v jsonb; v_n integer;
begin
  set local role ai_gateway;
  begin
    select count(*) into v_n from ai_gateway_private.fonds_configuratie;
    raise exception 'FAALT #2f: ai_gateway kon fonds_configuratie rechtstreeks lezen';
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into v_n from ai_gateway_private.gateway_log;
    raise exception 'FAALT #2f: ai_gateway kon gateway_log rechtstreeks lezen';
  exception when insufficient_privilege then null;
  end;
  reset role;

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111"}';
  begin
    v := ai_gateway_private.lees_config('a2222222-2222-2222-2222-2222222222a2', 'generatie');
    raise exception 'FAALT #2f: authenticated kon lees_config uitvoeren';
  exception when insufficient_privilege then null;
  end;
  begin
    perform ai_gateway_private.schrijf_log('{}'::jsonb);
    raise exception 'FAALT #2f: authenticated kon schrijf_log uitvoeren';
  exception when insufficient_privilege then null;
  end;
  reset role;

  set local role service_role;
  begin
    v := ai_gateway_private.lees_config('a2222222-2222-2222-2222-2222222222a2', 'generatie');
    raise exception 'FAALT #2f: service_role kon lees_config uitvoeren';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'OK #2f: ai_gateway heeft geen tabeltoegang; authenticated en service_role hebben geen functietoegang.';
end $$;

-- 2g. schrijf_log schrijft en het log is append-only; validatie faalt gesloten.
do $$
declare v_id uuid; v_n integer;
begin
  set local role ai_gateway;
  v_id := ai_gateway_private.schrijf_log(jsonb_build_object(
    'fonds_id', 'a2222222-2222-2222-2222-2222222222a2',
    'actor_soort', 'gebruiker', 'actor_id', 'b1111111-1111-1111-1111-111111111111',
    'taaktype', 'chat_generatie', 'taakgroep', 'generatie',
    'provider', 'anthropic', 'model', 'claude-opus-4-8', 'profiel_id', 'platform-anthropic',
    'config_versie', 1, 'poort_config_versie', 1,
    'resultaat', 'ok', 'stop_reden', 'einde', 'latency_ms', 1234,
    'tokens_in', 100, 'tokens_out', 20, 'tokens_cache_lezen', 5, 'tokens_cache_creatie', 0, 'tokens_totaal', 125,
    'correlatie_id', 'xgw-correlatie-0001', 'label', 'chat.POST'
  ));
  if v_id is null then raise exception 'FAALT #2g: schrijf_log gaf geen id'; end if;
  begin
    perform ai_gateway_private.schrijf_log(jsonb_build_object(
      'actor_soort', 'gebruiker', 'taaktype', 'chat_generatie',
      'provider', 'anthropic', 'model', 'claude-opus-4-8', 'resultaat', 'ok', 'correlatie_id', 'xgw-correlatie-0002'));
    raise exception 'FAALT #2g: gebruiker-actor zonder actor_id werd geaccepteerd';
  exception when check_violation then null;
  end;
  begin
    perform ai_gateway_private.schrijf_log(jsonb_build_object(
      'actor_soort', 'systeem', 'proces', 'ingest-worker', 'taaktype', 'samenvatting',
      'provider', 'anthropic', 'model', 'claude-sonnet-4-5', 'resultaat', 'onzin', 'correlatie_id', 'xgw-correlatie-0003'));
    raise exception 'FAALT #2g: onbekende resultaatcategorie werd geaccepteerd';
  exception when check_violation then null;
  end;
  -- Het leespad voor de platformlaag ziet de regel (en niets uit een ander fonds).
  select count(*) into v_n from ai_gateway_private.lees_log_platform('a2222222-2222-2222-2222-2222222222a2', 10);
  if v_n <> 1 then raise exception 'FAALT #2g: lees_log_platform gaf % regels i.p.v. 1', v_n; end if;
  select count(*) into v_n from ai_gateway_private.lees_log_platform('a1111111-1111-1111-1111-1111111111a1', 10);
  if v_n <> 0 then raise exception 'FAALT #2g: lees_log_platform lekt regels van een ander fonds'; end if;
  reset role;

  begin
    update ai_gateway_private.gateway_log set tokens_in = 0 where id = v_id;
    raise exception 'FAALT #2g: gateway_log accepteerde een UPDATE';
  exception when raise_exception then
    if sqlerrm like 'FAALT%' then raise; end if;
  end;
  begin
    delete from ai_gateway_private.gateway_log where id = v_id;
    raise exception 'FAALT #2g: gateway_log accepteerde een DELETE';
  exception when raise_exception then
    if sqlerrm like 'FAALT%' then raise; end if;
  end;
  begin
    delete from ai_gateway_private.fonds_configuratie_log where fonds_id = 'a2222222-2222-2222-2222-2222222222a2';
    raise exception 'FAALT #2g: fonds_configuratie_log accepteerde een DELETE';
  exception when raise_exception then
    if sqlerrm like 'FAALT%' then raise; end if;
  end;
  raise notice 'OK #2g: schrijf_log schrijft inhoudsvrij, valideert fail-closed; beide logs zijn append-only; leespad per fonds.';
end $$;

-- 2h. Onvolledige default laat de fondscreatie FALEN (reviewbesluit R6).
do $$
begin
  update ai_gateway_private.provider_profiel set actief = false where id = 'platform-anthropic';
  begin
    insert into public.fondsen (id, naam, slug) values
      ('a3333333-3333-3333-3333-3333333333a3','Gateway testfonds C','xgw-c');
    raise exception 'FAALT #2h: fondscreatie slaagde ondanks onvolledige standaardconfiguratie';
  exception when raise_exception then
    if sqlerrm like 'FAALT%' then raise; end if;
    if sqlerrm not like '%fondscreatie geweigerd%' then raise exception 'FAALT #2h: onverwachte fout: %', sqlerrm; end if;
  end;
  raise notice 'OK #2h: zonder geldige defaults faalt de fondscreatie; geen stille fallback.';
end $$;

rollback;

\echo '== AI-gateway T2 suite groen =='
