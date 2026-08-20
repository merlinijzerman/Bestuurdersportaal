\set ON_ERROR_STOP on

-- Supabase Storage upserts the database row while it writes the physical
-- object. Preserve the portable source metadata first, so owner/RLS semantics,
-- custom metadata and the original physical metadata can be restored after the
-- bytes are in place. `version` is deliberately not captured: it must continue
-- to identify the newly uploaded physical object.
begin;

create schema bestuurdersportaal_restore_private;
revoke all on schema bestuurdersportaal_restore_private from public;

create table bestuurdersportaal_restore_private.storage_objects_metadata as
select bucket_id, name, owner, owner_id, metadata, user_metadata
from storage.objects;

alter table bestuurdersportaal_restore_private.storage_objects_metadata
  alter column bucket_id set not null,
  alter column name set not null,
  add primary key (bucket_id, name);

create table bestuurdersportaal_restore_private.snapshot_state (
  contract_version integer primary key check (contract_version = 1),
  source_project_ref text not null,
  target_project_ref text not null,
  object_count bigint not null check (object_count >= 0)
);

insert into bestuurdersportaal_restore_private.snapshot_state (
  contract_version,
  source_project_ref,
  target_project_ref,
  object_count
)
select
  1,
  :'source_project_ref',
  :'target_project_ref',
  count(*)
from bestuurdersportaal_restore_private.storage_objects_metadata;

revoke all on all tables in schema bestuurdersportaal_restore_private from public;

commit;
