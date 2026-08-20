-- Minimale Supabase Storage-systeembaseline voor een losse, EPHEMERAL
-- Postgres-testcontainer. NOOIT als applicatiemigratie op Preview/Productie
-- uitvoeren. In de officiële Supabase-stack bestaan deze objecten al en zijn
-- alle statements door IF NOT EXISTS/no-op guards inert.
--
-- Alleen de kolommen, grants en foldername-helper die de cross-tenanttests
-- gebruiken zijn opgenomen. Applicatiespecifieke buckets en policies staan in
-- 2026_08_14_storage_custom.sql en blijven de bron van waarheid.

create schema if not exists storage;

do $$
begin
  if to_regclass('storage.buckets') is null then
    execute $sql$
      create table storage.buckets (
        id                 text primary key,
        name               text not null unique,
        public             boolean not null default false,
        file_size_limit    bigint,
        allowed_mime_types text[],
        created_at         timestamptz not null default now(),
        updated_at         timestamptz not null default now()
      )
    $sql$;
    execute 'alter table storage.buckets owner to postgres';
  end if;

  if to_regclass('storage.objects') is null then
    execute $sql$
      create table storage.objects (
        id               uuid primary key default gen_random_uuid(),
        bucket_id        text references storage.buckets(id),
        name             text,
        owner            uuid,
        metadata         jsonb,
        created_at       timestamptz not null default now(),
        updated_at       timestamptz not null default now(),
        last_accessed_at timestamptz not null default now()
      )
    $sql$;
    execute 'alter table storage.objects owner to postgres';
  end if;
end $$;

alter table storage.objects enable row level security;

do $$
begin
  if to_regprocedure('storage.foldername(text)') is null then
    execute $sql$
      create function storage.foldername(name text)
      returns text[]
      language sql
      immutable
      strict
      as $body$
        select case
          when cardinality(string_to_array(name, '/')) <= 1 then array[]::text[]
          else (string_to_array(name, '/'))[1:cardinality(string_to_array(name, '/')) - 1]
        end
      $body$
    $sql$;
  end if;
end $$;

grant usage on schema storage to anon, authenticated, service_role;
grant select on table storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on table storage.objects
  to anon, authenticated, service_role;
grant execute on function storage.foldername(text)
  to anon, authenticated, service_role;
