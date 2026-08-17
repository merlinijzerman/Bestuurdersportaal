\set ON_ERROR_STOP on
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\pset pager off
\set QUIET 0

select '-- Supabase managed-schema customizations; generated at restore time.';
select '-- This file contains no row data; Auth and Storage data are exported separately.';

-- A new Supabase project owns and initializes the functions and default RLS
-- state in auth/storage. Do not copy those managed internals. Project functions
-- live in application schemas and are already covered by schema.sql. Only the
-- project-defined policies and non-internal triggers below are portable.

-- Policies are emitted as drop/create so a new Supabase project can apply the
-- exact captured state after its managed schemas already exist.
select format(
  'drop policy if exists %I on %I.%I;',
  policyname,
  schemaname,
  tablename
)
|| E'\n'
|| format(
  'create policy %I on %I.%I as %s for %s to %s%s%s;',
  policyname,
  schemaname,
  tablename,
  lower(permissive),
  case cmd
    when 'r' then 'select'
    when 'a' then 'insert'
    when 'w' then 'update'
    when 'd' then 'delete'
    when '*' then 'all'
    else lower(cmd)
  end,
  (
    select string_agg(
      case when role_name = 'public' then 'public' else format('%I', role_name) end,
      ', ' order by role_name
    )
    from unnest(roles) as role_name
  ),
  case when qual is null then '' else format(' using (%s)', qual) end,
  case when with_check is null then '' else format(' with check (%s)', with_check) end
)
from pg_policies
where schemaname in ('auth', 'storage')
order by schemaname, tablename, policyname;

-- User-defined triggers include application hooks such as the auth.users hook.
select format(
  'drop trigger if exists %I on %I.%I;',
  t.tgname,
  n.nspname,
  c.relname
)
|| E'\n'
|| pg_get_triggerdef(t.oid)
|| ';'
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('auth', 'storage')
  and not t.tgisinternal
order by n.nspname, c.relname, t.tgname;
