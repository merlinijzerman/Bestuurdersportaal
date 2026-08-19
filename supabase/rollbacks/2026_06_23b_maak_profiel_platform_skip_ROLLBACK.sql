-- ============================================================================
-- ROLLBACK 2026-06-23b — herstel maak_profiel() naar de originele definitie
-- (zonder platform-guard). De trigger bij_registratie blijft staan.
-- ----------------------------------------------------------------------------
-- LET OP: na deze rollback krijgt elk nieuw auth-account weer automatisch een
-- profiel — ook platform-accounts. De 3b-bootstrap vereist dan opnieuw de
-- handmatige profiel-verwijdering (scripts/platform_bootstrap_identiteit.sql 0b).
-- ============================================================================

create or replace function public.maak_profiel()
returns trigger
language plpgsql
security definer
as $function$
begin
  insert into public.profielen (id, naam, fonds_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'naam', new.email),
    (select id from public.fondsen limit 1)
  );
  return new;
end;
$function$;

drop trigger if exists bij_registratie on auth.users;
create trigger bij_registratie
  after insert on auth.users
  for each row execute function public.maak_profiel();
