-- Rollback van 2026_08_15_platform_event_fork_declarations.sql.
-- Fail-closed: een eenmaal vastgelegde append-only forkverklaring mag niet
-- worden verwijderd. De rollback kan alleen vóór de eerste verklaring.

begin;

do $$
begin
  if exists (select 1 from public.platform_event_fork_declarations) then
    raise exception
      'ROLLBACK_GEBLOKKEERD: append-only forkverklaring(en) aanwezig';
  end if;
end $$;

drop function public.fn_platform_event_chain_assert_valid();
drop table public.platform_event_fork_declarations;
drop function public.fn_platform_event_fork_declaration_immutable();

commit;

