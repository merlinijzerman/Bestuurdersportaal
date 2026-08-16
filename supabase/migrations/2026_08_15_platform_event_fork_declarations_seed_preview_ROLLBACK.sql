-- De Preview-forkverklaringen zijn append-only incidentbewijs en worden niet
-- verwijderd. Correctie vereist een nieuw, expliciet protocol en geen rollback.

do $$
begin
  raise exception
    'ROLLBACK_GEBLOKKEERD: Preview-forkverklaringen zijn append-only bewijs';
end $$;

