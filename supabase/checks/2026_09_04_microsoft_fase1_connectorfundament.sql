-- Structureel en least-privilege bewijs voor Microsoft 365 fase 1.
-- Uitvoeren als database-eigenaar na de migratie en vóór activering van de pilotflag.
-- ROL: postgres/database-eigenaar; de suite moet rol-, schema-, ACL-, policy- en
-- catalogusmetadata over alle betrokken rollen kunnen beoordelen.

do $controle$
declare
  fouten text := '';
  v_secdef_count integer;
  v_vault_exec_count integer;
begin
  if not exists (
    select 1 from pg_roles
    where rolname = 'microsoft_vault'
      and rolcanlogin
      and not rolinherit
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolreplication
      and not rolbypassrls
      and rolconnlimit between 1 and 5
  ) then
    fouten := fouten || E'\n- microsoft_vault is niet de vereiste minimale loginrol';
  end if;

  if not has_schema_privilege('microsoft_vault', 'microsoft_private', 'USAGE') then
    fouten := fouten || E'\n- microsoft_vault mist USAGE op microsoft_private';
  end if;
  if has_schema_privilege('anon', 'microsoft_private', 'USAGE')
     or has_schema_privilege('authenticated', 'microsoft_private', 'USAGE') then
    fouten := fouten || E'\n- browserrol heeft USAGE op microsoft_private';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'microsoft_private'
      and c.relkind in ('r','p','v','m','S','f')
      and (
        has_table_privilege('microsoft_vault', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      )
  ) then
    fouten := fouten || E'\n- vault- of browserrol heeft directe tabelrechten in microsoft_private';
  end if;

  select count(*) into v_secdef_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'microsoft_private' and p.prosecdef;
  if v_secdef_count <> 9 then
    fouten := fouten || format(E'\n- verwacht 9 private SECURITY DEFINER-functies, gevonden %s', v_secdef_count);
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'microsoft_private'
      and p.prosecdef
      and not coalesce(array_to_string(p.proconfig, ',') ~ 'search_path=microsoft_private, public, pg_temp$', false)
  ) then
    fouten := fouten || E'\n- private SECURITY DEFINER mist gepinde search_path met pg_temp als laatste';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'microsoft_private'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    fouten := fouten || E'\n- browserrol kan een private functie uitvoeren';
  end if;

  select count(*) into v_vault_exec_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'microsoft_private'
    and has_function_privilege('microsoft_vault', p.oid, 'EXECUTE');
  if v_vault_exec_count <> 9 then
    fouten := fouten || format(E'\n- microsoft_vault mag niet exact de 9 private functies uitvoeren (gevonden %s)', v_vault_exec_count);
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'fonds_integratie_profielen'
      and c.relrowsecurity
  ) then
    fouten := fouten || E'\n- fonds_integratie_profielen ontbreekt of RLS staat uit';
  end if;

  if has_table_privilege('anon', 'public.fonds_integratie_profielen', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.fonds_integratie_profielen', 'INSERT,UPDATE,DELETE')
     or not has_table_privilege('authenticated', 'public.fonds_integratie_profielen', 'SELECT') then
    fouten := fouten || E'\n- public fondsprofielgrants wijken af van authenticated read-only';
  end if;

  if exists (
    select 1 from public.fondsen f
    left join public.fonds_integratie_profielen i on i.fonds_id = f.id
    where i.fonds_id is null or i.integratieprofiel not in ('eigen','microsoft')
  ) then
    fouten := fouten || E'\n- niet ieder fonds heeft precies één geldig integratieprofiel';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_fonds_integratieprofiel_standaard' and not tgisinternal
  ) then
    fouten := fouten || E'\n- fail-safe profieltrigger voor nieuwe fondsen ontbreekt';
  end if;

  if fouten <> '' then
    raise exception 'Microsoft fase 1 databasecontract faalt:%', fouten;
  end if;
  raise notice 'Microsoft fase 1 databasecontract OK: private schema, 9 functies, minimale vaultrol en fondsprofielen.';
end $controle$;
