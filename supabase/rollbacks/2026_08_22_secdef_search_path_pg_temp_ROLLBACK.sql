-- ============================================================================
-- ROLLBACK van 2026_08_22_secdef_search_path_pg_temp.sql
-- ----------------------------------------------------------------------------
-- Verwijdert de toegevoegde `, pg_temp` weer uit de search_path van elke
-- SECURITY-DEFINER-functie in public die er op eindigt.
--
-- LET OP: dit hérstelt de zwakte. Zonder pg_temp in de search_path doorzoekt
-- Postgres het tijdelijke schema als eerste voor relatienamen. Draai dit alleen
-- als de migratie aantoonbaar iets breekt, en noteer waarom.
-- ============================================================================

begin;

do $rollback$
declare
  r        record;
  v_huidig text;
begin
  for r in
    select p.oid::regprocedure as sig, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
  loop
    select substring(cfg from 'search_path=(.*)')
      into v_huidig
      from unnest(coalesce(r.proconfig, array[]::text[])) as cfg
     where cfg like 'search_path=%'
     limit 1;

    if v_huidig is not null and v_huidig like '%, pg_temp' then
      execute format('alter function %s set search_path = %s',
                     r.sig, left(v_huidig, length(v_huidig) - length(', pg_temp')));
    end if;
  end loop;
end $rollback$;

commit;
