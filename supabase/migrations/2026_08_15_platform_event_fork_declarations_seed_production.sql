-- ==========================================================================
-- ALLEEN PRODUCTIE: append-only verklaring van één bestaande auditfork
-- Project: aebwiufuegsiwhwpdrfb
--
-- NOOIT op Preview of een generieke testdatabase uitvoeren. Alleen uitvoeren
-- na de generieke ketenkop- en forkregistermigraties, een verse back-up/
-- restoretest en Merlins expliciete Productie-go/no-go. Vanaf Huisartsen-live
-- is daarnaast Roberts tweede goedkeuring verplicht.
--
-- De exacte forkset is op 2026-08-15 read-only uit Productie gelezen. Deze
-- migratie wijzigt geen bestaand event of hash; zij voegt uitsluitend één
-- append-only bewijsdeclaratie toe.
-- ==========================================================================

begin;

do $$
declare
  v_event_count      bigint;
  v_hash_mismatches  bigint;
  v_roots            bigint;
  v_missing_links    bigint;
  v_duplicate_hashes bigint;
  v_fork_afwijkingen bigint;
begin
  with herberekend as (
    select
      e.hash,
      e.prev_hash,
      encode(extensions.digest(
        coalesce(e.correlatie_id::text,'') || '|' ||
        e.fase                             || '|' ||
        coalesce(e.identity_id::text,'')   || '|' ||
        e.capability                       || '|' ||
        e.handeling                        || '|' ||
        coalesce(e.doel_fonds_id::text,'') || '|' ||
        coalesce(e.doel_object,'')         || '|' ||
        coalesce(e.reden,'')               || '|' ||
        coalesce(e.uitkomst,'')            || '|' ||
        coalesce(e.foutcode,'')             || '|' ||
        coalesce(e.effect::text,'')         || '|' ||
        e.tijdstip::text                    || '|' ||
        coalesce(e.prev_hash,''),
        'sha256'
      ), 'hex') as opnieuw
    from public.platform_event_log e
  )
  select
    count(*),
    count(*) filter (where hash <> opnieuw),
    count(*) filter (where prev_hash is null),
    count(*) - count(distinct hash)
    into v_event_count, v_hash_mismatches, v_roots, v_duplicate_hashes
    from herberekend;

  select count(*)
    into v_missing_links
    from public.platform_event_log e
   where e.prev_hash is not null
     and not exists (
       select 1 from public.platform_event_log p where p.hash = e.prev_hash
     );

  with verwacht(fork_prev_hash, child_hashes) as (values
    (
      '167bee7d46a34c1e7d0fa8ab22b1c8aeee23d3a6587bb3a57fcfc7e763b20ef6'::text,
      array[
        '50386262f5eba873bad593092f7dfeef8b4b62c6846f1e1d27c67ca0f9714217',
        'c3ab609ac1b4e57c4c5475d83a567a8e0aec9803d2a58c6f649989929bbd3b5e',
        'dc032d651ebd5be97a8cb3faa94bbac10f98ba84d8c08731d01692c717eff308',
        'fa42d6df4eb1535d1bfc3c2ad69e2a15a74f2c329ab7c9c88147b76b0c19f7dc'
      ]::text[]
    )
  ), werkelijk as (
    select prev_hash as fork_prev_hash, array_agg(hash order by hash) as child_hashes
      from public.platform_event_log
     where prev_hash is not null
     group by prev_hash
    having count(*) > 1
  )
  select count(*)
    into v_fork_afwijkingen
    from verwacht e
    full join werkelijk w using (fork_prev_hash)
   where e.fork_prev_hash is null
      or w.fork_prev_hash is null
      or e.child_hashes is distinct from w.child_hashes;

  if v_event_count <> 272
     or v_hash_mismatches <> 0
     or v_roots <> 1
     or v_missing_links <> 0
     or v_duplicate_hashes <> 0
     or v_fork_afwijkingen <> 0 then
    raise exception
      'PRODUCTIE_FORKVERKLARING_GEWEIGERD: count %, mismatch %, roots %, missing %, duplicates %, forkafwijkingen %',
      v_event_count, v_hash_mismatches, v_roots, v_missing_links,
      v_duplicate_hashes, v_fork_afwijkingen;
  end if;
end $$;

insert into public.platform_event_fork_declarations (
  fork_prev_hash, toegestane_child_hashes, omgeving, reden, bewijs_ref,
  goedgekeurd_door, goedgekeurd_op
) values (
  '167bee7d46a34c1e7d0fa8ab22b1c8aeee23d3a6587bb3a57fcfc7e763b20ef6',
  array[
    '50386262f5eba873bad593092f7dfeef8b4b62c6846f1e1d27c67ca0f9714217',
    'c3ab609ac1b4e57c4c5475d83a567a8e0aec9803d2a58c6f649989929bbd3b5e',
    'dc032d651ebd5be97a8cb3faa94bbac10f98ba84d8c08731d01692c717eff308',
    'fa42d6df4eb1535d1bfc3c2ad69e2a15a74f2c329ab7c9c88147b76b0c19f7dc'
  ],
  'Productie aebwiufuegsiwhwpdrfb',
  'Historische multi-row-fork van vóór de deterministische ketenkop; events blijven ongewijzigd.',
  'P1 herstelticket Productie-auditketen en T14b-drift, Productiebewijs 2026-08-15',
  'Merlin',
  clock_timestamp()
)
on conflict (fork_prev_hash) do nothing;

select public.fn_platform_event_chain_assert_valid();

commit;
