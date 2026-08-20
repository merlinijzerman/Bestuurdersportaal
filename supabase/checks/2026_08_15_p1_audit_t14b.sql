-- P1 2026-08-15 — gerichte eindcontrole auditketenkop + T14b-drift.
--
-- Vereist de twee 2026_08_15-migraties. De controle wijzigt geen blijvende
-- data. De T14b-negatieve test gebruikt een bestaande beheerderidentiteit,
-- maar toont of bewaart die identiteit niet en faalt vóór iedere schrijftak.

do $$
declare
  v_capture_ok boolean;
  v_policy_ok  boolean;
  v_rpc_ok     boolean;
  v_anon_exec  boolean;
  v_auth_exec  boolean;
  v_chain_ok   boolean;
  v_state_direct_service_role boolean;
  v_fork_registry_ok boolean;
  v_fork_registry_direct_service_role boolean;
begin
  select
    count(*) = 1
    and bool_and(
      pg_get_functiondef(p.oid) ilike '%platform_event_chain_state%'
      and pg_get_functiondef(p.oid) ilike '%for update%'
      and pg_get_functiondef(p.oid) not ilike '%order by tijdstip desc, id desc%'
    )
    into v_chain_ok
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_platform_event_hash';

  select
    has_table_privilege('service_role', 'public.platform_event_chain_state', 'SELECT')
    or has_table_privilege('service_role', 'public.platform_event_chain_state', 'INSERT')
    or has_table_privilege('service_role', 'public.platform_event_chain_state', 'UPDATE')
    or has_table_privilege('service_role', 'public.platform_event_chain_state', 'DELETE')
    or has_table_privilege('service_role', 'public.platform_event_chain_state', 'TRUNCATE')
    into v_state_direct_service_role;

  select
    to_regclass('public.platform_event_fork_declarations') is not null
    and to_regprocedure('public.fn_platform_event_chain_assert_valid()') is not null
    into v_fork_registry_ok;

  select
    has_table_privilege('service_role', 'public.platform_event_fork_declarations', 'SELECT')
    or has_table_privilege('service_role', 'public.platform_event_fork_declarations', 'INSERT')
    or has_table_privilege('service_role', 'public.platform_event_fork_declarations', 'UPDATE')
    or has_table_privilege('service_role', 'public.platform_event_fork_declarations', 'DELETE')
    into v_fork_registry_direct_service_role;

  select coalesce(bool_or(
    pg_get_functiondef(p.oid) ~* 'to_jsonb\(new\)[[:space:]]*-[[:space:]]*''bijgewerkt'''
  ), false)
    into v_capture_ok
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_fonds_stuurinfo_capture';

  select coalesce(bool_or(
    pg_get_expr(pol.polwithcheck, pol.polrelid) ilike '%gebruiker_id%'
    and pg_get_expr(pol.polwithcheck, pol.polrelid) ilike '%auth.uid()%'
  ), false)
    into v_policy_ok
    from pg_policy pol
   where pol.polrelid = 'public.fonds_stuurinfo_log'::regclass
     and pol.polname = 'stuurinfo log schrijven priv';

  select
    coalesce(bool_or(
      pg_get_functiondef(p.oid) ilike '%jsonb_typeof%'
      and pg_get_functiondef(p.oid) ilike '%ONGELDIGE_WAARDE%'
    ), false),
    coalesce(bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), false),
    coalesce(bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')), false)
    into v_rpc_ok, v_anon_exec, v_auth_exec
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'stuurinfo_balans_opslaan';

  if not v_chain_ok or v_state_direct_service_role
     or not v_fork_registry_ok or v_fork_registry_direct_service_role
     or not v_capture_ok or not v_policy_ok or not v_rpc_ok
     or v_anon_exec or not v_auth_exec then
    raise exception
      'P1 CATALOGUSGATE ROOD: chain %, state_service %, fork_registry %, fork_service %, capture %, policy %, rpc %, anon %, auth %',
      v_chain_ok, v_state_direct_service_role, v_fork_registry_ok,
      v_fork_registry_direct_service_role, v_capture_ok, v_policy_ok,
      v_rpc_ok, v_anon_exec, v_auth_exec;
  end if;

  perform public.fn_platform_event_chain_assert_valid();

  raise notice
    'P1 catalogusgate groen: ketenkop, forkverklaringen en T14b-eindstaat aanwezig.';
end $$;

do $$
declare
  v_uid uuid;
begin
  select id into v_uid
    from public.profielen
   where rol in ('voorzitter', 'beheerder')
   order by id
   limit 1;

  if v_uid is null then
    raise exception 'P1 T14b-testvoorwaarde ontbreekt: geen beheerder/voorzitter';
  end if;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);

  begin
    perform public.stuurinfo_balans_opslaan(
      '2026Q1', date '2026-03-31', 'handmatig', 'handmatig',
      '{"belegd":null,"overig":0}'::jsonb,
      '{"ev_toets_mvev":0,"ev_toets_oper":0,"ev_toets_overig":0,"ev_soli":0,"ev_comp":0,"tv":0,"vuk":0,"overig":0}'::jsonb,
      '[]'::jsonb,
      100
    );
    raise exception 'P1 T14b ROOD: JSON-null werd geaccepteerd';
  exception
    when others then
      if sqlerrm <> 'ONGELDIGE_WAARDE' then
        raise;
      end if;
  end;

  raise notice 'P1 T14b groen: JSON-null geweigerd met ONGELDIGE_WAARDE.';
end $$;
