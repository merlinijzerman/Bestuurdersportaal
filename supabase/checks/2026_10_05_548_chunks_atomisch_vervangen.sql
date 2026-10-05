-- #548 — read-only controle na 2026_10_05_548_chunks_atomisch_vervangen.sql.
-- Verwacht: één rij per controle met ok = true.
select 'bestaat' as controle,
       to_regprocedure('public.fn_document_chunks_vervangen(uuid,jsonb)') is not null as ok
union all
select 'security invoker',
       not p.prosecdef
  from pg_proc p
 where p.oid = to_regprocedure('public.fn_document_chunks_vervangen(uuid,jsonb)')
union all
select 'statement_timeout 120s',
       coalesce('statement_timeout=120s' = any (p.proconfig), false)
  from pg_proc p
 where p.oid = to_regprocedure('public.fn_document_chunks_vervangen(uuid,jsonb)')
union all
select 'search_path vast',
       coalesce(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'), false)
  from pg_proc p
 where p.oid = to_regprocedure('public.fn_document_chunks_vervangen(uuid,jsonb)')
union all
select 'anon geen execute',
       not has_function_privilege('anon', 'public.fn_document_chunks_vervangen(uuid,jsonb)', 'execute')
union all
select 'authenticated execute',
       has_function_privilege('authenticated', 'public.fn_document_chunks_vervangen(uuid,jsonb)', 'execute')
union all
select 'service_role execute',
       has_function_privilege('service_role', 'public.fn_document_chunks_vervangen(uuid,jsonb)', 'execute');
