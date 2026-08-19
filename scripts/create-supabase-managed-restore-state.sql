\set ON_ERROR_STOP on

create schema if not exists bestuurdersportaal_managed_restore_private;
revoke all on schema bestuurdersportaal_managed_restore_private from public, anon, authenticated, service_role;

create table if not exists bestuurdersportaal_managed_restore_private.resume_state (
  singleton boolean primary key default true check (singleton),
  contract_version integer not null check (contract_version = 1),
  source_project_ref text not null check (source_project_ref ~ '^[a-z]{20}$'),
  target_project_ref text not null check (target_project_ref ~ '^[a-z]{20}$'),
  backup_marker_key text not null,
  database_sha256 text not null check (database_sha256 ~ '^[0-9a-f]{64}$'),
  phase text not null check (phase in (
    'database_restored', 'storage_restored', 'technical_verified', 'functional_verified'
  )),
  updated_at timestamptz not null default clock_timestamp()
);
revoke all on bestuurdersportaal_managed_restore_private.resume_state
  from public, anon, authenticated, service_role;

insert into bestuurdersportaal_managed_restore_private.resume_state (
  singleton,
  contract_version,
  source_project_ref,
  target_project_ref,
  backup_marker_key,
  database_sha256,
  phase
) values (
  true,
  1,
  :'restore_source_project_ref',
  :'restore_target_project_ref',
  :'restore_backup_marker_key',
  :'restore_database_sha256',
  'database_restored'
);
