-- Rollback van 2026_08_15_platform_event_chain_head.sql.
--
-- Fail-closed: rollback is alleen veilig zolang sinds initialisatie geen nieuw
-- platformevent is toegevoegd. Anders zou terugkeer naar tijdstip+UUID de
-- ketengarantie opnieuw verzwakken en de actuele state verliezen.

begin;

do $$
declare
  v_event_count       bigint;
  v_initialized_count bigint;
begin
  select event_count, initialized_count
    into v_event_count, v_initialized_count
    from public.platform_event_chain_state
   where singleton;

  if not found then
    raise exception 'ROLLBACK_GEBLOKKEERD: platform_event_chain_state ontbreekt';
  end if;

  if v_event_count <> v_initialized_count then
    raise exception
      'ROLLBACK_GEBLOKKEERD: % nieuw(e) platformevent(s) sinds migratie',
      v_event_count - v_initialized_count;
  end if;
end $$;

create or replace function public.fn_platform_event_hash()
returns trigger language plpgsql as $f$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;

  perform pg_advisory_xact_lock(hashtext('platform_event_log_chain'));

  new.prev_hash := (
    select hash from public.platform_event_log
    order by tijdstip desc, id desc
    limit 1
  );

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
    ), 'hex'
  );
  return new;
end;
$f$;

drop table public.platform_event_chain_state;

commit;

