-- Herstel P5a: een externe actiehouder heeft bewust géén profielkoppeling,
-- maar wel een naam-snapshot. Dit vervangt alleen de triggerlogica; de
-- profiel-FK en fondsgrens uit de voorafgaande migratie blijven ongewijzigd.
--
-- HAND-APPLIED na 2026_08_30_actie_eigenaar_profiel.sql en vóór de code-deploy.

begin;

create or replace function public.fn_guard_decision_action_eigenaar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_eigenaar_naam text;
begin
  -- Geen profiel: leeg betekent nog niet toegewezen; een naam zonder profiel
  -- is de expliciete externe houder. Beide zijn geldige, verschillende staten.
  if new.eigenaar_id is null then
    if new.eigenaar_naam is not null and nullif(btrim(new.eigenaar_naam), '') is null then
      raise exception 'actie-eigenaarnaam mag niet leeg zijn'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select p.naam
    into v_eigenaar_naam
    from public.decision_objects d
    join public.profielen p
      on p.id = new.eigenaar_id
     and p.fonds_id = d.fonds_id
   where d.id = new.decision_id;

  if not found then
    raise exception 'actie-eigenaar hoort niet bij hetzelfde fonds'
      using errcode = '23514';
  end if;

  -- Bij een gekoppeld profiel is de naam uitsluitend de momentopname van dat
  -- profiel. Bij een externe houder (boven) is de naam juist de houder zelf.
  if tg_op = 'UPDATE'
     and new.eigenaar_id is not distinct from old.eigenaar_id
     and new.eigenaar_naam is distinct from old.eigenaar_naam then
    raise exception 'actie-eigenaarnaam volgt uitsluitend uit het profiel'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.eigenaar_id is distinct from old.eigenaar_id then
    if new.eigenaar_naam is distinct from nullif(btrim(v_eigenaar_naam), '') then
      raise exception 'actie-eigenaarnaam moet de profielnaam volgen'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.fn_guard_decision_action_eigenaar()
  from public, authenticated, service_role;

commit;
