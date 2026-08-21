-- V3 allowlist generator — emits the canonical TSV to stdout.
-- Run against the CLEAN migration stand (baseline + all post-cutoff migrations,
-- incl. C-01 cleanup and V3 MAINTAIN-revoke). Output = supabase/checks/allowlist-grants.tsv.
copy (
  with rollen(rol) as (values ('anon'),('authenticated'),('service_role')),
  privs(p, ord) as (values
    ('SELECT',1),('INSERT',2),('UPDATE',3),('DELETE',4),
    ('TRUNCATE',5),('REFERENCES',6),('TRIGGER',7),('MAINTAIN',8)),
  rel as (
    select n.nspname::text sch, c.oid, c.relname::text obj,
           case c.relkind when 'r' then 'table' when 'p' then 'partitioned table'
                when 'v' then 'view' when 'm' then 'materialized view'
                when 'f' then 'foreign table' end klasse
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname in ('public','storage') and c.relkind in ('r','p','v','m','f')
  ),
  rel_rows as (
    select 'REL' sectie, rel.sch, rel.obj, rel.klasse, r.rol,
           coalesce((select string_agg(privs.p, ',' order by privs.ord)
                       from privs where has_table_privilege(r.rol, rel.oid, privs.p)), '-') rechten
      from rel cross join rollen r
  ),
  fn as (
    select n.nspname::text sch, p.oid,
           (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text obj
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname in ('public','storage')
       and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  ),
  fn_rows as (
    select 'FUNC' sectie, fn.sch, fn.obj, 'function' klasse, r.rol,
           case when has_function_privilege(r.rol, fn.oid, 'EXECUTE') then 'EXECUTE' else '-' end rechten
      from fn cross join rollen r
  ),
  bucket_rows as (
    select 'BUCKET' sectie, 'storage' sch, b.id obj, 'bucket' klasse, '-' rol,
           case when b.public then 'public=true' else 'public=false' end rechten
      from storage.buckets b
  ),
  stgpol_rows as (
    select 'STGPOL' sectie, p.schemaname sch,
           p.tablename || ' :: ' || p.policyname obj, 'policy' klasse,
           array_to_string(p.roles, ',') rol, p.cmd rechten
      from pg_policies p where p.schemaname='storage'
  )
  select sectie, sch, obj, klasse, rol, rechten
    from (select * from rel_rows union all select * from fn_rows
          union all select * from bucket_rows union all select * from stgpol_rows) alles
   order by sectie, sch, obj, rol
) to stdout with (format csv, delimiter E'\t', header true);
