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

-- Ownership-gevoelige statements (RLS aanzetten + grants) draaien ALLEEN in de
-- kale test-container, waar dit script storage.objects zelf aanmaakte en postgres
-- dus de eigenaar is. In de officiële Supabase-stack bezit supabase_storage_admin
-- deze objecten: daar bestaan RLS en grants al en zijn deze statements inert
-- (ongeguard zouden ze 'must be owner of table objects' geven — de reden dat de
-- §15-suite op de CLI-stack rood liep).
do $$
begin
  if to_regclass('storage.objects') is not null and exists (
    select 1 from pg_class c
    where c.oid = to_regclass('storage.objects')
      and c.relowner = (select r.oid from pg_roles r where r.rolname = current_user)
  ) then
    execute 'alter table storage.objects enable row level security';
    execute 'grant usage on schema storage to anon, authenticated, service_role';
    execute 'grant select on table storage.buckets to anon, authenticated, service_role';
    execute 'grant select, insert, update, delete on table storage.objects to anon, authenticated, service_role';
    execute 'grant execute on function storage.foldername(text) to anon, authenticated, service_role';
  end if;
end $$;
