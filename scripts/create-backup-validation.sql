\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

-- All hashes are calculated inside PostgreSQL. No row values or secrets are
-- written to the validation artifact.
with policy_hashes as (
  select
    schemaname as schema_name,
    tablename as table_name,
    policyname as object_name,
    encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'permissive', permissive,
            'roles', (select array_agg(role_name order by role_name) from unnest(roles) role_name),
            'cmd', cmd,
            'qual', qual,
            'with_check', with_check
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as sha256
  from pg_policies
  where schemaname in ('public', 'auth', 'storage')
), trigger_hashes as (
  select
    namespace.nspname as schema_name,
    relation.relname as table_name,
    trigger.tgname as object_name,
    encode(
      extensions.digest(convert_to(pg_get_triggerdef(trigger.oid, true), 'UTF8'), 'sha256'),
      'hex'
    ) as sha256
  from pg_trigger trigger
  join pg_class relation on relation.oid = trigger.tgrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  join pg_proc trigger_function on trigger_function.oid = trigger.tgfoid
  join pg_namespace function_namespace on function_namespace.oid = trigger_function.pronamespace
  where (
      namespace.nspname = 'public'
      or (namespace.nspname in ('auth', 'storage') and function_namespace.nspname = 'public')
    )
    and not trigger.tgisinternal
)
select json_build_object(
  'manifest_version', 2,
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
  ),
  'content_sha256', json_build_object(
    'auth_users', (
      select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8'), 'sha256'), 'hex')
      from (
        select encode(extensions.digest(convert_to(to_jsonb(row_value)::text, 'UTF8'), 'sha256'), 'hex') as row_hash
        from auth.users row_value
      ) hashed
    ),
    'auth_identities', (
      select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8'), 'sha256'), 'hex')
      from (
        select encode(extensions.digest(convert_to(to_jsonb(row_value)::text, 'UTF8'), 'sha256'), 'hex') as row_hash
        from auth.identities row_value
      ) hashed
    ),
    'storage_buckets', (
      select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8'), 'sha256'), 'hex')
      from (
        select encode(
          extensions.digest(
            convert_to(
              jsonb_build_object(
                'id', row_value.id,
                'name', row_value.name,
                'public', row_value.public,
                'file_size_limit', row_value.file_size_limit,
                'allowed_mime_types', row_value.allowed_mime_types
              )::text,
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ) as row_hash
        from storage.buckets row_value
      ) hashed
    ),
    'storage_objects', (
      select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8'), 'sha256'), 'hex')
      from (
        select encode(
          extensions.digest(
            convert_to(
              jsonb_build_object(
                'bucket_id', row_value.bucket_id,
                'name', row_value.name,
                'owner', row_value.owner,
                'metadata', row_value.metadata
              )::text,
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ) as row_hash
        from storage.objects row_value
      ) hashed
    ),
    'critical_public', json_build_object(
      'fondsen', (
        select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8'), 'sha256'), 'hex')
        from (select encode(extensions.digest(convert_to(to_jsonb(row_value)::text, 'UTF8'), 'sha256'), 'hex') row_hash from public.fondsen row_value) hashed
      ),
      'profielen', (
        select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8'), 'sha256'), 'hex')
        from (select encode(extensions.digest(convert_to(to_jsonb(row_value)::text, 'UTF8'), 'sha256'), 'hex') row_hash from public.profielen row_value) hashed
      ),
      'documenten', (
        select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8'), 'sha256'), 'hex')
        from (select encode(extensions.digest(convert_to(to_jsonb(row_value)::text, 'UTF8'), 'sha256'), 'hex') row_hash from public.documenten row_value) hashed
      ),
      'document_chunks', (
        select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8'), 'sha256'), 'hex')
        from (select encode(extensions.digest(convert_to(to_jsonb(row_value)::text, 'UTF8'), 'sha256'), 'hex') row_hash from public.document_chunks row_value) hashed
      ),
      'governance_log', (
        select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8'), 'sha256'), 'hex')
        from (select encode(extensions.digest(convert_to(to_jsonb(row_value)::text, 'UTF8'), 'sha256'), 'hex') row_hash from public.governance_log row_value) hashed
      ),
      'platform_event_log', (
        select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8'), 'sha256'), 'hex')
        from (select encode(extensions.digest(convert_to(to_jsonb(row_value)::text, 'UTF8'), 'sha256'), 'hex') row_hash from public.platform_event_log row_value) hashed
      )
    )
  ),
  'policies', (
    select coalesce(
      json_agg(
        json_build_object('schema', schema_name, 'table', table_name, 'name', object_name, 'sha256', sha256)
        order by schema_name, table_name, object_name
      ),
      '[]'::json
    )
    from policy_hashes
  ),
  'triggers', (
    select coalesce(
      json_agg(
        json_build_object('schema', schema_name, 'table', table_name, 'name', object_name, 'sha256', sha256)
        order by schema_name, table_name, object_name
      ),
      '[]'::json
    )
    from trigger_hashes
  )
)::text;
