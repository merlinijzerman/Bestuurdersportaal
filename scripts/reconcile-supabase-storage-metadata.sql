\set ON_ERROR_STOP on

-- Fail closed unless the retained snapshot still belongs to this exact
-- source/target pair and covers precisely the same object keys.
begin;

lock table storage.objects in share row exclusive mode;

create temporary table restore_assertion (
  valid boolean not null check (valid)
) on commit drop;

insert into restore_assertion (valid)
select
  count(*) = 1
  and bool_and(source_project_ref = :'source_project_ref')
  and bool_and(target_project_ref = :'target_project_ref')
  and bool_and(
    object_count = (
      select count(*)
      from bestuurdersportaal_restore_private.storage_objects_metadata
    )
  )
from bestuurdersportaal_restore_private.snapshot_state
where contract_version = 1;

truncate restore_assertion;
insert into restore_assertion (valid)
select not exists (
  select 1
  from storage.objects target
  full join bestuurdersportaal_restore_private.storage_objects_metadata source
    using (bucket_id, name)
  where target.bucket_id is null or source.bucket_id is null
);

update storage.objects target
set
  owner = source.owner,
  owner_id = source.owner_id,
  metadata = source.metadata,
  user_metadata = source.user_metadata
from bestuurdersportaal_restore_private.storage_objects_metadata source
where target.bucket_id = source.bucket_id
  and target.name = source.name;

truncate restore_assertion;
insert into restore_assertion (valid)
select not exists (
  select 1
  from storage.objects target
  join bestuurdersportaal_restore_private.storage_objects_metadata source
    using (bucket_id, name)
  where target.owner is distinct from source.owner
     or target.owner_id is distinct from source.owner_id
     or target.metadata is distinct from source.metadata
     or target.user_metadata is distinct from source.user_metadata
);

drop schema bestuurdersportaal_restore_private cascade;

commit;
