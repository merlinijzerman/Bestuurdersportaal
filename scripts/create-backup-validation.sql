\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

select json_build_object(
  'manifest_version', 1,
  'captured_utc', (clock_timestamp() at time zone 'utc'),
  'postgres_version', current_setting('server_version'),
  'extensions', (
    select coalesce(json_agg(extname order by extname), '[]'::json)
    from pg_extension
  ),
  'auth_users', (select count(*) from auth.users),
  'auth_identities', (select count(*) from auth.identities),
  'storage_buckets', (select count(*) from storage.buckets),
  'storage_objects', (select count(*) from storage.objects),
  'storage_objects_by_bucket', (
    select coalesce(json_object_agg(bucket_id, object_count order by bucket_id), '{}'::json)
    from (
      select bucket_id, count(*) as object_count
      from storage.objects
      group by bucket_id
    ) counts
  ),
  'critical_public_counts', json_build_object(
    'fondsen', (select count(*) from public.fondsen),
    'profielen', (select count(*) from public.profielen),
    'documenten', (select count(*) from public.documenten),
    'document_chunks', (select count(*) from public.document_chunks),
    'governance_log', (select count(*) from public.governance_log),
    'platform_event_log', (select count(*) from public.platform_event_log)
  )
)::text;
