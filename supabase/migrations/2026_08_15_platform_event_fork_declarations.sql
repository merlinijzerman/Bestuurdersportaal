-- ==========================================================================
-- P1 2026-08-15 — append-only verklaringen voor historische auditforks
-- --------------------------------------------------------------------------
-- Dit register repareert of herschrijft platform_event_log NIET. Het maakt
-- uitsluitend mogelijk om een vooraf onderzochte historische vertakking exact
-- te verklaren. De validator blijft fail-closed voor iedere nieuwe voorganger,
-- ieder extra/ontbrekend kind en iedere andere ketenafwijking.
--
-- Deze generieke migratie bevat bewust GEEN omgevingsspecifieke verklaring.
-- Preview en Productie krijgen ieder pas na inspectie een aparte seed.
-- ==========================================================================

begin;

create table if not exists public.platform_event_fork_declarations (
  fork_prev_hash           text primary key,
  toegestane_child_hashes  text[] not null,
  omgeving                 text not null,
  reden                    text not null,
  bewijs_ref               text not null,
  goedgekeurd_door         text not null,
  goedgekeurd_op           timestamptz not null,
  vastgelegd_op            timestamptz not null default clock_timestamp(),
  constraint chk_pefd_prev_hash
    check (fork_prev_hash ~ '^[0-9a-f]{64}$'),
  constraint chk_pefd_child_count
    check (cardinality(toegestane_child_hashes) >= 2),
  constraint chk_pefd_metadata
    check (
      btrim(omgeving) <> '' and btrim(reden) <> ''
      and btrim(bewijs_ref) <> '' and btrim(goedgekeurd_door) <> ''
    )
);

comment on table public.platform_event_fork_declarations is
  'Append-only allowlist van exact onderzochte historische forks in '
  'platform_event_log. Geen event wordt gewijzigd; afwijkende kindsets blijven rood.';

alter table public.platform_event_fork_declarations enable row level security;
revoke all on table public.platform_event_fork_declarations
  from public, anon, authenticated, service_role;

create or replace function public.fn_platform_event_fork_declaration_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $f$
begin
  raise exception 'platform_event_fork_declarations is append-only';
end;
$f$;

revoke execute on function public.fn_platform_event_fork_declaration_immutable()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_platform_event_fork_declaration_no_update
  on public.platform_event_fork_declarations;
create trigger trg_platform_event_fork_declaration_no_update
  before update on public.platform_event_fork_declarations
  for each row execute procedure public.fn_platform_event_fork_declaration_immutable();

drop trigger if exists trg_platform_event_fork_declaration_no_delete
  on public.platform_event_fork_declarations;
create trigger trg_platform_event_fork_declaration_no_delete
  before delete on public.platform_event_fork_declarations
  for each row execute procedure public.fn_platform_event_fork_declaration_immutable();

create or replace function public.fn_platform_event_chain_assert_valid()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $f$
declare
  v_totaal                  bigint;
  v_hash_mismatch           bigint;
  v_duplicate_hashes        bigint;
  v_roots                   bigint;
  v_missing_links           bigint;
  v_unexplained_forks       bigint;
  v_stale_declarations      bigint;
  v_invalid_declarations    bigint;
  v_state_mismatch          bigint;
