\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

select '-- Supabase managed-schema customizations; generated at restore time.';
select '-- This file contains no row data; Auth and Storage data are exported separately.';

-- Custom functions in managed schemas. pg_get_functiondef emits CREATE OR REPLACE.
select pg_get_functiondef(p.oid) || E'\n'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('auth', 'storage')
  and p.prokind in ('f', 'p')
order by n.nspname, p.proname, p.oid;

-- Preserve RLS state for managed tables without copying the managed table DDL.
select format(
  'alter table %I.%I %s row level security;',
  n.nspname,
  c.relname,
  case when c.relforcerowsecurity then 'force' else 'enable' end
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('auth', 'storage')
  and c.relkind in ('r', 'p')
  and c.relrowsecurity
order by n.nspname, c.relname;

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
