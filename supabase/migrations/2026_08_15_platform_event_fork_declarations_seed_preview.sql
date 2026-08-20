-- ==========================================================================
-- ALLEEN PREVIEW: append-only verklaring van twee bestaande auditforks
-- Project: bestuurdersportaal-preview (swviwoytzvaqypieqgji)
--
-- NOOIT op Productie uitvoeren. Productie heeft een andere historische
-- structuur en vereist een afzonderlijk, door Merlin goedgekeurd bewijsrecord.
-- De exacte hashes hieronder zijn op 2026-08-15 read-only uit Preview gelezen.
-- ==========================================================================

begin;

do $$
declare
  v_afwijkingen bigint;
begin
  with verwacht(fork_prev_hash, child_hashes) as (values
    (
      '39786ad8b7848d1dfbeecf25eca2311224ddc79fd115b39bbc06a9e46647a0cc'::text,
      array[
        '218568207b0faa98017072d9a22315507fbcdbce624b9ec0c0d71d971be950fc',
        'b43e3cb5296f69d63cbd0dcf1988a7b3db17eccfac6d20749ece9ab2c9aa59ab'
      ]::text[]
    ),
    (
      'b43e3cb5296f69d63cbd0dcf1988a7b3db17eccfac6d20749ece9ab2c9aa59ab'::text,
      array[
        'b396af99a26f66081ca93dff20bf21f0c0b254125f15b69d398029101bc8e00d',
        'cd468c41d762020731f45f291a482e42981402a0cff8b71dd4f77f7d99be8af8'
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
    into v_afwijkingen
    from verwacht e
    full join werkelijk w using (fork_prev_hash)
   where e.fork_prev_hash is null
      or w.fork_prev_hash is null
      or e.child_hashes is distinct from w.child_hashes;

  if v_afwijkingen <> 0 then
    raise exception
      'PREVIEW_FORKVERKLARING_GEWEIGERD: werkelijke forkset wijkt af van bewijs';
  end if;
end $$;

insert into public.platform_event_fork_declarations (
  fork_prev_hash, toegestane_child_hashes, omgeving, reden, bewijs_ref,
  goedgekeurd_door, goedgekeurd_op
) values
  (
    '39786ad8b7848d1dfbeecf25eca2311224ddc79fd115b39bbc06a9e46647a0cc',
    array[
      '218568207b0faa98017072d9a22315507fbcdbce624b9ec0c0d71d971be950fc',
      'b43e3cb5296f69d63cbd0dcf1988a7b3db17eccfac6d20749ece9ab2c9aa59ab'
    ],
    'Preview swviwoytzvaqypieqgji',
    'Historische multi-row-fork van vóór de deterministische ketenkop; events blijven ongewijzigd.',
    'P1 herstelticket Productie-auditketen en T14b-drift, Previewbewijs 2026-08-15',
    'Merlin',
    clock_timestamp()
  ),
  (
    'b43e3cb5296f69d63cbd0dcf1988a7b3db17eccfac6d20749ece9ab2c9aa59ab',
    array[
      'b396af99a26f66081ca93dff20bf21f0c0b254125f15b69d398029101bc8e00d',
      'cd468c41d762020731f45f291a482e42981402a0cff8b71dd4f77f7d99be8af8'
    ],
    'Preview swviwoytzvaqypieqgji',
    'Historische multi-row-fork van vóór de deterministische ketenkop; events blijven ongewijzigd.',
    'P1 herstelticket Productie-auditketen en T14b-drift, Previewbewijs 2026-08-15',
    'Merlin',
    clock_timestamp()
  )
on conflict (fork_prev_hash) do nothing;

select public.fn_platform_event_chain_assert_valid();

commit;