begin
  with herberekend as (
    select hash, prev_hash,
      encode(extensions.digest(
        coalesce(correlatie_id::text,'') || '|' ||
        fase                             || '|' ||
        coalesce(identity_id::text,'')   || '|' ||
        capability                       || '|' ||
        handeling                        || '|' ||
        coalesce(doel_fonds_id::text,'') || '|' ||
        coalesce(doel_object,'')         || '|' ||
        coalesce(reden,'')               || '|' ||
        coalesce(uitkomst,'')            || '|' ||
        coalesce(foutcode,'')             || '|' ||
        coalesce(effect::text,'')         || '|' ||
        tijdstip::text                    || '|' ||
        coalesce(prev_hash,''),
        'sha256'
      ), 'hex') as opnieuw
    from public.platform_event_log
  )
  select count(*),
         count(*) filter (where hash <> opnieuw),
         count(*) filter (where prev_hash is null)
    into v_totaal, v_hash_mismatch, v_roots
    from herberekend;

  select coalesce(sum(n - 1), 0)
    into v_duplicate_hashes
    from (
      select count(*) as n
        from public.platform_event_log
       group by hash
      having count(*) > 1
    ) d;

  select count(*)
    into v_missing_links
    from public.platform_event_log e
   where e.prev_hash is not null
     and not exists (
       select 1 from public.platform_event_log p where p.hash = e.prev_hash
     );

  with werkelijke_forks as (
    select prev_hash, array_agg(hash order by hash) as child_hashes
      from public.platform_event_log
     where prev_hash is not null
     group by prev_hash
    having count(*) > 1
  )
  select count(*)
    into v_unexplained_forks
    from werkelijke_forks f
    left join public.platform_event_fork_declarations d
      on d.fork_prev_hash = f.prev_hash
   where d.fork_prev_hash is null
      or d.toegestane_child_hashes is distinct from f.child_hashes;

  with werkelijke_forks as (
    select prev_hash
      from public.platform_event_log
     where prev_hash is not null
     group by prev_hash
    having count(*) > 1
  )
  select count(*)
    into v_stale_declarations
    from public.platform_event_fork_declarations d
    left join werkelijke_forks f on f.prev_hash = d.fork_prev_hash
   where f.prev_hash is null;

  select count(*)
    into v_invalid_declarations
    from public.platform_event_fork_declarations d
   where d.toegestane_child_hashes is distinct from (
     select array_agg(x order by x) from unnest(d.toegestane_child_hashes) x
   )
      or cardinality(d.toegestane_child_hashes) is distinct from (
        select count(distinct x) from unnest(d.toegestane_child_hashes) x
      )
      or exists (
        select 1 from unnest(d.toegestane_child_hashes) x
         where x !~ '^[0-9a-f]{64}$'
      );

  select count(*)
    into v_state_mismatch
    from public.platform_event_chain_state s
   where s.singleton
     and (
       s.event_count <> v_totaal
       or (v_totaal = 0 and s.head_hash is not null)
       or (v_totaal > 0 and (
         not exists (
           select 1 from public.platform_event_log h where h.hash = s.head_hash
         )
         or exists (
           select 1 from public.platform_event_log kind
            where kind.prev_hash = s.head_hash
         )
       ))
     );

  if v_hash_mismatch <> 0
     or v_duplicate_hashes <> 0
     or ((v_totaal = 0 and v_roots <> 0) or (v_totaal > 0 and v_roots <> 1))
     or v_missing_links <> 0
     or v_unexplained_forks <> 0
     or v_stale_declarations <> 0
     or v_invalid_declarations <> 0
     or v_state_mismatch <> 0 then
    raise exception
      'PLATFORM_EVENT_CHAIN_ONGELDIG: totaal %, hash %, dubbel %, roots %, links %, forks %, stale %, declaraties %, state %',
      v_totaal, v_hash_mismatch, v_duplicate_hashes, v_roots,
      v_missing_links, v_unexplained_forks, v_stale_declarations,
      v_invalid_declarations, v_state_mismatch;
  end if;
end;
$f$;

revoke execute on function public.fn_platform_event_chain_assert_valid()
  from public, anon, authenticated, service_role;

do $$
begin
  if has_table_privilege('service_role', 'public.platform_event_fork_declarations', 'SELECT')
     or has_table_privilege('service_role', 'public.platform_event_fork_declarations', 'INSERT')
     or has_table_privilege('service_role', 'public.platform_event_fork_declarations', 'UPDATE')
     or has_table_privilege('service_role', 'public.platform_event_fork_declarations', 'DELETE') then
    raise exception 'PLATFORM_EVENT_FORK_DECLARATIONS_DIRECT_SERVICE_ROLE_RECHT';
  end if;
end $$;

commit;

