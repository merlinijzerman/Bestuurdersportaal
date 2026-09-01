-- #214-a1 — herbevestig de INSERT-poort op procedure_stappen.
-- ---------------------------------------------------------------------------
-- De gewenste eindtoestand is eerder vastgelegd in p214a1_04. Deze nieuwe
-- forward-migratie maakt die eindtoestand ook expliciet onderdeel van de
-- vervolgvolgorde, zonder historische migraties te wijzigen.
--
-- CREATE OR REPLACE plus DROP/CREATE is deterministisch: als functie en trigger
-- al aanwezig zijn, blijft het contract gelijk; als een omgeving incompleet is,
-- worden uitsluitend deze twee objecten hersteld.
--
-- Volgorde: DB vóór code. De wijziging is compatibel met de vorige én de nieuwe
-- applicatierelease.
-- Rollback: geen veilige DB-rollback na commit. Verwijderen zou de
-- INSERT-omzeiling opnieuw openen. Bij een latere deployfout blijft de guard
-- actief en wordt uitsluitend de code/deploy teruggezet.

begin;

create or replace function public.fn_guard_stap_insert()
returns trigger
language plpgsql
security invoker
set search_path = pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.status in ('afgerond', 'heropend') then
      raise exception 'Een nieuwe stap mag niet als % worden aangemaakt (status is een overgang, geen begintoestand).', new.status
        using errcode = '42501';
    end if;
    if new.voltooid_op is not null or new.voltooid_door is not null then
      raise exception 'Voltooiing (voltooid_op/voltooid_door) mag niet bij het aanmaken van een stap worden gezet.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.fn_guard_stap_insert()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_stap_insert on public.procedure_stappen;
create trigger trg_guard_stap_insert
  before insert on public.procedure_stappen
  for each row execute function public.fn_guard_stap_insert();

-- Transactionele eindcontrole: iedere afwijking rolt functie en trigger terug.
do $$
declare
  fn regprocedure := to_regprocedure('public.fn_guard_stap_insert()');
  definitie text;
begin
  if fn is null then
    raise exception 'p214a1_05: fn_guard_stap_insert() ontbreekt na herbevestiging';
  end if;

  select lower(pg_get_functiondef(fn)) into definitie;

  if (select prosecdef from pg_proc where oid = fn) then
    raise exception 'p214a1_05: fn_guard_stap_insert() is onverwacht SECURITY DEFINER';
  end if;

  if not exists (
    select 1
      from pg_proc p,
           unnest(coalesce(p.proconfig, array[]::text[])) instelling
     where p.oid = fn
       and instelling = 'search_path=pg_temp'
  ) then
    raise exception 'p214a1_05: fn_guard_stap_insert() mist search_path=pg_temp';
  end if;

  if definitie !~ 'current_user in \(''authenticated'', ''anon''\)'
     or definitie !~ 'new\.status in \(''afgerond'', ''heropend''\)'
     or definitie !~ 'new\.voltooid_op is not null'
     or definitie !~ 'new\.voltooid_door is not null' then
    raise exception 'p214a1_05: fn_guard_stap_insert() bevat niet alle vereiste INSERT-controles';
  end if;

  if has_function_privilege('public', fn, 'execute')
     or has_function_privilege('anon', fn, 'execute')
     or has_function_privilege('authenticated', fn, 'execute')
     or has_function_privilege('service_role', fn, 'execute') then
    raise exception 'p214a1_05: fn_guard_stap_insert() heeft een onverwachte directe EXECUTE-grant';
  end if;

  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'procedure_stappen'
       and t.tgname = 'trg_guard_stap_insert'
       and not t.tgisinternal
       and t.tgenabled = 'O'
       and lower(pg_get_triggerdef(t.oid)) like '%before insert%'
       and t.tgfoid = fn::oid
  ) then
    raise exception 'p214a1_05: actieve BEFORE INSERT-trigger ontbreekt of wijst naar de verkeerde functie';
  end if;
end $$;

commit;
