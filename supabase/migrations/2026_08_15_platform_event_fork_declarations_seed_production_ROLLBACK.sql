-- De Productie-forkverklaring is append-only incidentbewijs en wordt niet
-- verwijderd. Correctie vereist een nieuw, expliciet protocol en geen rollback.

do $$
begin
  raise exception
    'ROLLBACK_GEBLOKKEERD: Productie-forkverklaring is append-only bewijs';
end $$;
