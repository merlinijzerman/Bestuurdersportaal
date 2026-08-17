-- ==========================================================================
-- P1 2026-08-15 — deterministische ketenkop voor platform_event_log
-- --------------------------------------------------------------------------
-- Aanleiding: fn_platform_event_hash leidde de ketenkop af met
--   order by tijdstip desc, id desc.
-- now() is binnen één transactie constant en id is een willekeurige UUID.
-- Daardoor kon een multi-row insert meerdere opvolgers van dezelfde hash
-- maken, ondanks de transactionele advisory lock.
--
-- Oplossing: één apart, vergrendeld state-record is voortaan de autoritatieve
-- ketenkop. De BEFORE ROW-trigger schuift dit record na iedere rij door. De
-- wijziging van state en de eventinsert zitten in dezelfde transactie en
-- rollen dus samen terug bij een fout.
--
-- Bestaande platformevents worden NIET gewijzigd of opnieuw gehasht. Een al
-- bestaande historische vertakking blijft zichtbaar en vereist een apart
-- append-only incident-/checkpointprotocol.
-- ==========================================================================

begin;

create table if not exists public.platform_event_chain_state (
  singleton         boolean primary key default true check (singleton),
  head_hash         text,
  event_count       bigint not null check (event_count >= 0),
  initialized_count bigint not null check (initialized_count >= 0),
  bijgewerkt        timestamptz not null default clock_timestamp()
);

comment on table public.platform_event_chain_state is
  'Autoritatieve, transactioneel vergrendelde ketenkop voor platform_event_log. '
  'Geen auditinhoud; uitsluitend muteerbaar vanuit fn_platform_event_hash.';

alter table public.platform_event_chain_state enable row level security;
-- Ook service_role krijgt geen direct tabelrecht: de state mag uitsluitend via
-- de SECURITY DEFINER-trigger verschuiven. De platformbackend hoeft deze
-- interne tabel nooit rechtstreeks te lezen of te muteren.
revoke all on table public.platform_event_chain_state
  from public, anon, authenticated, service_role;

-- Initialiseer exact eenmaal vanaf een bestaand BLAD. Bij een historische fork
-- kan de oude tijdstip+UUID-sortering ook de fork-parent aanwijzen; daar verder
-- schrijven zou onmiddellijk een nieuwe tak maken. De sortering kiest alleen
-- deterministisch tussen bestaande bladeren en maskeert of herstelt de fork
-- nadrukkelijk niet.
insert into public.platform_event_chain_state (
  singleton, head_hash, event_count, initialized_count, bijgewerkt
)
select
  true,
  (
    select kandidaat.hash
      from public.platform_event_log kandidaat
     where not exists (
       select 1
         from public.platform_event_log kind
        where kind.prev_hash = kandidaat.hash
     )
     order by kandidaat.tijdstip desc, kandidaat.id desc
     limit 1
  ),
  count(*),
  count(*),
  clock_timestamp()
from public.platform_event_log
on conflict (singleton) do nothing;

create or replace function public.fn_platform_event_hash()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $f$
declare
  v_prev_hash   text;
  v_event_count bigint;
begin
  if new.tijdstip is null then
    -- clock_timestamp() kan binnen één transactie per rij verschillen. De
    -- ketenvolgorde hangt hier niet meer van af; dit verbetert alleen diagnose.
    new.tijdstip := clock_timestamp();
  end if;

  -- Serialiseer transacties én vergrendel de enige state-rij. De row lock is
  -- ook de fail-closed garantie dat iedere volgende rij uit hetzelfde
  -- multi-row statement de zojuist berekende hash als voorganger krijgt.
  perform pg_advisory_xact_lock(hashtext('platform_event_log_chain'));

  select head_hash, event_count
    into v_prev_hash, v_event_count
    from public.platform_event_chain_state
   where singleton
   for update;

  if not found then
    raise exception 'PLATFORM_EVENT_CHAIN_STATE_ONTBREEKT';
  end if;

  -- Door de aanroeper meegegeven ketenvelden zijn nooit leidend.
  new.prev_hash := v_prev_hash;
  new.hash := encode(
    extensions.digest(
      coalesce(new.correlatie_id::text,'') || '|' ||
      new.fase                             || '|' ||
      coalesce(new.identity_id::text,'')   || '|' ||
      new.capability                       || '|' ||
      new.handeling                        || '|' ||
      coalesce(new.doel_fonds_id::text,'') || '|' ||
      coalesce(new.doel_object,'')         || '|' ||
      coalesce(new.reden,'')               || '|' ||
      coalesce(new.uitkomst,'')            || '|' ||
      coalesce(new.foutcode,'')             || '|' ||
      coalesce(new.effect::text,'')         || '|' ||
      new.tijdstip::text                    || '|' ||
      coalesce(new.prev_hash,''),
      'sha256'
    ),
    'hex'
  );

  update public.platform_event_chain_state
     set head_hash = new.hash,
         event_count = v_event_count + 1,
         bijgewerkt = clock_timestamp()
   where singleton;

  return new;
end;
$f$;

revoke execute on function public.fn_platform_event_hash()
  from public, anon, authenticated, service_role;

-- De trigger bestond al; opnieuw aanmaken maakt de eindtoestand expliciet en
-- herhaalbaar zonder bestaande eventrijen te raken.
drop trigger if exists trg_platform_event_hash on public.platform_event_log;
create trigger trg_platform_event_hash
  before insert on public.platform_event_log
  for each row execute procedure public.fn_platform_event_hash();

do $$
declare
  v_state_count bigint;
  v_log_count   bigint;
begin
  select event_count into v_state_count
    from public.platform_event_chain_state where singleton;
  select count(*) into v_log_count from public.platform_event_log;

  if v_state_count is distinct from v_log_count then
    raise exception
      'PLATFORM_EVENT_CHAIN_STATE_TELLING_ONGELIJK: state %, log %',
      v_state_count, v_log_count;
  end if;

  if has_table_privilege('service_role', 'public.platform_event_chain_state', 'SELECT')
     or has_table_privilege('service_role', 'public.platform_event_chain_state', 'INSERT')
     or has_table_privilege('service_role', 'public.platform_event_chain_state', 'UPDATE')
     or has_table_privilege('service_role', 'public.platform_event_chain_state', 'DELETE')
     or has_table_privilege('service_role', 'public.platform_event_chain_state', 'TRUNCATE') then
    raise exception 'PLATFORM_EVENT_CHAIN_STATE_DIRECT_SERVICE_ROLE_RECHT';
  end if;
end $$;

commit;

