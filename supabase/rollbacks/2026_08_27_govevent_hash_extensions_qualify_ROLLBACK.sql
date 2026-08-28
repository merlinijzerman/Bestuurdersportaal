-- ROLLBACK van 2026_08_27_govevent_hash_extensions_qualify.sql.
-- Herstelt de ONGEKWALIFICEERDE digest()-vorm (de vorige toestand). LET OP: die
-- vorm faalt (42883) zodra governance_events wordt geschreven vanuit een functie
-- met een gepinde search_path zonder 'extensions' — draai deze rollback dus alleen
-- terug als óók de #183b-brontabel-triggers (die zo'n path zetten) zijn verwijderd.
-- De hashuitkomst is identiek aan de forward-vorm (zelfde functie).

begin;

create or replace function public.fn_govevent_hash()
returns trigger
language plpgsql
as $$
begin
  if new.tijdstip is null then new.tijdstip := now(); end if;
  new.hash := encode(
    digest(
      coalesce(new.event_type,'')        || '|' ||
      coalesce(new.decision_id::text,'') || '|' ||
      coalesce(new.object_type,'')       || '|' ||
      coalesce(new.object_id::text,'')   || '|' ||
      coalesce(new.oude_waarde::text,'') || '|' ||
      coalesce(new.nieuwe_waarde::text,'')|| '|' ||
      new.tijdstip::text,
      'sha256'
    ), 'hex'
  );
  return new;
end;
$$;

commit;
